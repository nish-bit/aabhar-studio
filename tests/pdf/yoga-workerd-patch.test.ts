import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build, type Plugin } from "esbuild";
import { describe, expect, it, vi } from "vitest";

import { extractWasm, patchYoga, SUPPORTED_VERSION, WASM_FILE, WORKERD_LOADER, WORKERD_LOADER_SOURCE } from "../../scripts/patch-yoga-workerd.mjs";

/**
 * react-pdf's layout engine (yoga-layout) compiles WebAssembly at runtime, which
 * Cloudflare Workers forbid. scripts/patch-yoga-workerd.mjs gives the Worker a
 * loader that uses a precompiled module instead. These tests pin the patch, the
 * resolution the Worker bundle gets, the loader itself, and Node's unchanged path.
 */

// The resolution checks run real esbuild bundles; slow while the suite runs in parallel.
vi.setConfig({ testTimeout: 60_000 });

const root = path.resolve(import.meta.dirname, "../..");
const yogaDir = path.join(root, "node_modules/yoga-layout");
const readPkg = (dir: string) => JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));

/** Like OpenNext's wrangler-externals plugin: `.wasm` imports stay external, as absolute paths, for Wrangler. */
const wranglerExternals: Plugin = {
  name: "wrangler-externals",
  setup(b) {
    b.onResolve({ filter: /\.wasm(\?module)?$/ }, ({ path: p, importer }) => ({ path: path.resolve(path.dirname(importer), p), external: true }));
  },
};

async function bundleYogaLoad(conditions: string[] | undefined) {
  const result = await build({
    stdin: { contents: `export { loadYoga } from "yoga-layout/load";`, resolveDir: root, loader: "js" },
    bundle: true,
    write: false,
    metafile: true,
    // OpenNext's settings for the Worker's server bundle.
    platform: "node",
    format: "esm",
    ...(conditions ? { conditions } : {}),
    plugins: [wranglerExternals],
    logLevel: "silent",
  });
  const inputs = Object.keys(result.metafile.inputs).filter((f) => f.includes("yoga-layout/"));
  return { inputs: inputs.map((f) => f.split("yoga-layout/")[1]), code: result.outputFiles[0]!.text };
}

describe("yoga workerd patch (installed copy)", () => {
  it("is applied to exactly yoga-layout 3.2.1", () => {
    const pkg = readPkg(yogaDir);
    expect(pkg.version, "yoga-layout version changed: review scripts/patch-yoga-workerd.mjs").toBe(SUPPORTED_VERSION);
    expect(pkg.exports, "run `node scripts/patch-yoga-workerd.mjs` (it normally runs on npm install)").toEqual({
      ".": "./dist/src/index.js",
      "./load": { workerd: `./${WORKERD_LOADER}`, default: "./dist/src/load.js" },
    });
    expect(readFileSync(path.join(yogaDir, WORKERD_LOADER), "utf8")).toBe(WORKERD_LOADER_SOURCE);
  });

  it("extracts the embedded binary byte for byte, as valid WebAssembly", () => {
    const embedded = readFileSync(path.join(yogaDir, "dist/binaries/yoga-wasm-base64-esm.js"), "utf8");
    const wasm = readFileSync(path.join(yogaDir, WASM_FILE));
    expect(wasm.equals(extractWasm(embedded))).toBe(true);
    expect(WebAssembly.validate(new Uint8Array(wasm))).toBe(true);
  });

  it("makes OpenNext's esbuild settings (conditions [workerd]) pick the precompiled-module loader and leave yoga.wasm to Wrangler", async () => {
    const { inputs, code } = await bundleYogaLoad(["workerd"]);
    expect(inputs).toContain(WORKERD_LOADER);
    expect(inputs).not.toContain("dist/src/load.js");
    expect(code).toMatch(/from\s*"[^"]*yoga-layout[\\/]+dist[\\/]+binaries[\\/]+yoga\.wasm"/);
  });

  it("leaves Node on the original loader", async () => {
    const { inputs, code } = await bundleYogaLoad(undefined);
    expect(inputs).toContain("dist/src/load.js");
    expect(inputs).not.toContain(WORKERD_LOADER);
    expect(code).not.toContain("yoga.wasm");
    expect(path.basename(createRequire(import.meta.url).resolve("yoga-layout/load"))).toBe("load.js");
  });

  it("runs real layouts through the generated loader with a precompiled module (as Workers does)", async () => {
    // Copy the loader next to a stand-in for Wrangler's CompiledWasm module, then import it.
    const dir = mkdtempSync(path.join(tmpdir(), "yoga-workerd-"));
    cpSync(path.join(yogaDir, "dist"), path.join(dir, "dist"), { recursive: true });
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ type: "module" }));
    const compiled = await WebAssembly.compile(new Uint8Array(readFileSync(path.join(yogaDir, WASM_FILE))));
    (globalThis as Record<string, unknown>).__yogaTestModule = compiled;
    writeFileSync(path.join(dir, "dist/binaries/yoga.wasm.mjs"), "export default globalThis.__yogaTestModule;\n");
    writeFileSync(path.join(dir, WORKERD_LOADER), WORKERD_LOADER_SOURCE.replace('"../binaries/yoga.wasm"', '"../binaries/yoga.wasm.mjs"'));

    // Fail if anything tries to compile WebAssembly from bytes at runtime, as Workers would.
    const instantiate = WebAssembly.instantiate;
    const spy = vi.spyOn(WebAssembly, "instantiate").mockImplementation(((source: unknown, imports?: WebAssembly.Imports) => {
      if (!(source instanceof WebAssembly.Module)) throw new Error("runtime WebAssembly compilation (forbidden on Workers)");
      return instantiate(source, imports);
    }) as typeof WebAssembly.instantiate);
    try {
      const { loadYoga } = await import(/* @vite-ignore */ pathToFileURL(path.join(dir, WORKERD_LOADER)).href);
      const Yoga = await loadYoga();
      const rootNode = Yoga.Node.create();
      rootNode.setWidth(300);
      rootNode.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
      const child = Yoga.Node.create();
      child.setFlexGrow(1);
      rootNode.insertChild(child, 0);
      rootNode.calculateLayout(undefined, undefined, Yoga.DIRECTION_LTR);
      expect(child.getComputedWidth()).toBe(300);
      rootNode.freeRecursive();
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("patchYoga (on temporary copies)", () => {
  const copy = () => {
    const dir = path.join(mkdtempSync(path.join(tmpdir(), "yoga-")), "yoga-layout");
    cpSync(yogaDir, dir, { recursive: true });
    return dir;
  };
  const unpatch = (dir: string) => {
    const pkg = readPkg(dir);
    pkg.exports = { ".": "./dist/src/index.js", "./load": "./dist/src/load.js" };
    writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
    writeFileSync(path.join(dir, WORKERD_LOADER), "");
    writeFileSync(path.join(dir, WASM_FILE), "");
  };

  it("patches a clean copy, and running it again changes nothing", () => {
    const dir = copy();
    unpatch(dir);
    expect(patchYoga(dir)).toBe("patched");
    const snapshot = [readFileSync(path.join(dir, "package.json")), readFileSync(path.join(dir, WASM_FILE)), readFileSync(path.join(dir, WORKERD_LOADER))];
    expect(patchYoga(dir)).toBe("already-patched");
    expect([readFileSync(path.join(dir, "package.json")), readFileSync(path.join(dir, WASM_FILE)), readFileSync(path.join(dir, WORKERD_LOADER))]).toEqual(snapshot);
    expect(readPkg(dir).exports["./load"]).toEqual({ workerd: `./${WORKERD_LOADER}`, default: "./dist/src/load.js" });
  });

  it("repairs a damaged or stale yoga.wasm", () => {
    const dir = copy();
    writeFileSync(path.join(dir, WASM_FILE), "not wasm");
    expect(patchYoga(dir)).toBe("patched");
    expect(readFileSync(path.join(dir, WASM_FILE)).equals(readFileSync(path.join(yogaDir, WASM_FILE)))).toBe(true);
  });

  it("refuses another version or an unexpected export shape", () => {
    const other = copy();
    writeFileSync(path.join(other, "package.json"), JSON.stringify({ ...readPkg(other), version: "3.2.2" }));
    expect(() => patchYoga(other)).toThrow(/expected yoga-layout 3\.2\.1/);

    const odd = copy();
    writeFileSync(path.join(odd, "package.json"), JSON.stringify({ ...readPkg(odd), exports: { ".": "./dist/src/index.js" } }));
    expect(() => patchYoga(odd)).toThrow(/unexpected shape/);
  });

  it("does nothing when yoga-layout isn't installed", () => {
    expect(patchYoga(path.join(tmpdir(), "no-such-yoga-dir"))).toBe("not-installed");
  });
});
