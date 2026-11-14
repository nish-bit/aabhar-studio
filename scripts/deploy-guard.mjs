/**
 * Refuses a deploy or upload from this machine when it could ship local secrets.
 *
 * `opennextjs-cloudflare build` compiles the project's .env* files (.env, .env.local,
 * .env.<mode>, .env.<mode>.local) into the Worker bundle as plain JSON
 * (.open-next/cloudflare/next-env.mjs), so a build made on a developer machine and then
 * uploaded carries every value in .env.local inside the Worker script.
 *
 * Production releases go through Cloudflare Workers Builds (its checkout has no .env files).
 * `npm run deploy` and `npm run upload` call this twice:
 *
 *   node scripts/deploy-guard.mjs           before the build: no secret-bearing env files present
 *   node scripts/deploy-guard.mjs --bundle  after the build:  the built bundle embeds no env values
 *
 * There's deliberately no override flag. Prints file and variable NAMES only, never values.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Committed examples with placeholder values only. */
const ALLOWED = new Set([".env.example", ".dev.vars.example"]);

/** Local files that hold secrets: any .env* (compiled into the bundle by OpenNext) and .dev.vars* (Wrangler's local secrets). */
export function secretEnvFiles(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isFile() && (e.name === ".env" || e.name.startsWith(".env.") || e.name === ".dev.vars" || e.name.startsWith(".dev.vars.")))
    .map((e) => e.name)
    .filter((name) => !ALLOWED.has(name))
    .sort();
}

/**
 * Variable names embedded per mode in a built bundle's next-env.mjs (an empty object per mode is clean).
 * Returns null when there's no build to inspect.
 */
export function embeddedEnvNames(root) {
  const file = path.join(root, ".open-next", "cloudflare", "next-env.mjs");
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8");
  const modes = {};
  for (const m of text.matchAll(/export const (\w+) = (\{.*?\});?\s*$/gm)) {
    let parsed;
    try {
      parsed = JSON.parse(m[2]);
    } catch {
      parsed = { "<unparseable>": true };
    }
    modes[m[1]] = Object.keys(parsed).sort();
  }
  // Anything we couldn't read as plain "export const <mode> = {…}" counts as not clean.
  if (Object.keys(modes).length === 0 && text.trim() !== "") modes["<unrecognised next-env.mjs>"] = ["<unknown>"];
  return modes;
}

/** Problems that block a deploy/upload. Empty array = allowed. */
export function deployGuardProblems(root, { bundle = false } = {}) {
  const problems = [];
  const files = secretEnvFiles(root);
  if (files.length) {
    problems.push(
      `Secret-bearing env files are present: ${files.join(", ")}. OpenNext compiles .env* files into the Worker bundle, and this machine holds local secrets.`,
    );
  }
  if (bundle) {
    const modes = embeddedEnvNames(root);
    if (modes === null) {
      problems.push("No OpenNext build found (.open-next/cloudflare/next-env.mjs). Build first.");
    } else {
      for (const [mode, names] of Object.entries(modes)) {
        if (names.length) problems.push(`The built bundle embeds ${names.length} variable(s) in "${mode}" mode: ${names.join(", ")}.`);
      }
    }
  }
  return problems;
}

function main() {
  const root = process.cwd();
  const bundle = process.argv.includes("--bundle");
  const problems = deployGuardProblems(root, { bundle });
  if (problems.length === 0) {
    console.log(bundle ? "deploy-guard: built bundle embeds no env values." : "deploy-guard: no secret-bearing env files present.");
    return;
  }
  console.error("deploy-guard: REFUSED. Deploying or uploading from this machine could ship local secrets.\n");
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    "\nRelease through Cloudflare Workers Builds instead: push to GitHub, let Workers Builds upload a preview version, then promote it.\n" +
      "Local Worker testing is still available with `npm run preview` (nothing is uploaded).",
  );
  process.exit(1);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();
