import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MARKETING_CONSENT, SIGNUP_CONSENT_COOKIE } from "@/lib/marketing";
import { queryAudit } from "@/server/admin/audit";
import { requireAdmin, type AdminContext } from "@/server/admin/guard";
import { csvCell, exportEligibleSubscribersCsv, listSubscribers, marketingSummary } from "@/server/admin/marketing";
import { BillingRepository } from "@/server/billing/repository";
import type { Db } from "@/server/db/sql";
import { personalise, sendCampaign, type CampaignTemplate, type MarketingEmailProvider } from "@/server/marketing/campaigns";
import { eligibleRecipients, getPreferences, subscribe, suppress, unsubscribe, unsubscribeByToken } from "@/server/marketing/consent";

import { makeAdmin, testAdminDeps } from "../support/admin-fixtures";
import { createTestDatabase, createUser } from "../support/pglite-db";

/**
 * Marketing consent end to end on the real migrations: opt-in only by
 * explicit action, one record per user, no-login unsubscribe, eligibility,
 * the admin list/export, and the HTTP routes. Only the session, the
 * database handle and Supabase's code exchange are mocked.
 */
const env = vi.hoisted(() => ({ user: null as { id: string; email: string | null } | null, db: null as unknown, authUser: null as unknown }));

vi.mock("@/server/auth/session", () => ({ getSessionUser: async () => env.user }));
vi.mock("@/server/db/postgres", () => ({ database: () => env.db }));
vi.mock("@/server/auth/account-status", () => ({ isAccountDisabled: async () => false }));
vi.mock("@/server/db/supabase-server", () => ({
  supabaseForRequest: async () => ({ auth: { exchangeCodeForSession: async () => ({ data: { user: env.authUser, session: {} }, error: null }) } }),
}));

const ORIGIN = "http://localhost";
let pg: PGlite;
let db: Db;

const status = async (userId: string) => (await getPreferences(db, userId)).status;
const events = async (userId: string) =>
  (await pg.query<{ action: string; source: string }>("select action, source from public.marketing_consent_events where user_id = $1 order by id", [userId])).rows;
const token = async (userId: string) =>
  (await pg.query<{ t: string }>("select unsubscribe_token as t from public.marketing_subscriptions where user_id = $1", [userId])).rows[0]!.t;

beforeAll(async () => {
  ({ pg, db } = await createTestDatabase());
  env.db = db;
}, 60_000);

/* ============================================================== consent */

describe("consent", () => {
  it("new users are not subscribed unless they opt in, and can still use the app", async () => {
    const u = await createUser(pg);
    expect(await getPreferences(db, u.userId)).toEqual({ email: `${u.userId}@test.local`, status: "none", consentAt: null, unsubscribedAt: null });
    expect(await events(u.userId)).toEqual([]);
    expect(await new BillingRepository(db).balance(u.shopId)).toBe(2); // free trial credits unaffected
  });

  it("records an explicit opt-in once, with timestamp, source and wording version", async () => {
    const u = await createUser(pg);
    expect(await subscribe(db, u.userId, "signup")).toBe(true);
    expect(await subscribe(db, u.userId, "settings")).toBe(false); // already subscribed: no duplicate event
    const { rows } = await pg.query<{ n: number; source: string; version: string; at: Date | null }>(
      `select count(*) over ()::int as n, consent_source as source, consent_version as version, consent_at as at
         from public.marketing_subscriptions where user_id = $1`,
      [u.userId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ n: 1, source: "signup", version: MARKETING_CONSENT.version });
    expect(rows[0]!.at).not.toBeNull();
    expect(await events(u.userId)).toEqual([{ action: "subscribed", source: "signup" }]);
  });

  it("allows one subscription record per user at the database level", async () => {
    const u = await createUser(pg);
    await subscribe(db, u.userId, "settings");
    await expect(pg.query("insert into public.marketing_subscriptions (user_id, status, consent_at) values ($1, 'subscribed', now())", [u.userId])).rejects.toThrow(/unique|duplicate/i);
    await expect(pg.query("insert into public.marketing_subscriptions (user_id, status) values ($1, 'subscribed')", [(await createUser(pg)).userId])).rejects.toThrow(/check/i);
  });

  it("unsubscribing records when, and never creates a record for someone who never opted in", async () => {
    const never = await createUser(pg);
    expect(await unsubscribe(db, never.userId, "settings")).toBe(false);
    expect((await pg.query("select 1 from public.marketing_subscriptions where user_id = $1", [never.userId])).rows).toHaveLength(0);

    const u = await createUser(pg);
    await subscribe(db, u.userId, "settings");
    expect(await unsubscribe(db, u.userId, "settings")).toBe(true);
    expect(await unsubscribe(db, u.userId, "settings")).toBe(false);
    const prefs = await getPreferences(db, u.userId);
    expect(prefs.status).toBe("unsubscribed");
    expect(prefs.unsubscribedAt).not.toBeNull();
    expect(prefs.consentAt).not.toBeNull(); // earlier consent kept as history
    expect(await events(u.userId)).toEqual([{ action: "subscribed", source: "settings" }, { action: "unsubscribed", source: "settings" }]);
  });

  it("keeps the consent history append-only", async () => {
    const u = await createUser(pg);
    await subscribe(db, u.userId, "settings");
    await expect(pg.query("update public.marketing_consent_events set source = 'admin' where user_id = $1", [u.userId])).rejects.toThrow(/append-only/);
  });

  it("hides marketing tables from signed-in customers entirely", async () => {
    const u = await createUser(pg);
    await subscribe(db, u.userId, "settings");
    await pg.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${u.userId}', false);`);
    try {
      await expect(pg.query("select * from public.marketing_subscriptions")).rejects.toThrow(/permission denied/);
      await expect(pg.query("select * from public.marketing_consent_events")).rejects.toThrow(/permission denied/);
      await expect(pg.query("update public.marketing_subscriptions set status = 'subscribed'")).rejects.toThrow(/permission denied/);
    } finally {
      await pg.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
    }
  });
});

/* ========================================================== unsubscribe */

describe("unsubscribe link", () => {
  it("unsubscribes without signing in, keeps the account, and stops future email", async () => {
    const u = await createUser(pg);
    await subscribe(db, u.userId, "signup");
    const t = await token(u.userId);
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect((await eligibleRecipients(db)).some((r) => r.userId === u.userId)).toBe(true);

    expect(await unsubscribeByToken(db, t, "unsubscribe_link")).toBe(true);
    expect(await status(u.userId)).toBe("unsubscribed");
    expect(await unsubscribeByToken(db, t, "one_click")).toBe(true); // repeat is harmless
    expect((await eligibleRecipients(db)).some((r) => r.userId === u.userId)).toBe(false);

    const { rows } = await pg.query<{ disabled: boolean }>("select disabled_at is not null as disabled from public.profiles where id = $1", [u.userId]);
    expect(rows[0]!.disabled).toBe(false);
    expect(await new BillingRepository(db).balance(u.shopId)).toBe(2);
  });

  it("rejects unknown and malformed tokens", async () => {
    expect(await unsubscribeByToken(db, "0".repeat(64), "unsubscribe_link")).toBe(false);
    expect(await unsubscribeByToken(db, "' or 1=1 --", "unsubscribe_link")).toBe(false);
    expect(await unsubscribeByToken(db, "", "unsubscribe_link")).toBe(false);
  });

  it("gives every subscriber a different token", async () => {
    const a = await createUser(pg);
    const b = await createUser(pg);
    await subscribe(db, a.userId, "settings");
    await subscribe(db, b.userId, "settings");
    expect(await token(a.userId)).not.toBe(await token(b.userId));
  });
});

/* =========================================================== eligibility */

describe("who may be emailed", () => {
  it("excludes suppressed (bounced/complained) and disabled accounts; a fresh opt-in lifts suppression", async () => {
    const bounced = await createUser(pg);
    const disabled = await createUser(pg);
    await subscribe(db, bounced.userId, "settings");
    await subscribe(db, disabled.userId, "settings");
    await suppress(db, bounced.userId, "bounce");
    await pg.query("update public.profiles set disabled_at = now() where id = $1", [disabled.userId]);
    const ids = (await eligibleRecipients(db)).map((r) => r.userId);
    expect(ids).not.toContain(bounced.userId);
    expect(ids).not.toContain(disabled.userId);

    await unsubscribe(db, bounced.userId, "settings");
    await subscribe(db, bounced.userId, "settings");
    expect((await eligibleRecipients(db)).map((r) => r.userId)).toContain(bounced.userId);
  });

  it("never sends unless switched on, and every email carries an unsubscribe link and one-click headers", async () => {
    const u = await createUser(pg);
    await subscribe(db, u.userId, "settings");
    const sent: string[] = [];
    const provider: MarketingEmailProvider = { id: "resend", send: async (e) => (sent.push(e.to), { providerMessageId: "m1" }) };
    const t: CampaignTemplate = { id: "c1", kind: "newsletter", subject: "News", html: "<p>Hi</p>", text: "Hi" };

    await expect(sendCampaign({ db, provider, enabled: false, siteUrl: "https://a.example" }, t)).rejects.toThrow(/switched off/);
    await expect(sendCampaign({ db, provider: null, enabled: true, siteUrl: "https://a.example" }, t)).rejects.toThrow(/provider/);
    expect(sent).toEqual([]);

    const r = (await eligibleRecipients(db)).find((x) => x.userId === u.userId)!;
    const email = personalise(t, r, "https://a.example/");
    expect(email.html).toContain(`https://a.example/unsubscribe?token=${r.unsubscribeToken}`);
    expect(email.text).toContain("Unsubscribe:");
    expect(email.headers).toEqual({
      "List-Unsubscribe": `<https://a.example/api/marketing/unsubscribe?token=${r.unsubscribeToken}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });

    const result = await sendCampaign({ db, provider, enabled: true, siteUrl: "https://a.example" }, t);
    expect(sent).toContain(r.email);
    expect(result.sent).toBe((await eligibleRecipients(db)).length);
  });
});

/* ================================================================ admin */

describe("admin marketing dashboard", () => {
  let deps: ReturnType<typeof testAdminDeps>;
  let admin: AdminContext;
  let support: AdminContext;

  beforeAll(async () => {
    deps = testAdminDeps(db);
    const a = await makeAdmin(pg, "admin");
    const s = await makeAdmin(pg, "support");
    admin = await requireAdmin(db, { id: a.userId, email: a.email }, "write");
    support = await requireAdmin(db, { id: s.userId, email: s.email }, "read");
  });

  it("counts, searches and filters subscribers", async () => {
    const u = await createUser(pg);
    await subscribe(db, u.userId, "signup");
    const s = await marketingSummary(deps, support);
    expect(s.registeredUsers).toBe(s.subscribed + s.unsubscribed + s.pending + s.notOptedIn);
    expect(s.eligible).toBeLessThanOrEqual(s.subscribed);

    const found = await listSubscribers(deps, support, { q: u.userId.slice(0, 13) });
    expect(found.items.map((r) => r.userId)).toEqual([u.userId]);
    expect(found.items[0]).toMatchObject({ status: "subscribed", consentSource: "signup" });

    const subs = await listSubscribers(deps, support, { status: "subscribed" });
    expect(subs.items.every((r) => r.status === "subscribed")).toBe(true);
    const none = await listSubscribers(deps, support, { status: "none" });
    expect(none.items.every((r) => r.status === "none" && r.consentAt === null)).toBe(true);
  });

  it("exports only eligible subscribers, admin role only, and audits each export", async () => {
    await expect(exportEligibleSubscribersCsv(deps, support)).rejects.toThrow(/read-only/);
    const out = await createUser(pg);
    await subscribe(db, out.userId, "settings");
    await unsubscribe(db, out.userId, "settings");

    const { csv, count } = await exportEligibleSubscribersCsv(deps, admin);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("email,signed_up_at,consent_at,consent_source");
    expect(lines).toHaveLength(count + 1);
    expect(csv).not.toContain(out.userId);
    expect(count).toBe((await eligibleRecipients(db)).length);

    const audit = await queryAudit(db, { action: "marketing.export" });
    expect(audit.items[0]).toMatchObject({ action: "marketing.export", actorEmail: admin.email });
  });

  it("neutralises spreadsheet formulas in CSV cells", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("a@b.example")).toBe(`"a@b.example"`);
  });
});

/* =============================================================== routes */

describe("routes", () => {
  beforeEach(() => {
    env.user = null;
    env.authUser = null;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  const prefs = () => import("@/app/api/marketing/preferences/route");
  const put = async (body: unknown, headers: Record<string, string> = { origin: ORIGIN }) =>
    (await prefs()).PUT(new Request(`${ORIGIN}/api/marketing/preferences`, { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } }), {});

  it("preferences need a signed-in user and only ever touch that user", async () => {
    expect((await (await prefs()).GET(new Request(`${ORIGIN}/api/marketing/preferences`), {})).status).toBe(401);
    const me = await createUser(pg);
    const other = await createUser(pg);
    env.user = { id: me.userId, email: null };

    const res = await put({ subscribed: true });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("subscribed");
    expect(await status(other.userId)).toBe("none");

    expect((await put({ subscribed: false })).status).toBe(200);
    expect(await status(me.userId)).toBe("unsubscribed");
  });

  it("refuses cross-site changes and bad input", async () => {
    const me = await createUser(pg);
    env.user = { id: me.userId, email: null };
    expect((await put({ subscribed: true }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await put({ subscribed: "yes" })).status).toBe(400);
    expect((await put({ subscribed: true, userId: "someone-else" })).status).toBe(400);
    expect(await status(me.userId)).toBe("none");
  });

  it("unsubscribe route: confirm form redirects with the outcome; one-click answers 200; GET does nothing", async () => {
    const mod = await import("@/app/api/marketing/unsubscribe/route");
    expect("GET" in mod).toBe(false);
    const u = await createUser(pg);
    await subscribe(db, u.userId, "settings");
    const t = await token(u.userId);

    const bad = await mod.POST(new Request(`${ORIGIN}/api/marketing/unsubscribe`, { method: "POST", body: new URLSearchParams({ token: "nope" }) }));
    expect(bad.status).toBe(303);
    expect(bad.headers.get("location")).toBe(`${ORIGIN}/unsubscribe?status=invalid`);
    expect(await status(u.userId)).toBe("subscribed");

    const ok = await mod.POST(new Request(`${ORIGIN}/api/marketing/unsubscribe`, { method: "POST", body: new URLSearchParams({ token: t }) }));
    expect(ok.headers.get("location")).toBe(`${ORIGIN}/unsubscribe?status=done`);
    expect(await status(u.userId)).toBe("unsubscribed");

    await subscribe(db, u.userId, "settings");
    const oneClick = await mod.POST(
      new Request(`${ORIGIN}/api/marketing/unsubscribe?token=${t}`, { method: "POST", body: new URLSearchParams({ "List-Unsubscribe": "One-Click" }) }),
    );
    expect(oneClick.status).toBe(200);
    expect((await events(u.userId)).at(-1)).toEqual({ action: "unsubscribed", source: "one_click" });
  });

  const signIn = async (cookie?: string) => {
    const { GET } = await import("@/app/auth/callback/route");
    return GET(new Request(`${ORIGIN}/auth/callback?code=abc`, { headers: cookie ? { cookie } : {} }));
  };

  it("sign-up with the box ticked records consent as a sign-up and clears the cookie", async () => {
    const u = await createUser(pg);
    env.authUser = { id: u.userId, created_at: new Date().toISOString() };
    const res = await signIn(`other=1; ${SIGNUP_CONSENT_COOKIE}=${MARKETING_CONSENT.version}`);
    expect(res.status).toBe(303);
    expect(await events(u.userId)).toEqual([{ action: "subscribed", source: "signup" }]);
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`${SIGNUP_CONSENT_COOKIE}=;.*Max-Age=0`, "i"));
  });

  it("sign-up without the box ticked subscribes no one, and stale wording doesn't count", async () => {
    const u = await createUser(pg);
    env.authUser = { id: u.userId, created_at: new Date().toISOString() };
    expect((await signIn()).status).toBe(303);
    expect((await signIn(`${SIGNUP_CONSENT_COOKIE}=2020-01-01`)).status).toBe(303);
    expect(await status(u.userId)).toBe("none");
  });

  it("a returning user who ticks the box is recorded as opting in from the sign-in page", async () => {
    const u = await createUser(pg);
    env.authUser = { id: u.userId, created_at: "2026-01-01T00:00:00Z" };
    await signIn(`${SIGNUP_CONSENT_COOKIE}=${MARKETING_CONSENT.version}`);
    expect(await events(u.userId)).toEqual([{ action: "subscribed", source: "sign_in" }]);
  });
});
