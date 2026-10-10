create table if not exists public.mesa_toolkit_records (
  id text primary key,
  owner_token text not null,
  kind text not null check (kind in ('character', 'enemy', 'encounter')),
  name text not null,
  payload jsonb not null,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mesa_toolkit_records_owner_kind_updated_idx
  on public.mesa_toolkit_records (owner_token, kind, updated_at desc);

create or replace function public.mesa_toolkit_records_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists mesa_toolkit_records_touch on public.mesa_toolkit_records;
create trigger mesa_toolkit_records_touch
before update on public.mesa_toolkit_records
for each row execute function public.mesa_toolkit_records_touch_updated_at();

-- This project uses the service-role adapter server-side. RLS remains enabled
-- so a future client role cannot read private GM/catalog rows by accident.
alter table public.mesa_toolkit_records enable row level security;
