-- Free trial set to 2 generations for new sign-ups (approved 3 Nov 2026).
-- Matches TRIAL.credits / FREE_TRIAL_LIMIT in src/config/billing.ts. The
-- trial stays a one-time keyed credit grant from app.handle_new_user /
-- public.ensure_user_shop, so it can't be granted twice and survives
-- sign-out, refresh and new browsers. Existing accounts keep the trial
-- credits they already have: no grants, balances or ledger rows change.
alter table public.billing_settings alter column trial_credits set default 2;
update public.billing_settings set trial_credits = 2, updated_at = now() where id;
