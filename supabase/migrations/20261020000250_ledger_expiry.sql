-- New ledger entry type for expired credits. Kept in its own migration
-- because Postgres can't use a new enum value in the transaction that adds it.
alter type public.ledger_type add value if not exists 'expiry';
