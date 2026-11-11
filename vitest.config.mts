import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // Keep Vite/Vitest caches out of node_modules: a running `next dev` (Turbopack)
  // watches node_modules and warns about frequent file updates there.
  cacheDir: path.resolve(import.meta.dirname, ".cache/vitest"),
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${path.resolve(import.meta.dirname, "src")}/` },
      // `server-only` throws outside React Server Components; it's a no-op in tests.
      { find: /^server-only$/, replacement: path.resolve(import.meta.dirname, "tests/support/server-only.ts") },
      // Same pdfkit entry the Cloudflare Worker gets (scripts/patch-pdfkit-workerd.mjs): the browser build, fonts registered.
      // Exact match only, so `pdfkit/standard-fonts/*` still resolves through pdfkit's exports.
      { find: /^pdfkit$/, replacement: path.resolve(import.meta.dirname, "node_modules/pdfkit/js/pdfkit.workerd.mjs") },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    restoreMocks: true,
    server: {
      // Transform react-pdf so the pdfkit alias above also applies to its own `import "pdfkit"`,
      // and pdfkit itself so the app and react-pdf share one instance (registered fonts live in it).
      deps: { inline: [/@react-pdf[\\/]/, /[\\/]pdfkit[\\/]/] },
    },
  },
});
