-- Free trial set to exactly 3 credits for new sign-ups (approved 1 Nov 2026).
-- Matches TRIAL.credits in src/config/billing.ts. Sets 3 whatever the current
-- value is, so every new sign-up gets exactly 3. The sign-up trigger
-- (app.handle_new_user) is unchanged and still grants once per shop.
-- Existing grants, balances and ledger entries are not touched.
alter table public.billing_settings alter column trial_credits set default 3;
update public.billing_settings set trial_credits = 3, updated_at = now() where id;
