import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { experimental_readRawConfig } from "wrangler";

/**
 * wrangler.jsonc: the production Worker stays exactly as configured, and Worker Previews
 * (`npx wrangler preview`, non-main branches) stay isolated from production resources.
 * Read with Wrangler's own parser, so comments and trailing commas are handled as Wrangler does.
 */

const ROOT = path.resolve(__dirname, "../..");
const WORKER_NAME = "aabhar-studio";
const PRODUCTION_HYPERDRIVE_ID = "e76b8429318a4f4a992f3595eed21c85";
const PUBLIC_VARS = {
  NEXT_PUBLIC_SUPABASE_URL: "https://eguuncnkcjqmeatrpzcj.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_l6NnIvtSOxTWgx48GaU7VA_ZE92nE5s",
  BILLING_LIVE_APPROVED: "false",
};

type Raw = Record<string, unknown> & {
  name?: string;
  vars?: Record<string, unknown>;
  services?: { binding: string; service: string }[];
  hyperdrive?: { binding: string; id: string }[];
  queues?: {
    producers?: { binding: string; queue: string }[];
    consumers?: { queue: string; dead_letter_queue?: string }[];
  };
  triggers?: { crons?: string[] };
  previews?: Record<string, unknown> & { vars?: Record<string, unknown> };
};

const config = experimental_readRawConfig({ config: path.join(ROOT, "wrangler.jsonc") }).rawConfig as Raw;
const previews = config.previews ?? {};

describe("wrangler.jsonc production Worker", () => {
  it("keeps the Worker name aabhar-studio (Workers Builds and the self-reference depend on it)", () => {
    expect(config.name).toBe(WORKER_NAME);
    expect(config.services).toEqual([{ binding: "WORKER_SELF_REFERENCE", service: WORKER_NAME }]);
  });

  it("keeps the production Hyperdrive binding, queues and cron schedules", () => {
    expect(config.hyperdrive).toEqual([{ binding: "HYPERDRIVE", id: PRODUCTION_HYPERDRIVE_ID }]);
    expect(config.queues?.producers).toEqual([{ binding: "GENERATION_QUEUE", queue: "aabhar-generation" }]);
    expect(config.queues?.consumers?.map((c) => c.queue)).toEqual(["aabhar-generation", "aabhar-generation-dlq"]);
    expect(config.queues?.consumers?.[0].dead_letter_queue).toBe("aabhar-generation-dlq");
    expect(config.triggers?.crons).toEqual(["*/10 * * * *", "17 * * * *", "23 21 * * *"]);
  });

  it("keeps live billing off and only public values in vars", () => {
    expect(config.vars).toEqual(PUBLIC_VARS);
  });

  it("defines no routes or custom domains in the config file", () => {
    expect(config.routes).toBeUndefined();
    expect(config.route).toBeUndefined();
  });
});

describe("wrangler.jsonc Worker Previews", () => {
  it("has a previews block (wrangler preview refuses to run in CI without one)", () => {
    expect(config.previews).toBeTypeOf("object");
  });

  it("sets only the public variables, with live billing off", () => {
    expect(previews.vars).toEqual(PUBLIC_VARS);
    for (const name of Object.keys(previews.vars ?? {})) {
      expect(name).not.toMatch(/SECRET|PASSWORD|DATABASE_URL|CONNECTION|OPENAI|RAZORPAY|CRON|JOB_RUNNER|TOKEN/);
    }
  });

  it("has no access to the production database, queues or services", () => {
    for (const key of ["hyperdrive", "queues", "services", "d1_databases", "kv_namespaces", "r2_buckets", "durable_objects", "tail_consumers", "dispatch_namespaces", "secrets_store_secrets"]) {
      expect(previews, key).not.toHaveProperty(key);
    }
    // Belt and braces: no production identifier appears anywhere in the block.
    const text = JSON.stringify(previews);
    expect(text).not.toContain(PRODUCTION_HYPERDRIVE_ID);
    expect(text).not.toContain("aabhar-generation");
    expect(text).not.toContain("WORKER_SELF_REFERENCE");
  });

  it("has no routes or cron triggers", () => {
    for (const key of ["routes", "route", "triggers", "workers_dev"]) {
      expect(previews, key).not.toHaveProperty(key);
    }
  });

  it("allows only the reviewed binding kinds", () => {
    expect(Object.keys(previews).sort()).toEqual(["images", "vars"]);
    expect(previews.images).toEqual({ binding: "IMAGES" });
  });
});

describe("package.json deploy scripts", () => {
  const scripts = (JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;

  it("never runs the Preview flow from the production deploy/upload scripts", () => {
    for (const name of ["deploy", "upload"]) {
      expect(scripts[name]).not.toMatch(/wrangler preview/);
      expect(scripts[name]).not.toMatch(/WRANGLER_CI_(MATCH_TAG|OVERRIDE_NAME)/);
    }
  });
});
