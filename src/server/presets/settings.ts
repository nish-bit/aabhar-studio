import { PRESET_SLUGS, PRESETS, type PresetSlug } from "@/lib/presets";
import type { Db } from "@/server/db/sql";

/**
 * Admin-controlled preset settings (enabled, credit cost). Prompts stay in
 * code. Rows missing from preset_settings use the code defaults.
 */
export type PresetSettings = Record<PresetSlug, { enabled: boolean; creditCost: number }>;

export function defaultPresetSettings(): PresetSettings {
  return Object.fromEntries(PRESET_SLUGS.map((s) => [s, { enabled: true, creditCost: PRESETS[s].creditCost }])) as PresetSettings;
}

export async function loadPresetSettings(db: Db): Promise<PresetSettings> {
  const settings = defaultPresetSettings();
  const rows = await db.query<{ slug: PresetSlug; enabled: boolean; creditCost: number }>(
    `select slug, enabled, credit_cost as "creditCost" from public.preset_settings`,
  );
  for (const r of rows) if (r.slug in settings) settings[r.slug] = { enabled: r.enabled, creditCost: r.creditCost };
  return settings;
}
