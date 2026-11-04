import { formatCount, formatPaise } from "@/lib/format";

const dt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
const d = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

export const fmtDateTime = (iso: string | null | undefined) => (iso ? dt.format(new Date(iso)) : "—");
export const fmtDate = (iso: string | null | undefined) => (iso ? d.format(new Date(iso)) : "—");
export const fmtInr = (paise: number | null | undefined) => (paise == null ? "—" : formatPaise(paise));
export const fmtCount = (n: number | null | undefined) => (n == null ? "—" : formatCount(n));
/** Provider costs are stored in micro-dollars. */
export const fmtUsd = (micros: number | null | undefined) =>
  micros == null ? "—" : `$${(micros / 1_000_000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: micros < 100_000 ? 4 : 2 })}`;
export const fmtMs = (ms: number | null | undefined) => (ms == null ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
export const fmtPct = (x: number | null | undefined) => (x == null ? "—" : `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`);
export const shortId = (id: string) => id.slice(0, 8);
