import { readFileSync } from "node:fs";

import type postgres from "postgres";

/**
 * TLS settings for Node connections to Postgres (local dev, `next build`,
 * scripts). Not used on Cloudflare Workers: there the app connects through
 * Hyperdrive, which verifies the Supabase certificate itself.
 *
 * Supabase signs its database and pooler certificates with its own root CA
 * ("Supabase Root 2021 CA"), which isn't in Node's default trust store. Set
 * DATABASE_SSL_CA to that CA (Supabase → Project Settings → Database → SSL
 * Configuration → Download certificate, `prod-ca-2021.crt`), either as a file
 * path or as the PEM text, and the server certificate and host name are
 * verified. Without it the connection is encrypted but not verified (the
 * behaviour before this setting existed), and a warning says so once.
 * Verification is never switched off when a CA is configured.
 */
export function postgresSsl(url: string, caSetting = process.env.DATABASE_SSL_CA): postgres.Options<never>["ssl"] {
  if (isLocal(url)) return false;
  const ca = loadCa(caSetting);
  if (ca) return { ca, rejectUnauthorized: true };
  warnUnverifiedOnce();
  return "require";
}

const isLocal = (url: string) => url.includes("localhost") || url.includes("127.0.0.1");

/** PEM text (newlines may be written as \n) or a path to a PEM file. Throws if a path is given but can't be read. */
export function loadCa(setting: string | undefined): string | null {
  if (!setting?.trim()) return null;
  const pem = setting.includes("BEGIN CERTIFICATE") ? setting.replace(/\\n/g, "\n") : readFileSync(setting.trim(), "utf8");
  if (!pem.includes("BEGIN CERTIFICATE")) throw new Error("DATABASE_SSL_CA must be a PEM certificate or a path to one.");
  return pem;
}

let warned = false;
function warnUnverifiedOnce() {
  if (warned || process.env.NODE_ENV === "test") return;
  warned = true;
  console.warn(
    JSON.stringify({
      event: "database.tls_unverified",
      detail: "Set DATABASE_SSL_CA to Supabase's CA certificate (prod-ca-2021.crt) to verify the database certificate.",
    }),
  );
}
