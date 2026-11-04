-- Generator options chosen in the studio: the jewellery type (step 1) and the
-- photo size (step 4). Both optional; jobs without them keep the original
-- behaviour (output frame from the photo's shape, no type hint).
--
-- Set by the server right after create_generation_job, before the job is
-- run; create_generation_job itself is unchanged. Additive only.
alter table public.generation_jobs
  add column photo_size     text check (photo_size in ('3:4', '1:1', '16:9', '9:16')),
  add column jewellery_type text check (jewellery_type in
    ('jewellery_set', 'bracelet', 'earring', 'ring', 'bangles', 'necklace', 'pendant', 'payal', 'maang_teeka'));
