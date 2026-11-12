import { describe, expect, it } from "vitest";

import {
  CRON_TASKS,
  GENERATION_DLQ,
  GENERATION_QUEUE,
  RUN_JOB_PATH,
  handleQueueBatch,
  retryDelaySeconds,
  runScheduled,
  type BackgroundEnv,
  type QueueMessage,
} from "@/worker/background";

/**
 * The Worker's queue consumer and cron handler (src/worker/background.ts).
 * They only route work to the app's own endpoints through the service
 * binding, so these tests check what is sent, and how each outcome is
 * acknowledged, retried or reported.
 */

const JOB = "6b0f5c0e-6f8a-4c38-9a0d-4a2b8f0e1c11";
const RUNNER_SECRET = "r".repeat(40);
const CRON_SECRET = "c".repeat(40);

interface SentRequest {
  method: string;
  path: string;
  authorization: string | null;
  body: string;
}

/** A WORKER_SELF_REFERENCE stand-in: records requests, answers with `reply`. */
function selfReference(reply: (req: SentRequest) => Response | Promise<Response>) {
  const sent: SentRequest[] = [];
  return {
    sent,
    binding: {
      async fetch(request: Request) {
        const req = {
          method: request.method,
          path: new URL(request.url).pathname,
          authorization: request.headers.get("authorization"),
          body: await request.text(),
        };
        sent.push(req);
        return reply(req);
      },
    },
  };
}

function message(body: unknown, attempts = 1) {
  const state = { acked: false, retried: false, delaySeconds: undefined as number | undefined };
  const msg: QueueMessage = {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    body,
    attempts,
    ack: () => {
      state.acked = true;
    },
    retry: (options) => {
      state.retried = true;
      state.delaySeconds = options?.delaySeconds;
    },
  };
  return { msg, state };
}

function collectLogs() {
  const logs: { event: string; data: Record<string, unknown> }[] = [];
  return { logs, log: (event: string, data: Record<string, unknown>) => void logs.push({ event, data }) };
}

const env = (binding: BackgroundEnv["WORKER_SELF_REFERENCE"], extra: Partial<BackgroundEnv> = {}): BackgroundEnv => ({
  WORKER_SELF_REFERENCE: binding,
  JOB_RUNNER_SECRET: RUNNER_SECRET,
  CRON_SECRET,
  ...extra,
});

describe("generation queue consumer", () => {
  it("runs the job through the internal route with the runner secret, then acks", async () => {
    const self = selfReference(() => Response.json({ ok: true }));
    const { msg, state } = message({ jobId: JOB });
    await handleQueueBatch({ queue: GENERATION_QUEUE, messages: [msg] }, env(self.binding), collectLogs().log);

    expect(self.sent).toEqual([{ method: "POST", path: RUN_JOB_PATH, authorization: `Bearer ${RUNNER_SECRET}`, body: JSON.stringify({ jobId: JOB }) }]);
    expect(state).toMatchObject({ acked: true, retried: false });
  });

  it("acks a duplicate delivery: the route answers 200 when the job is already claimed or finished", async () => {
    // The route runs runGenerationJob, whose claim returns nothing for a job that isn't queued.
    const self = selfReference(() => Response.json({ ok: true }));
    const first = message({ jobId: JOB });
    const duplicate = message({ jobId: JOB }, 2);
    await handleQueueBatch({ queue: GENERATION_QUEUE, messages: [first.msg, duplicate.msg] }, env(self.binding), collectLogs().log);

    expect(self.sent).toHaveLength(2);
    expect(first.state.acked && duplicate.state.acked).toBe(true);
    expect(first.state.retried || duplicate.state.retried).toBe(false);
  });

  it("retries with exponential backoff on a 5xx, and on a network error", async () => {
    for (const reply of [() => new Response("busy", { status: 503 }), () => Promise.reject(new Error("connection reset"))]) {
      for (const [attempts, delay] of [[1, 15], [2, 30], [3, 60], [4, 120], [5, 240], [9, 240]] as const) {
        const self = selfReference(reply);
        const { msg, state } = message({ jobId: JOB }, attempts);
        await handleQueueBatch({ queue: GENERATION_QUEUE, messages: [msg] }, env(self.binding), collectLogs().log);
        expect(state, `attempt ${attempts}`).toMatchObject({ acked: false, retried: true, delaySeconds: delay });
      }
    }
  });

  it("retries on 408 and 429 (temporary), but acks other 4xx refusals (retrying can't fix them)", async () => {
    for (const status of [408, 429]) {
      const { msg, state } = message({ jobId: JOB });
      await handleQueueBatch({ queue: GENERATION_QUEUE, messages: [msg] }, env(selfReference(() => new Response(null, { status })).binding), collectLogs().log);
      expect(state, String(status)).toMatchObject({ retried: true, acked: false });
    }
    for (const status of [400, 401, 404]) {
      const { logs, log } = collectLogs();
      const { msg, state } = message({ jobId: JOB });
      await handleQueueBatch({ queue: GENERATION_QUEUE, messages: [msg] }, env(selfReference(() => new Response(null, { status })).binding), log);
      expect(state, String(status)).toMatchObject({ acked: true, retried: false });
      expect(logs.map((l) => l.event)).toContain("generation.run_rejected");
    }
  });

  it("acks malformed messages without calling the app", async () => {
    const self = selfReference(() => Response.json({ ok: true }));
    for (const body of [null, "text", { jobId: "not-a-uuid" }, { jobId: 42 }, {}]) {
      const { msg, state } = message(body);
      await handleQueueBatch({ queue: GENERATION_QUEUE, messages: [msg] }, env(self.binding), collectLogs().log);
      expect(state).toMatchObject({ acked: true, retried: false });
    }
    expect(self.sent).toHaveLength(0);
  });

  it("retries (towards the dead-letter queue) when the runner secret or service binding is missing", async () => {
    const self = selfReference(() => Response.json({ ok: true }));
    for (const broken of [env(self.binding, { JOB_RUNNER_SECRET: undefined }), env(undefined)]) {
      const { logs, log } = collectLogs();
      const { msg, state } = message({ jobId: JOB });
      await handleQueueBatch({ queue: GENERATION_QUEUE, messages: [msg] }, broken, log);
      expect(state).toMatchObject({ acked: false, retried: true, delaySeconds: 15 });
      expect(logs[0]!.event).toBe("generation.runner_misconfigured");
    }
    expect(self.sent).toHaveLength(0);
  });

  it("never logs the runner secret", async () => {
    const { logs, log } = collectLogs();
    const { msg } = message({ jobId: JOB });
    await handleQueueBatch({ queue: GENERATION_QUEUE, messages: [msg] }, env(selfReference(() => new Response(null, { status: 500 })).binding), log);
    expect(JSON.stringify(logs)).not.toContain(RUNNER_SECRET);
  });

  it("dead-letter queue: logs each job and acks, without running it (the watchdog refunds it)", async () => {
    const self = selfReference(() => Response.json({ ok: true }));
    const { logs, log } = collectLogs();
    const { msg, state } = message({ jobId: JOB }, 6);
    await handleQueueBatch({ queue: GENERATION_DLQ, messages: [msg] }, env(self.binding), log);

    expect(self.sent).toHaveLength(0);
    expect(state).toMatchObject({ acked: true, retried: false });
    expect(logs).toEqual([{ event: "generation.dead_letter", data: { messageId: msg.id, jobId: JOB, attempts: 6 } }]);
  });

  it("doesn't drop messages from an unexpected queue", async () => {
    const { msg, state } = message({ jobId: JOB });
    await handleQueueBatch({ queue: "some-other-queue", messages: [msg] }, env(selfReference(() => Response.json({})).binding), collectLogs().log);
    expect(state).toMatchObject({ acked: false, retried: true });
  });

  it("keeps every retry inside the watchdog's 10-minute window", () => {
    const totalSeconds = [1, 2, 3, 4, 5].reduce((s, a) => s + retryDelaySeconds(a), 0);
    expect(totalSeconds).toBe(465);
    expect(totalSeconds).toBeLessThan(600);
  });
});

describe("cron handler", () => {
  it("maps the three schedules (UTC) to the existing cron routes, as in vercel.json", () => {
    expect(CRON_TASKS).toEqual({
      "*/10 * * * *": ["/api/cron/expire-jobs"],
      "17 * * * *": ["/api/cron/billing"],
      "23 21 * * *": ["/api/cron/retention"],
    });
  });

  it("calls the route with the CRON_SECRET bearer token and logs the summary", async () => {
    const self = selfReference(() => Response.json({ expired: 2 }));
    const { logs, log } = collectLogs();
    const results = await runScheduled("*/10 * * * *", env(self.binding), { log, now: () => 0 });

    expect(self.sent).toEqual([{ method: "GET", path: "/api/cron/expire-jobs", authorization: `Bearer ${CRON_SECRET}`, body: "" }]);
    expect(results).toEqual([{ path: "/api/cron/expire-jobs", ok: true, status: 200, durationMs: 0 }]);
    expect(logs[0]).toMatchObject({ event: "cron.completed", data: { cron: "*/10 * * * *", summary: { expired: 2 } } });
    expect(JSON.stringify(logs)).not.toContain(CRON_SECRET);
  });

  it("isolates failures: every task runs even when one fails, then the run is reported as failed", async () => {
    const tasks = { "0 * * * *": ["/api/cron/a", "/api/cron/b", "/api/cron/c"] };
    const self = selfReference((req) => {
      if (req.path === "/api/cron/a") return new Response("boom", { status: 500 });
      if (req.path === "/api/cron/b") throw new Error("network down");
      return Response.json({ ok: true });
    });
    const { logs, log } = collectLogs();

    await expect(runScheduled("0 * * * *", env(self.binding), { tasks, log })).rejects.toThrow(/2 of 3 task\(s\) failed: \/api\/cron\/a, \/api\/cron\/b/);
    expect(self.sent.map((r) => r.path).sort()).toEqual(["/api/cron/a", "/api/cron/b", "/api/cron/c"]);
    expect(logs.map((l) => `${l.event} ${l.data.path}`).sort()).toEqual([
      "cron.completed /api/cron/c",
      "cron.failed /api/cron/a",
      "cron.failed /api/cron/b",
    ]);
  });

  it("reports an unauthorized route answer (wrong or missing secret on the app side) as a failure", async () => {
    const self = selfReference(() => Response.json({ error: { code: "unauthenticated" } }, { status: 401 }));
    await expect(runScheduled("17 * * * *", env(self.binding), { log: collectLogs().log })).rejects.toThrow(/\/api\/cron\/billing/);
  });

  it("can run twice, or overlap: each run calls the route independently (the routes are idempotent)", async () => {
    const self = selfReference(() => Response.json({ expired: 0 }));
    const runs = await Promise.all([
      runScheduled("*/10 * * * *", env(self.binding), { log: collectLogs().log }),
      runScheduled("*/10 * * * *", env(self.binding), { log: collectLogs().log }),
    ]);
    expect(runs.flat().every((r) => r.ok)).toBe(true);
    expect(self.sent).toHaveLength(2);
  });

  it("refuses to run without CRON_SECRET or the service binding, and for unknown schedules", async () => {
    const self = selfReference(() => Response.json({}));
    await expect(runScheduled("*/10 * * * *", env(self.binding, { CRON_SECRET: undefined }), { log: collectLogs().log })).rejects.toThrow(/CRON_SECRET/);
    await expect(runScheduled("*/10 * * * *", env(undefined), { log: collectLogs().log })).rejects.toThrow(/WORKER_SELF_REFERENCE/);
    await expect(runScheduled("* * * * *", env(self.binding), { log: collectLogs().log })).rejects.toThrow(/No scheduled task/);
    expect(self.sent).toHaveLength(0);
  });
});
