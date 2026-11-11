// CI security gate for production dependencies: fails on any high or critical
// advisory, except the explicitly accepted ones below (each with its reason).
//
//   node scripts/audit-gate.mjs
//
// Replaces a bare `npm audit --omit=dev --audit-level=high`, which can't pass
// while an advisory has no fixed release. Accepting an advisory here is a
// recorded decision: keep the list short, and remove an entry as soon as a fix
// ships (the gate then reports it again if it's still present).
import { execFileSync } from "node:child_process";

/** Advisory → why it's accepted, and the only packages it may appear in. */
const ACCEPTED = {
  "GHSA-3g3m-2fjr-6pw4": {
    packages: ["glob"],
    reason:
      "glob AbortSignal bypass. No fixed release exists (affects <=14.0.1; latest published is 13.x). Used only by OpenNext's build CLI (@opennextjs/aws, @node-minify/core); never bundled into the Worker and never given untrusted patterns.",
  },
  "GHSA-5j98-mcp5-4vw2": {
    packages: ["glob"],
    reason: "glob CLI -c/--cmd injection. Only the library API is used, by OpenNext's build tooling; the glob CLI is never run.",
  },
  "GHSA-g3hv-75wg-m249": {
    packages: ["minimatch"],
    reason: "minimatch ReDoS on attacker-supplied patterns. Only reached through glob in OpenNext's build tooling, with patterns from our own build config.",
  },
};
const BLOCKING = new Set(["high", "critical"]);

let report;
try {
  report = execFileSync("npm", ["audit", "--omit=dev", "--json"], { encoding: "utf8", shell: process.platform === "win32", maxBuffer: 64 * 1024 * 1024 });
} catch (err) {
  // npm audit exits non-zero when it finds anything; the JSON is still on stdout.
  report = err.stdout;
  if (!report) throw err;
}
const vulns = JSON.parse(report).vulnerabilities ?? {};

const blocking = [];
const accepted = new Set();
for (const [pkg, v] of Object.entries(vulns)) {
  for (const via of v.via) {
    if (typeof via === "string") continue; // inherited from another package, reported there
    if (!BLOCKING.has(via.severity) && !BLOCKING.has(v.severity)) continue;
    const id = String(via.url ?? "").split("/").pop();
    const rule = ACCEPTED[id];
    if (rule && rule.packages.includes(pkg)) accepted.add(`${id} (${pkg})`);
    else blocking.push(`${via.severity ?? v.severity} ${pkg}: ${via.title} ${via.url ?? ""}`);
  }
}

for (const a of accepted) console.log(`accepted: ${a}: ${ACCEPTED[a.split(" ")[0]].reason}`);
if (blocking.length) {
  console.error(`\naudit-gate: ${blocking.length} blocking advisor${blocking.length === 1 ? "y" : "ies"} in production dependencies:`);
  for (const b of blocking) console.error(`  - ${b}`);
  process.exit(1);
}
console.log(`audit-gate: no blocking advisories (${accepted.size} accepted, listed above).`);
