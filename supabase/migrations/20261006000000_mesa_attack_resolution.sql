-- F1.7.16 — claim/commit transacional da resolução integrada.
-- O Engine continua sendo executado no servidor TypeScript; esta RPC é a
-- fronteira atômica que grava todos os efeitos que o Engine produziu.

create table if not exists public.mesa_attack_resolutions (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid not null references public.mesa_sessions(id) on delete cascade,
  combat_id         uuid not null references public.mesa_combats(id) on delete cascade,
  resolution_id     text not null,
  claim_token       uuid not null default gen_random_uuid(),
  status            text not null check (status in ('processing', 'committed', 'failed')),
  result            jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  committed_at      timestamptz,
  unique (session_id, combat_id, resolution_id)
);

create index if not exists mesa_attack_resolutions_lookup_idx
  on public.mesa_attack_resolutions (session_id, resolution_id);

alter table public.mesa_attack_resolutions enable row level security;

create or replace function public.claim_mesa_attack_resolution(
  p_session_id uuid,
  p_combat_id uuid,
  p_resolution_id text
)
returns table (claimed boolean, status text, claim_token uuid, result jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted public.mesa_attack_resolutions%rowtype;
  existing public.mesa_attack_resolutions%rowtype;
begin
  insert into public.mesa_attack_resolutions (session_id, combat_id, resolution_id, status)
  values (p_session_id, p_combat_id, p_resolution_id, 'processing')
  on conflict (session_id, combat_id, resolution_id) do nothing
  returning * into inserted;

  if inserted.id is not null then
    return query select true, inserted.status, inserted.claim_token, inserted.result;
    return;
  end if;

  select * into existing
  from public.mesa_attack_resolutions r
  where r.session_id = p_session_id
    and r.combat_id = p_combat_id
    and r.resolution_id = p_resolution_id
  for update;

  if existing.status = 'processing'
     and existing.updated_at < now() - interval '30 seconds' then
    update public.mesa_attack_resolutions
    set status = 'failed', updated_at = now()
    where id = existing.id;
    existing.status := 'failed';
  end if;

  return query select false, existing.status, existing.claim_token, existing.result;
end;
$$;

create or replace function public.recover_mesa_attack_resolution(
  p_session_id uuid,
  p_combat_id uuid,
  p_resolution_id text
)
returns table (status text, result jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  resolution public.mesa_attack_resolutions%rowtype;
begin
  select * into resolution
  from public.mesa_attack_resolutions
  where session_id = p_session_id
    and combat_id = p_combat_id
    and resolution_id = p_resolution_id
  for update;

  if resolution.id is null then
    return query select 'missing'::text, null::jsonb;
    return;
  end if;

  if resolution.status = 'processing'
     and resolution.updated_at < now() - interval '30 seconds' then
    update public.mesa_attack_resolutions
    set status = 'failed', updated_at = now()
    where id = resolution.id;
    resolution.status := 'failed';
  end if;

  return query select resolution.status, resolution.result;
end;
$$;

create or replace function public.commit_mesa_attack_resolution(
  p_session_id uuid,
  p_combat_id uuid,
  p_resolution_id text,
  p_claim_token uuid,
  p_actor_id uuid,
  p_target_id uuid,
  p_actions_before integer,
  p_actions_after integer,
  p_ammo_before jsonb,
  p_ammo_after jsonb,
  p_target_hp_before integer,
  p_target_dead_before boolean,
  p_target_patch jsonb,
  p_result jsonb,
  p_event_text text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  resolution public.mesa_attack_resolutions%rowtype;
  changed integer;
  next_log jsonb;
begin
  select * into resolution
  from public.mesa_attack_resolutions
  where session_id = p_session_id
    and combat_id = p_combat_id
    and resolution_id = p_resolution_id
  for update;

  if resolution.id is null then
    raise exception using errcode = 'P0001', message = 'resolution_not_claimed';
  end if;
  if resolution.status = 'committed' then
    return resolution.result;
  end if;
  if resolution.status = 'failed' then
    raise exception using errcode = 'P0001', message = 'resolution_failed';
  end if;
  if resolution.claim_token <> p_claim_token then
    raise exception using errcode = 'P0001', message = 'resolution_in_progress';
  end if;

  update public.mesa_combatants
  set actions_remaining = p_actions_after,
      combat_ammo = p_ammo_after
  where id = p_actor_id
    and combat_id = p_combat_id
    and actions_remaining = p_actions_before
    and combat_ammo is not distinct from p_ammo_before;
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception using errcode = 'P0001', message = 'action_conflict';
  end if;

  if p_target_patch <> '{}'::jsonb then
    update public.mesa_combatants
    set hp_current = coalesce((p_target_patch->>'hp_current')::integer, hp_current),
        is_dead = coalesce((p_target_patch->>'is_dead')::boolean, is_dead),
        combat_armor = coalesce(p_target_patch->'combat_armor', combat_armor),
        critical_injuries = coalesce(p_target_patch->'critical_injuries', critical_injuries)
    where id = p_target_id
      and combat_id = p_combat_id
      and hp_current = p_target_hp_before
      and is_dead = p_target_dead_before;
    get diagnostics changed = row_count;
    if changed <> 1 then
      raise exception using errcode = 'P0001', message = 'hp_conflict';
    end if;
  end if;

  if p_event_text is not null then
    update public.mesa_combats
    set event_log = (
      select coalesce(jsonb_agg(value order by ord), '[]'::jsonb)
      from jsonb_array_elements(
        event_log || jsonb_build_array(jsonb_build_object(
          'at', now(), 'kind', 'action', 'text', p_event_text
        ))
      ) with ordinality as entries(value, ord)
      where ord > greatest(0, jsonb_array_length(event_log || jsonb_build_array(1)) - 50)
    ),
    updated_at = now()
    where id = p_combat_id and session_id = p_session_id;
  end if;

  update public.mesa_attack_resolutions
  set status = 'committed', result = p_result, updated_at = now(), committed_at = now()
  where id = resolution.id;

  return p_result;
end;
$$;

create or replace function public.release_mesa_attack_resolution(
  p_session_id uuid,
  p_combat_id uuid,
  p_resolution_id text,
  p_claim_token uuid
)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.mesa_attack_resolutions
  where session_id = p_session_id
    and combat_id = p_combat_id
    and resolution_id = p_resolution_id
    and claim_token = p_claim_token
    and status = 'processing';
$$;
