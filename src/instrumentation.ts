import type { Instrumentation } from "next";

/**
 * Server-side error reporting. Every uncaught error in a page, route
 * handler or server action is logged as one structured JSON line, which
 * Vercel (or a log drain to Sentry, Datadog, Better Stack…) can alert on.
 * Only the path is logged — never query strings, headers, cookies or bodies.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const e = err as Error & { digest?: string };
  console.error(
    JSON.stringify({
      event: "request.error",
      digest: e.digest ?? null,
      message: e.message?.slice(0, 500),
      name: e.name,
      method: request.method,
      path: request.path.split("?")[0],
      routePath: context.routePath,
      routeType: context.routeType,
      renderSource: "renderSource" in context ? context.renderSource : undefined,
      release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null,
    }),
  );
};
