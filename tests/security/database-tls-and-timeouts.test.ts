import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { GatewayError, RAZORPAY_TIMEOUT_MS, RazorpayGateway } from "@/server/billing/gateway";
import { loadCa, postgresSsl } from "@/server/db/ssl";

const PEM = "-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----\n";
const REMOTE = "postgresql://u:p@aws-0-eu-north-1.pooler.supabase.com:5432/postgres";

describe("database TLS", () => {
  it("verifies the certificate whenever a CA is configured (PEM text, escaped newlines or a file path)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ca-"));
    const file = path.join(dir, "prod-ca-2021.crt");
    writeFileSync(file, PEM);
    for (const setting of [PEM, PEM.replace(/\n/g, "\\n"), file]) {
      expect(postgresSsl(REMOTE, setting)).toEqual({ ca: PEM, rejectUnauthorized: true });
    }
  });

  it("never sets rejectUnauthorized: false", () => {
    for (const ssl of [postgresSsl(REMOTE, PEM), postgresSsl(REMOTE, undefined), postgresSsl("postgres://u:p@localhost:5432/db", PEM)]) {
      expect(JSON.stringify(ssl)).not.toContain('"rejectUnauthorized":false');
    }
  });

  it("uses no TLS for a local database", () => {
    expect(postgresSsl("postgres://postgres:postgres@127.0.0.1:5432/postgres", PEM)).toBe(false);
  });

  it("rejects a setting that isn't a certificate", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ca-"));
    const file = path.join(dir, "not-a-cert.txt");
    writeFileSync(file, "hello");
    expect(() => loadCa(file)).toThrow(/PEM certificate/);
    expect(() => loadCa(path.join(dir, "missing.crt"))).toThrow();
  });
});

describe("Razorpay timeout", () => {
  afterEach(() => vi.useRealTimers());

  it("gives up on a stalled API call with a GatewayError instead of hanging", async () => {
    vi.useFakeTimers();
    const gw = new RazorpayGateway("rzp_test_xxxxxxxxxxxxxx", "secret_xxxxxxxxxxxxxxxx");
    (gw as unknown as { rzp: unknown }).rzp = { orders: { create: () => new Promise(() => {}) } };
    const pending = gw.createOrder({ amountPaise: 24_900, receipt: "AS-test", notes: {} });
    const outcome = pending.then(
      () => null,
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(RAZORPAY_TIMEOUT_MS);
    const err = await outcome;
    expect(err).toBeInstanceOf(GatewayError);
    expect((err as GatewayError).statusCode).toBe(504);
  });
});
