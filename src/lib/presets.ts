/**
 * Public metadata for editing presets (safe for the browser).
 * Prompt text lives server-side in src/server/generation/prompts.ts.
 */
export const PRESET_SLUGS = [
  "white-studio",
  "warm-ivory",
  "black-luxury",
  "velvet",
  "marble",
  "editorial",
] as const;

export type PresetSlug = (typeof PRESET_SLUGS)[number];

export interface PresetInfo {
  slug: PresetSlug;
  name: string;
  description: string;
  creditCost: number;
  /** Bumped whenever the prompt changes, and stored on each job. */
  version: number;
  /** Swatch colours for the preset picker (no imagery, so nothing is implied about results). */
  swatch: { background: string; accent: string };
}

export const PRESETS: Record<PresetSlug, PresetInfo> = {
  "white-studio": {
    slug: "white-studio",
    name: "White Studio",
    description: "Pure white background, soft even light, gentle contact shadow. Marketplace-ready.",
    creditCost: 1,
    version: 1,
    swatch: { background: "#ffffff", accent: "#e6dfd3" },
  },
  "warm-ivory": {
    slug: "warm-ivory",
    name: "Warm Ivory",
    description: "Soft cream backdrop with warm, flattering light for gold.",
    creditCost: 1,
    version: 1,
    swatch: { background: "#f4efe6", accent: "#d8bc82" },
  },
  "black-luxury": {
    slug: "black-luxury",
    name: "Black Luxury",
    description: "Deep charcoal ground with controlled highlights for diamonds and polki.",
    creditCost: 1,
    version: 1,
    swatch: { background: "#161412", accent: "#5e5850" },
  },
  velvet: {
    slug: "velvet",
    name: "Velvet",
    description: "Black velvet display surface with soft fabric texture.",
    creditCost: 2,
    version: 1,
    swatch: { background: "#232026", accent: "#45413b" },
  },
  marble: {
    slug: "marble",
    name: "Marble",
    description: "Polished white marble with subtle grey veining and daylight.",
    creditCost: 2,
    version: 1,
    swatch: { background: "#eeebe6", accent: "#a39b8f" },
  },
  editorial: {
    slug: "editorial",
    name: "Editorial",
    description: "Magazine-style still life with window light and soft, out-of-focus props.",
    creditCost: 2,
    version: 1,
    swatch: { background: "#d9cbb4", accent: "#8e6d36" },
  },
};

export function isPresetSlug(value: string): value is PresetSlug {
  return (PRESET_SLUGS as readonly string[]).includes(value);
}

/** Per-shop view of each preset: admin settings plus whether the shop's plan includes it. */
export type PresetAvailability = Record<PresetSlug, { enabled: boolean; creditCost: number; allowed: boolean }>;

export function defaultAvailability(): PresetAvailability {
  return Object.fromEntries(PRESET_SLUGS.map((s) => [s, { enabled: true, creditCost: PRESETS[s].creditCost, allowed: true }])) as PresetAvailability;
}

export function firstUsablePreset(a: PresetAvailability): PresetSlug {
  return PRESET_SLUGS.find((s) => a[s].enabled && a[s].allowed) ?? "white-studio";
}
