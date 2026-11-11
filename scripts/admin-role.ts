/**
 * Grants or revokes platform admin roles. This is deliberately the ONLY way
 * to create an admin: it needs direct database access (DATABASE_URL), so no
 * web request can ever promote an account.
 *
 *   npm run admin:role -- grant  owner@example.com admin   "Founder"
 *   npm run admin:role -- grant  helper@example.com support "Support desk"
 *   npm run admin:role -- revoke helper@example.com
 *   npm run admin:role -- list
 *
 * The person must have signed in at least once (so their account exists).
 * Roles: admin (read + write) · support (read-only).
 */
import os from "node:os";

import postgres from "postgres";

import { postgresSsl } from "../src/server/db/ssl";

async function main() {
  const [cmd, email, role = "support", ...noteParts] = process.argv.slice(2);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const sql = postgres(url, { prepare: false, max: 1, ssl: postgresSsl(url) });
  const operator = `script:${os.userInfo().username}@${os.hostname()}`;
  try {
    if (cmd === "list") {
      const rows = await sql`select u.email, a.role, a.created_at, a.revoked_at, a.granted_by from public.platform_admins a join auth.users u on u.id = a.user_id order by a.created_at`;
      console.table(rows);
      return;
    }
    if (!email || !["grant", "revoke"].includes(cmd ?? "")) throw new Error("Usage: admin-role grant <email> <admin|support> [note] | revoke <email> | list");
    const users = await sql<{ id: string }[]>`select id from auth.users where lower(email) = lower(${email})`;
    if (!users[0]) throw new Error(`No account for ${email}. They need to sign in once first.`);
    const id = users[0].id;
    if (cmd === "grant") {
      if (!["admin", "support"].includes(role)) throw new Error("Role must be admin or support.");
      await sql`insert into public.platform_admins (user_id, role, granted_by, note) values (${id}, ${role}, ${operator}, ${noteParts.join(" ") || null})
                on conflict (user_id) do update set role = excluded.role, granted_by = excluded.granted_by, note = excluded.note, revoked_at = null, created_at = now()`;
      console.log(`Granted ${role} to ${email}.`);
    } else {
      const r = await sql`update public.platform_admins set revoked_at = now() where user_id = ${id} and revoked_at is null returning user_id`;
      console.log(r.length ? `Revoked admin access for ${email}.` : `${email} had no active admin role.`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
