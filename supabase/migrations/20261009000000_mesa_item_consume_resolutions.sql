-- F1.13.1 — resolução atômica e idempotente de consumo de item na Mesa.
-- Mesmo molde de `mesa_reload_resolutions`: claim/commit/release com
-- CAS em `mesa_combatants.supplies` para dois requests concorrentes
-- nunca consumirem a mesma unidade.

create table if not exists public.mesa_item_consume_resolutions (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.mesa_sessions(id) on delete cascade,
  combat_id     uuid not null references public.mesa_combats(id) on delete cascade,
  resolution_id text not null,
  claim_token   uuid not null default gen_random_uuid(),
  status        text not null check (status in ('processing', 'committed', 'failed')),
  result        jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  committed_at  timestamptz,
  unique (session_id, combat_id, resolution_id)
);

create index if not exists mesa_item_consume_resolutions_lookup_idx
  on public.mesa_item_consume_resolutions (session_id, resolution_id);

alter table public.mesa_item_consume_resolutions enable row level security;

create or replace function public.claim_mesa_item_consume_resolution(
  p_session_id uuid,
  p_combat_id uuid,
  p_resolution_id text
) returns table (claimed boolean, status text, claim_token uuid, result jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted public.mesa_item_consume_resolutions%rowtype;
  existing public.mesa_item_consume_resolutions%rowtype;
begin
  insert into public.mesa_item_consume_resolutions (session_id, combat_id, resolution_id, status, updated_at)
  values (p_session_id, p_combat_id, p_resolution_id, 'processing', now())
  on conflict (session_id, combat_id, resolution_id) do nothing
  returning * into inserted;

  if inserted.id is not null then
    return query select true, inserted.status, inserted.claim_token, inserted.result;
    return;
  end if;

  select * into existing
  from public.mesa_item_consume_resolutions
  where session_id = p_session_id
    and combat_id = p_combat_id
    and resolution_id = p_resolution_id
  for update;

  if existing.status = 'processing'
     and existing.updated_at < now() - interval '30 seconds' then
    update public.mesa_item_consume_resolutions
    set status = 'failed', updated_at = now()
    where id = existing.id;
    existing.status := 'failed';
  end if;

  return query select false, existing.status, existing.claim_token, existing.result;
end;
$$;

create or replace function public.commit_mesa_item_consume_resolution(
  p_session_id uuid,
  p_combat_id uuid,
  p_resolution_id text,
  p_claim_token uuid,
  p_actor_id uuid,
  p_actions_before integer,
  p_actions_after integer,
  p_supplies_before jsonb,
  p_supplies_after jsonb,
  p_item_name text,
  p_amount integer,
  p_result jsonb,
  p_event_text text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  resolution public.mesa_item_consume_resolutions%rowtype;
  combat public.mesa_combats%rowtype;
  changed integer;
begin
  select * into resolution
  from public.mesa_item_consume_resolutions
  where session_id = p_session_id
    and combat_id = p_combat_id
    and resolution_id = p_resolution_id
  for update;

  if resolution.id is null then
    raise exception using errcode = 'P0001', message = 'resolution_not_claimed';
  end if;
  if resolution.status = 'committed' then
    return p_result;
  end if;
  if resolution.status = 'failed' then
    raise exception using errcode = 'P0001', message = 'resolution_failed';
  end if;
  if resolution.claim_token <> p_claim_token then
    raise exception using errcode = 'P0001', message = 'resolution_in_progress';
  end if;
  if p_actions_before < 1
     or p_actions_after <> p_actions_before - 1
     or p_amount <= 0 then
    raise exception using errcode = 'P0001', message = 'consumption_invalid_state';
  end if;

  select * into combat
  from public.mesa_combats
  where id = p_combat_id and session_id = p_session_id
  for update;

  if combat.id is null or combat.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'consumption_not_active';
  end if;
  if combat.active_combatant_id is distinct from p_actor_id then
    raise exception using errcode = 'P0001', message = 'not_your_turn';
  end if;

  update public.mesa_combatants
  set actions_remaining = p_actions_after,
      supplies = p_supplies_after
  where id = p_actor_id
    and combat_id = p_combat_id
    and actions_remaining = p_actions_before
    and actions_remaining >= 1
    and is_dead = false
    and supplies is not distinct from p_supplies_before;
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception using errcode = 'P0001', message = 'consumption_conflict';
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
    ), updated_at = now()
    where id = p_combat_id and session_id = p_session_id;
  end if;

  update public.mesa_item_consume_resolutions
  set status = 'committed', result = p_result, updated_at = now(), committed_at = now()
  where id = resolution.id;

  return p_result;
end;
$$;

create or replace function public.release_mesa_item_consume_resolution(
  p_session_id uuid,
  p_combat_id uuid,
  p_resolution_id text,
  p_claim_token uuid
) returns void
language sql
security definer
set search_path = public
as $$
  update public.mesa_item_consume_resolutions
  set status = 'failed', updated_at = now()
  where session_id = p_session_id
    and combat_id = p_combat_id
    and resolution_id = p_resolution_id
    and claim_token = p_claim_token
    and status = 'processing';
$$;
