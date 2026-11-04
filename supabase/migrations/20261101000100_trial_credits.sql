-- Free trial reduced from 10 to 7 credits for new sign-ups.
-- Matches TRIAL.credits in src/config/billing.ts. Only rows still on the old
-- default change, so a trial an admin already set by hand is left alone.
-- Existing grants, balances and ledger entries are not touched.
alter table public.billing_settings alter column trial_credits set default 7;
update public.billing_settings set trial_credits = 7, updated_at = now() where id and trial_credits = 10;
