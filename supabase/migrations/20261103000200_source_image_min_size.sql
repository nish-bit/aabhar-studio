-- Accept product photos of any size. The original 800 px minimum on the
-- shortest side is removed (the app no longer rejects smaller photos); the
-- 12,000 px maximum stays, along with the 40 MP limit enforced in the app.
-- Only relaxes a rule, so existing rows already satisfy the new one.
alter table public.source_images
  drop constraint if exists source_images_width_check,
  drop constraint if exists source_images_height_check,
  add constraint source_images_width_check check (width between 1 and 12000),
  add constraint source_images_height_check check (height between 1 and 12000);
