-- Toolkit IDs are stable in the browser, but ownership is part of the
-- identity on the server. The old primary key on `id` made importing a
-- catalog from a second browser/profile fail even when the owner differed.
alter table public.mesa_toolkit_records
  drop constraint if exists mesa_toolkit_records_pkey;

alter table public.mesa_toolkit_records
  add constraint mesa_toolkit_records_pkey primary key (id, owner_token, kind);
