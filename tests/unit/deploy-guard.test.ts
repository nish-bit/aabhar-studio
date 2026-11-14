import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { deployGuardProblems, embeddedEnvNames, secretEnvFiles } from "../../scripts/deploy-guard.mjs";

/**
 * scripts/deploy-guard.mjs: `npm run deploy` / `npm run upload` refuse to run on a machine with
 * local secret files, and refuse to upload a bundle that embeds env values (OpenNext compiles
 * .env* files into .open-next/cloudflare/next-env.mjs). Only names are ever printed.
 */

const ROOT = path.resolve(__dirname, "../..");
const FAKE_SECRET = "fake-secret-value-for-deploy-guard-test-0001";
const dirs: string[] = [];

function project(files: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "deploy-guard-"));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  return dir;
}
const cleanBundle = 'export const production = {};\nexport const development = {};\nexport const test = {};\n';
const leakyBundle = `export const production = {"SUPABASE_SECRET_KEY":"${FAKE_SECRET}","DATABASE_URL":"${FAKE_SECRET}"};\nexport const development = {};\nexport const test = {};\n`;

function runGuard(cwd: string, ...args: string[]) {
  return spawnSync(process.execPath, [path.join(ROOT, "scripts/deploy-guard.mjs"), ...args], { cwd, encoding: "utf8" });
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("deploy guard: env files", () => {
  it("finds every secret-bearing env file and ignores the committed examples", () => {
    const dir = project({
      ".env": "A=1", ".env.local": "A=1", ".env.production": "A=1", ".env.development.local": "A=1", ".env.test": "A=1",
      ".dev.vars": "A=1", ".dev.vars.staging": "A=1", ".env.example": "A=", ".dev.vars.example": "A=", "README.md": "",
    });
    expect(secretEnvFiles(dir)).toEqual([".dev.vars", ".dev.vars.staging", ".env", ".env.development.local", ".env.local", ".env.production", ".env.test"]);
  });

  it("allows a checkout with only the examples (as in Workers Builds)", () => {
    expect(deployGuardProblems(project({ ".env.example": "A=" }))).toEqual([]);
  });

  it("refuses from the command line with exit code 1, naming files but never printing values", () => {
    const res = runGuard(project({ ".env.local": `SUPABASE_SECRET_KEY=${FAKE_SECRET}` }));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("REFUSED");
    expect(res.stderr).toContain(".env.local");
    expect(res.stdout + res.stderr).not.toContain(FAKE_SECRET);
  });

  it("passes from the command line on a clean checkout", () => {
    const res = runGuard(project({}));
    expect(res.status).toBe(0);
  });
});

describe("deploy guard: built bundle", () => {
  it("accepts a bundle whose modes are all empty", () => {
    const dir = project({ ".open-next/cloudflare/next-env.mjs": cleanBundle });
    expect(embeddedEnvNames(dir)).toEqual({ production: [], development: [], test: [] });
    expect(deployGuardProblems(dir, { bundle: true })).toEqual([]);
  });

  it("refuses a bundle that embeds env values, even after the env files were removed", () => {
    const dir = project({ ".open-next/cloudflare/next-env.mjs": leakyBundle });
    const problems = deployGuardProblems(dir, { bundle: true });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("DATABASE_URL, SUPABASE_SECRET_KEY");
    const res = runGuard(dir, "--bundle");
    expect(res.status).toBe(1);
    expect(res.stdout + res.stderr).not.toContain(FAKE_SECRET);
  });

  it("refuses when there's no build, or the file isn't in the expected shape", () => {
    expect(deployGuardProblems(project({}), { bundle: true })[0]).toMatch(/No OpenNext build/);
    const odd = project({ ".open-next/cloudflare/next-env.mjs": "export default something();\n" });
    expect(deployGuardProblems(odd, { bundle: true }).length).toBeGreaterThan(0);
  });
});

describe("package.json wiring", () => {
  const scripts = (JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;

  it.each(["deploy", "upload"])("npm run %s checks env files first and the built bundle right before the upload", (name) => {
    const steps = scripts[name]!.split("&&").map((s) => s.trim());
    expect(steps[0]).toBe("node scripts/deploy-guard.mjs");
    const build = steps.indexOf("opennextjs-cloudflare build");
    const ship = steps.findIndex((s) => s === `opennextjs-cloudflare ${name}`);
    expect(build).toBeGreaterThan(0);
    expect(ship).toBe(steps.length - 1);
    expect(steps[ship - 1]).toBe("node scripts/deploy-guard.mjs --bundle");
    expect(scripts[name]).not.toMatch(/\|\||;|--force|SKIP|ALLOW/i); // no fallthrough or bypass
  });

  it("no other npm script uploads or deploys", () => {
    for (const [name, cmd] of Object.entries(scripts)) {
      if (name === "deploy" || name === "upload") continue;
      expect(cmd, name).not.toMatch(/opennextjs-cloudflare (deploy|upload)|wrangler (deploy|versions upload|versions deploy)/);
    }
  });
});
