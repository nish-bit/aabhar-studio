import { randomUUID } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { Db } from "@/server/db/sql";

import { failedJob, makeAdmin, testAdminDeps } from "../support/admin-fixtures";
import { createTestDatabase, createUser } from "../support/pglite-db";

/**
 * HTTP-level authorization for every /api/admin route, plus the customer
 * API's disabled-account check. The session is the only thing mocked: the
 * route code, guard and SQL are real.
 */
const session = vi.hoisted(() => ({ user: null as { id: string; email: string | null } | null, db: null as unknown }));

vi.mock("@/server/auth/session", () => ({ getSessionUser: async () => session.user }));
vi.mock("@/server/admin/deps", async () => {
  const fx = await import("../support/admin-fixtures");
  return { PLANS_CACHE_TAG: "billing-plans", adminDeps: () => fx.testAdminDeps(session.db as Db) };
});
vi.mock("@/server/auth/account-status", () => ({
  isAccountDisabled: async (id: string) => {
    const rows = await (session.db as Db).query<{ d: boolean }>("select disabled_at is not null as d from public.profiles where id = $1", [id]);
    return rows[0]?.d ?? false;
  },
}));

let pg: PGlite;
let db: Db;
let people: Record<"customer" | "support" | "admin", { id: string; email: string | null }>;
let customerShop: string;
let jobId: string;

const ORIGIN = "http://localhost";
const ROOT = path.resolve(__dirname, "../../src/app/api/admin");

/** Every admin route file, with its URL path. */
function routeFiles(dir = ROOT, prefix = "/api/admin"): { file: string; url: string }[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full, `${prefix}/${name}`);
    return name === "route.ts" ? [{ file: full, url: prefix }] : [];
  });
}

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function call(file: string, method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const mod = (await import(file)) as Record<string, Handler>;
  const params = { id: jobId, slug: "velvet" };
  const realUrl = url.replace("[id]", url.includes("/plans/") ? "starter" : url.includes("/users/") ? people.customer.id : jobId).replace("[slug]", "velvet");
  const init: RequestInit = { method, headers: { origin: ORIGIN, "content-type": "application/json", ...headers } };
  if (body !== undefined && method !== "GET") init.body = JSON.stringify(body);
  const res = await mod[method]!(new Request(ORIGIN + realUrl, init), { params: Promise.resolve(url.includes("/plans/") ? { id: "starter" } : url.includes("/users/") ? { id: people.customer.id } : params) });
  return res;
}

beforeAll(async () => {
  ({ pg, db } = await createTestDatabase());
  session.db = db;
  const c = await createUser(pg);
  customerShop = c.shopId;
  const s = await makeAdmin(pg, "support");
  const a = await makeAdmin(pg, "admin");
  people = { customer: { id: c.userId, email: null }, support: { id: s.userId, email: s.email }, admin: { id: a.userId, email: a.email } };
  jobId = (await failedJob(pg, { userId: c.userId, shopId: c.shopId, errorCode: "timeout" })).jobId;
}, 60_000);

const routes = routeFiles();
const methodsOf = async (file: string) => Object.keys(await import(file)).filter((k) => ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(k));

describe("every admin API route", () => {
  it("covers all route files", () => {
    expect(routes.length).toBeGreaterThanOrEqual(17);
  });

  it("returns 401 to anonymous visitors and 404 to normal customers, for every method", async () => {
    for (const r of routes) {
      for (const m of await methodsOf(r.file)) {
        session.user = null;
        expect((await call(r.file, m, r.url, {})).status, `${m} ${r.url} anonymous`).toBe(401);
        session.user = people.customer;
        const res = await call(r.file, m, r.url, {});
        expect(res.status, `${m} ${r.url} customer`).toBe(404);
        expect(JSON.stringify(await res.json())).not.toMatch(/admin/i);
      }
    }
  });

  it("lets support read but not write", async () => {
    session.user = people.support;
    for (const r of routes) {
      for (const m of await methodsOf(r.file)) {
        const res = await call(r.file, m, r.url, { reason: "support should not be able to do this" });
        if (m === "GET") expect(res.status, `GET ${r.url}`).toBe(200);
        else expect(res.status, `${m} ${r.url}`).toBe(403);
      }
    }
  });

  it("lets admins read everything", async () => {
    session.user = people.admin;
    for (const r of routes) {
      if ((await methodsOf(r.file)).includes("GET")) expect((await call(r.file, "GET", r.url)).status, r.url).toBe(200);
    }
  });

  it("rejects cross-site and Origin-less writes even from admins (CSRF)", async () => {
    session.user = people.admin;
    const file = path.join(ROOT, "credits/grants/route.ts");
    const body = { shopId: customerShop, amount: 5, expiresInDays: null, reason: "csrf test grant", idempotencyKey: randomUUID() };
    expect((await call(file, "POST", "/api/admin/credits/grants", body, { origin: "https://evil.example" })).status).toBe(403);
    const mod = (await import(file)) as Record<string, Handler>;
    const noOrigin = new Request(`${ORIGIN}/api/admin/credits/grants`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
    expect((await mod.POST!(noOrigin, { params: Promise.resolve({}) })).status).toBe(403);
    const { rows } = await pg.query<{ balance: number }>("select balance from public.credit_balances where shop_id = $1", [customerShop]);
    expect(rows[0]!.balance).toBe(2);
  });

  it("performs admin writes end-to-end and audits them", async () => {
    session.user = people.admin;
    const grant = await call(path.join(ROOT, "credits/grants/route.ts"), "POST", "/api/admin/credits/grants", {
      shopId: customerShop, amount: 15, expiresInDays: 90, reason: "Compensation for outage", idempotencyKey: randomUUID(),
    });
    expect(grant.status).toBe(201);
    expect(await grant.json()).toMatchObject({ granted: true, balance: 17 });

    const disable = await call(path.join(ROOT, "users/[id]/status/route.ts"), "POST", "/api/admin/users/[id]/status", { disabled: true, reason: "Chargeback fraud pattern" });
    expect(disable.status).toBe(200);
    const audit = await pg.query<{ action: string }>("select action from public.admin_audit_log where actor_id = $1 order by id", [people.admin.id]);
    expect(audit.rows.map((r) => r.action)).toEqual(expect.arrayContaining(["credits.promo_grant", "user.disable"]));
  });

  it("never sends secrets or raw payloads in admin responses", async () => {
    process.env.RAZORPAY_KEY_SECRET = "rzp_secret_should_never_leak";
    process.env.OPENAI_API_KEY = "sk-should-never-leak-000000000000";
    session.user = people.admin;
    for (const r of routes) {
      if (!(await methodsOf(r.file)).includes("GET")) continue;
      const text = await (await call(r.file, "GET", r.url)).text();
      expect(text, r.url).not.toContain("should_never_leak");
      expect(text, r.url).not.toContain("should-never-leak");
      expect(text, r.url).not.toMatch(/storage_path|upload_path|"payload"|instructions"/);
    }
  });
});

describe("customer API with a disabled account", () => {
  it("blocks every customer API call immediately, even with a live session", async () => {
    session.user = people.customer; // disabled by the previous test
    const { GET } = (await import("@/app/api/billing/overview/route")) as unknown as { GET: Handler };
    const res = await GET(new Request(`${ORIGIN}/api/billing/overview`), { params: Promise.resolve({}) });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("account_disabled");
  });

  it("refuses customer writes without a same-site Origin (CSRF)", async () => {
    const u = await createUser(pg);
    session.user = { id: u.userId, email: null };
    const { POST } = (await import("@/app/api/catalogues/route")) as unknown as { POST: Handler };
    const body = JSON.stringify({ name: "CSRF test" });
    for (const headers of [{}, { origin: "https://evil.example" }] as Record<string, string>[]) {
      const res = await POST(new Request(`${ORIGIN}/api/catalogues`, { method: "POST", body, headers: { "content-type": "application/json", ...headers } }), { params: Promise.resolve({}) });
      expect(res.status).toBe(403);
    }
    const { rows } = await pg.query("select 1 from public.catalogues where shop_id = $1", [u.shopId]);
    expect(rows).toHaveLength(0);
  });
});
