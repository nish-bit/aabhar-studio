import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/internal/generation/run: only the queue consumer may call it, with
 * `Authorization: Bearer $JOB_RUNNER_SECRET`. No session cookie, user or
 * admin role is enough, and without a (long enough) secret it doesn't exist.
 */

const runs = vi.hoisted(() => ({ calls: [] as string[], fail: null as Error | null }));

vi.mock("@/server/generation/deps", () => ({ generationDeps: () => ({ marker: "deps" }) }));
vi.mock("@/server/generation/service", () => ({
  runGenerationJob: async (_deps: unknown, jobId: string) => {
    runs.calls.push(jobId);
    if (runs.fail) throw runs.fail;
  },
}));

const SECRET = "s".repeat(48);
const JOB = "0d3c8f58-7f0b-4c55-8c2e-5b8f6d2a9e10";
const URL_ = "https://www.aabharstudio.com/api/internal/generation/run";

async function post(init: { authorization?: string; body?: string; cookie?: string } = {}) {
  const { POST } = await import("@/app/api/internal/generation/run/route");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.authorization !== undefined) headers.authorization = init.authorization;
  if (init.cookie) headers.cookie = init.cookie;
  return POST(new Request(URL_, { method: "POST", headers, body: init.body ?? JSON.stringify({ jobId: JOB }) }));
}

beforeEach(() => {
  runs.calls.length = 0;
  runs.fail = null;
  vi.stubEnv("JOB_RUNNER_SECRET", SECRET);
});
afterEach(() => vi.unstubAllEnvs());

describe("internal generation runner: authentication", () => {
  it("doesn't exist (404) unless JOB_RUNNER_SECRET is set, and set to 32+ characters", async () => {
    for (const value of ["", "too-short-secret"]) {
      vi.stubEnv("JOB_RUNNER_SECRET", value);
      expect((await post({ authorization: `Bearer ${value}` })).status, JSON.stringify(value)).toBe(404);
    }
    expect(runs.calls).toEqual([]);
  });

  it("rejects missing, wrong, differently-sized and non-ASCII credentials with 401", async () => {
    for (const authorization of [undefined, "", `Bearer ${"x".repeat(48)}`, `Bearer ${SECRET}x`, SECRET, `bearer ${SECRET}`, `Bearer ${"é".repeat(48)}`]) {
      const res = await post({ authorization });
      expect(res.status, String(authorization)).toBe(401);
      expect(JSON.stringify(await res.json())).not.toContain(SECRET);
    }
    expect(runs.calls).toEqual([]);
  });

  it("isn't opened by a signed-in user's session cookie", async () => {
    expect((await post({ cookie: "sb-access-token=a-real-looking-session" })).status).toBe(401);
    expect(runs.calls).toEqual([]);
  });

  it("runs the job with the right secret", async () => {
    const res = await post({ authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(runs.calls).toEqual([JOB]);
  });
});

describe("internal generation runner: requests and outcomes", () => {
  it("refuses a body without a valid job id (400), without running anything", async () => {
    for (const body of ["not json", "{}", JSON.stringify({ jobId: "nope" }), JSON.stringify({ jobId: 1 })]) {
      expect((await post({ authorization: `Bearer ${SECRET}`, body })).status, body).toBe(400);
    }
    expect(runs.calls).toEqual([]);
  });

  it("answers 503 when the job can't be claimed or updated, so the consumer retries it", async () => {
    runs.fail = new Error("connect ETIMEDOUT");
    const res = await post({ authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: "internal_error" } });
  });

  it("is excluded from the session middleware, like webhooks and cron", async () => {
    const { config } = await import("@/proxy");
    const apiMatcher = config.matcher.find((m: string) => m.startsWith("/api/"))!;
    const pattern = new RegExp(`^${apiMatcher.replace("/api/(", "/api/(?:").replace(".*)", ".*)")}$`);
    expect(pattern.test("/api/internal/generation/run")).toBe(false);
    expect(pattern.test("/api/cron/billing")).toBe(false);
    expect(pattern.test("/api/generations")).toBe(true);
  });
});
