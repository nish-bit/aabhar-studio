const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/** Format an amount stored in paise as Indian rupees, e.g. 149900 → "₹1,499". */
export function formatPaise(paise: number): string {
  return inr.format(Math.round(paise / 100));
}

const inrExact = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Paise as rupees with paise shown, for per-unit prices, e.g. 7495 → "₹74.95". */
export function formatPaiseExact(paise: number): string {
  return inrExact.format(paise / 100);
}

/** Indian digit grouping for plain counts, e.g. 12000 → "12,000". */
export function formatCount(n: number): string {
  return new Intl.NumberFormat("en-IN").format(n);
}
