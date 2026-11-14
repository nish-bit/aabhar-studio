import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";
import { describe, expect, it, vi } from "vitest";

import { BROWSER_BUILD, patchPdfkit, SUPPORTED_VERSION, WORKERD_ENTRY, WORKERD_ENTRY_SOURCE } from "../../scripts/patch-pdfkit-workerd.mjs";

/**
 * The Worker's PDFs depend on scripts/patch-pdfkit-workerd.mjs. These tests
 * fail if the patch is missing, applied wrongly, or no longer makes OpenNext's
 * esbuild pick the registered browser build, and check Node still gets the Node build.
 */

// The resolution checks run real esbuild bundles of pdfkit (~2 s alone, longer
// while the rest of the suite runs in parallel). That's work, not a hang.
vi.setConfig({ testTimeout: 60_000 });

const root = path.resolve(import.meta.dirname, "../..");
const pdfkitDir = path.join(root, "node_modules/pdfkit");
const pkgJson = () => JSON.parse(readFileSync(path.join(pdfkitDir, "package.json"), "utf8"));
const ORIGINAL_MAIN = { node: { import: "./js/pdfkit.node.mjs", require: "./js/pdfkit.js" }, default: BROWSER_BUILD };

/** Which pdfkit files esbuild pulls in for `import "pdfkit"` / `require("pdfkit")` with the given conditions. */
async function pdfkitFilesBundled(conditions: string[] | undefined, style: "import" | "require") {
  const result = await build({
    stdin: {
      contents: style === "import" ? `import * as p from "pdfkit"; export default p;` : `module.exports = require("pdfkit");`,
      resolveDir: root,
      loader: "js",
    },
    bundle: true,
    write: false,
    metafile: true,
    // The settings OpenNext uses for the Worker's server bundle (bundle-server.js).
    platform: "node",
    format: "esm",
    ...(conditions ? { conditions } : {}),
    logLevel: "silent",
  });
  return Object.keys(result.metafile.inputs)
    .filter((f) => f.includes("node_modules/pdfkit/js/"))
    .map((f) => f.split("node_modules/pdfkit/js/")[1]!);
}

describe("pdfkit workerd patch (installed copy)", () => {
  it("is applied to the installed pdfkit", () => {
    const pkg = pkgJson();
    expect(pkg.version, "pdfkit version changed: review scripts/patch-pdfkit-workerd.mjs").toBe(SUPPORTED_VERSION);
    expect(pkg.exports["."], "run `node scripts/patch-pdfkit-workerd.mjs` (it normally runs on npm install)").toEqual({ workerd: WORKERD_ENTRY, ...ORIGINAL_MAIN });
    expect(Object.keys(pkg.exports["."])[0]).toBe("workerd");
    expect(readFileSync(path.join(pdfkitDir, WORKERD_ENTRY), "utf8")).toBe(WORKERD_ENTRY_SOURCE);
    // pdfkit's other exports are untouched.
    expect(pkg.exports["./standard-fonts/Helvetica"]).toEqual({ require: "./js/standard-fonts/Helvetica.cjs", default: "./js/standard-fonts/Helvetica.mjs" });
  });

  it("makes OpenNext's esbuild settings (platform node, conditions [workerd]) bundle the registered browser build, for import and require", async () => {
    for (const style of ["import", "require"] as const) {
      const files = await pdfkitFilesBundled(["workerd"], style);
      expect(files, style).toContain("pdfkit.workerd.mjs");
      expect(files, style).toContain("pdfkit.browser.mjs");
      expect(files, style).toContain("standard-fonts/Helvetica.mjs");
      expect(files, style).not.toContain("pdfkit.node.mjs");
      expect(files, style).not.toContain("pdfkit.js");
    }
  });

  it("gives every importer a pdfkit with the built-in fonts already registered", async () => {
    const mod = await import(/* @vite-ignore */ pathToFileURL(path.join(pdfkitDir, WORKERD_ENTRY)).href);
    const PDFDocument = mod.default as new (o: object) => { font(name: string): unknown };
    // pdfkit opens every document in Helvetica; this throws if the fonts weren't registered.
    const doc = new PDFDocument({ autoFirstPage: false });
    expect(() => doc.font("Times-Roman")).not.toThrow();
    expect(typeof mod.registerStdFonts).toBe("function");
  });

  it("leaves Node on the Node build (no workerd condition)", async () => {
    expect(await pdfkitFilesBundled(undefined, "import")).toContain("pdfkit.node.mjs");
    expect(path.basename(createRequire(import.meta.url).resolve("pdfkit"))).toBe("pdfkit.js");
  });

  it("is run on install and before every Worker build", () => {
    const scripts = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts as Record<string, string>;
    expect(scripts.postinstall).toContain("scripts/patch-pdfkit-workerd.mjs");
    for (const s of ["deploy", "preview", "upload"]) {
      // deploy/upload start with scripts/deploy-guard.mjs; the patch must still run before the build.
      const steps = scripts[s]!.split("&&").map((x) => x.trim());
      const patch = steps.indexOf("node scripts/patch-pdfkit-workerd.mjs");
      expect(patch, s).toBeGreaterThanOrEqual(0);
      expect(patch, s).toBeLessThan(steps.indexOf("opennextjs-cloudflare build"));
    }
  });
});

describe("patchPdfkit (on temporary copies)", () => {
  const copy = () => {
    const dir = path.join(mkdtempSync(path.join(tmpdir(), "pdfkit-")), "pdfkit");
    cpSync(pdfkitDir, dir, { recursive: true });
    return dir;
  };
  const read = (dir: string) => JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  const setMain = (dir: string, main: unknown) => {
    const pkg = read(dir);
    pkg.exports["."] = main;
    writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  };
  const unpatch = (dir: string) => {
    setMain(dir, ORIGINAL_MAIN);
    rmSync(path.join(dir, WORKERD_ENTRY), { force: true });
  };

  it("patches a clean install, changing only the one export and adding the wrapper", () => {
    const dir = copy();
    unpatch(dir);
    const before = read(dir);
    expect(patchPdfkit(dir)).toBe("patched");
    const after = read(dir);
    expect(after.exports["."]).toEqual({ workerd: WORKERD_ENTRY, ...ORIGINAL_MAIN });
    expect({ ...after, exports: { ...after.exports, ".": ORIGINAL_MAIN } }).toEqual(before);
    expect(readFileSync(path.join(dir, WORKERD_ENTRY), "utf8")).toBe(WORKERD_ENTRY_SOURCE);
  });

  it("upgrades the first version of the patch (workerd → browser build) in place", () => {
    const dir = copy();
    unpatch(dir);
    setMain(dir, { workerd: BROWSER_BUILD, ...ORIGINAL_MAIN });
    expect(patchPdfkit(dir)).toBe("patched");
    expect(read(dir).exports["."].workerd).toBe(WORKERD_ENTRY);
  });

  it("is idempotent", () => {
    const dir = copy();
    unpatch(dir);
    patchPdfkit(dir);
    const once = [readFileSync(path.join(dir, "package.json"), "utf8"), readFileSync(path.join(dir, WORKERD_ENTRY), "utf8")];
    expect(patchPdfkit(dir)).toBe("already-patched");
    expect([readFileSync(path.join(dir, "package.json"), "utf8"), readFileSync(path.join(dir, WORKERD_ENTRY), "utf8")]).toEqual(once);
  });

  it("refuses an unexpected version or export shape instead of guessing", () => {
    const other = copy();
    writeFileSync(path.join(other, "package.json"), JSON.stringify({ ...read(other), version: "0.21.0" }));
    expect(() => patchPdfkit(other)).toThrow(/expected pdfkit 0\.20\.1/);

    const odd = copy();
    setMain(odd, { default: BROWSER_BUILD });
    expect(() => patchPdfkit(odd)).toThrow(/unexpected shape/);
  });

  it("does nothing when pdfkit isn't installed", () => {
    expect(patchPdfkit(path.join(tmpdir(), "no-such-pdfkit-dir"))).toBe("not-installed");
  });
});
