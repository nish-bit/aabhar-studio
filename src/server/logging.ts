/**
 * Structured server logs that are safe to keep: values are scrubbed of URLs
 * (connection strings), email addresses and key- or token-shaped strings, and
 * kept short. Ids such as pay_… / order_… / UUIDs and amounts pass through.
 */

export type LogLevel = "error" | "warn" | "info";
export type LogFn = (event: string, data: Record<string, unknown>) => void;

const MAX_VALUE = 200;

/** Removes anything that could be a credential or personal data from free text, and shortens it. */
export function scrubText(text: string, max = MAX_VALUE): string {
  return text
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>")
    .replace(/[^\s@:/"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+/g, "<email>")
    .replace(/\b(?:eyJ[A-Za-z0-9_-]*|sb_(?:secret|publishable)_|sk-|rzp_(?:test|live)_)[A-Za-z0-9._-]*/g, "<token>")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, max);
}

/** An error for logs: its name and scrubbed message. */
export function sanitizedError(err: unknown): string {
  return scrubText(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
}

/** Scrubs every string in a log payload (one level deep; nested objects are stringified first). */
export function sanitizeLogData(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).map(([k, v]) => {
      if (v instanceof Error) return [k, sanitizedError(v)];
      if (typeof v === "string") return [k, scrubText(v)];
      if (v !== null && typeof v === "object") return [k, scrubText(JSON.stringify(v))];
      return [k, v];
    }),
  );
}

/**
 * Writes one JSON log line at the given level (console.error lines are what Workers Logs alerts on).
 * `event` and `level` always describe the log line itself: a payload field named `event` (e.g. the
 * Razorpay event type) is kept as `eventType` instead of overwriting the log's event name.
 */
export function writeLog(level: LogLevel, event: string, data: Record<string, unknown>): void {
  const rest = sanitizeLogData(data);
  const inner = rest.event;
  delete rest.event;
  delete rest.level;
  const line = JSON.stringify({ ...(inner === undefined ? {} : { eventType: inner }), ...rest, event, level });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}
