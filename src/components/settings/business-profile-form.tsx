"use client";

import * as React from "react";
import { ImageUp, Trash2 } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { catalogueApi } from "@/features/catalogues/api-client";
import type { BusinessProfileView } from "@/lib/catalogue";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Fields = Omit<BusinessProfileView, "logoUrl">;
const FIELDS: { key: keyof Fields; label: string; type?: string; max: number; autoComplete?: string; multiline?: boolean }[] = [
  { key: "businessName", label: "Business name", max: 120, autoComplete: "organization" },
  { key: "phone", label: "Phone", type: "tel", max: 40, autoComplete: "tel" },
  { key: "whatsapp", label: "WhatsApp", type: "tel", max: 40 },
  { key: "email", label: "Email", type: "email", max: 200, autoComplete: "email" },
  { key: "website", label: "Website", max: 200, autoComplete: "url" },
  { key: "address", label: "Address", max: 500, autoComplete: "street-address", multiline: true },
];

/** Business details used on catalogue covers and contact pages — only what the shop enters. */
export function BusinessProfileForm({ initial, canEdit }: { initial: BusinessProfileView; canEdit: boolean }) {
  const [values, setValues] = React.useState<Fields>(initial);
  const [logoUrl, setLogoUrl] = React.useState(initial.logoUrl);
  const [saving, setSaving] = React.useState(false);
  const [logoBusy, setLogoBusy] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: "success" | "error"; text: string } | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const dirty = FIELDS.some((f) => values[f.key] !== initial[f.key]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const saved = await catalogueApi.saveBusinessProfile(values);
      setValues(saved);
      setMessage({ tone: "success", text: "Business details saved." });
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Couldn't save." });
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (file: File) => {
    setLogoBusy(true);
    setMessage(null);
    try {
      const supabase = supabaseBrowser();
      if (!supabase) throw new Error("Storage isn't connected yet.");
      if (file.size > 2 * 1024 * 1024) throw new Error("Logos must be 2 MB or smaller.");
      const signed = await catalogueApi.signLogo(file.type, file.size);
      const { error } = await supabase.storage.from(signed.bucket).uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type });
      if (error) throw new Error("The upload didn't finish. Please try again.");
      const profile = await catalogueApi.completeLogo(signed.path);
      setLogoUrl(profile.logoUrl);
      setMessage({ tone: "success", text: "Logo updated." });
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Logo upload failed." });
    } finally {
      setLogoBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="max-w-2xl space-y-8">
      {message && <Alert tone={message.tone} live={message.tone === "error" ? "assertive" : "polite"}>{message.text}</Alert>}

      <section aria-labelledby="logo-title" className="rounded-md border border-ink-200 bg-surface p-5">
        <h2 id="logo-title" className="text-heading-sm font-semibold text-ink-900">Logo</h2>
        <p className="mt-1 text-body-sm text-ink-600">PNG with a transparent background works best. Up to 2 MB.</p>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <div className="flex h-20 w-48 items-center justify-center rounded-xs border border-ink-200 bg-surface-raised p-2">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="Your logo" className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="text-caption text-ink-500">No logo</span>
            )}
          </div>
          {canEdit && (
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()} loading={logoBusy} loadingLabel="Uploading…">
                <ImageUp aria-hidden /> {logoUrl ? "Replace" : "Upload logo"}
              </Button>
              {logoUrl && (
                <Button type="button" variant="ghost" disabled={logoBusy} onClick={async () => { const p = await catalogueApi.removeLogo(); setLogoUrl(p.logoUrl); }}>
                  <Trash2 aria-hidden /> Remove
                </Button>
              )}
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); e.target.value = ""; }} />
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="details-title" className="space-y-4 rounded-md border border-ink-200 bg-surface p-5">
        <div>
          <h2 id="details-title" className="text-heading-sm font-semibold text-ink-900">Business and contact details</h2>
          <p className="mt-1 text-body-sm text-ink-600">Shown on catalogue covers and contact pages. Leave anything blank that you don’t want printed.</p>
        </div>
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label htmlFor={`bp-${f.key}`} className="text-body-sm font-medium text-ink-900">{f.label}</label>
            {f.multiline ? (
              <Textarea id={`bp-${f.key}`} value={values[f.key]} maxLength={f.max} disabled={!canEdit} autoComplete={f.autoComplete}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} rows={3} className="mt-1.5" />
            ) : (
              <Input id={`bp-${f.key}`} type={f.type ?? "text"} value={values[f.key]} maxLength={f.max} disabled={!canEdit} autoComplete={f.autoComplete}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} className="mt-1.5" />
            )}
          </div>
        ))}
        {canEdit && (
          <div className="flex justify-end">
            <Button type="submit" loading={saving} loadingLabel="Saving…" disabled={!dirty}>Save details</Button>
          </div>
        )}
      </section>
    </form>
  );
}
