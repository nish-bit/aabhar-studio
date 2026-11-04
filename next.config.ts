import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Content-Security-Policy for pages. Next.js needs inline scripts for
 * hydration (nonces would make every page dynamic). Razorpay Checkout loads
 * from checkout.razorpay.com and opens frames on *.razorpay.com; Supabase
 * serves auth, realtime and signed storage URLs from the project domain.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://checkout.razorpay.com${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co https://*.razorpay.com",
  "font-src 'self' data:",
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.razorpay.com${isDev ? " ws:" : ""}`,
  "frame-src 'self' https://*.supabase.co https://*.razorpay.com",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self \"https://checkout.razorpay.com\" \"https://api.razorpay.com\")" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Pages only: API responses are JSON/PDF/ZIP and carry their own Content-Type.
      { source: "/((?!api/).*)", headers: [{ key: "Content-Security-Policy", value: csp }] },
      { source: "/admin/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Cache-Control", value: "private, no-store" }] },
    ];
  },
  /* config options here */
  images: {
    // Style gallery previews (/styles), fetched and resized by the image optimizer.
    remotePatterns: [new URL("https://gehnaphoto.com/assets/style_previews/**")],
  },
  cacheComponents: true,
  partialPrefetching: true,
  // PDF fonts are read from disk at runtime; make sure they ship with these routes.
  outputFileTracingIncludes: {
    "/api/catalogues/**": ["./src/server/pdf/fonts/**/*"],
    "/api/billing/**": ["./src/server/pdf/fonts/**/*"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
