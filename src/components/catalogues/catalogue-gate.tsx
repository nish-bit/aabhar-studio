import { IntegrationNotice } from "@/components/studio/integration-notice";

/** Shown when the catalogue builder's database or storage isn't configured. */
export function CatalogueSetupNotice() {
  return (
    <IntegrationNotice title="Catalogue builder not connected">
      Set <code>DATABASE_URL</code> (Supabase transaction pooler) along with the Supabase keys, and apply the migrations in{" "}
      <code>supabase/migrations</code>. See <code>docs/CATALOGUE_BUILDER.md</code>.
    </IntegrationNotice>
  );
}
