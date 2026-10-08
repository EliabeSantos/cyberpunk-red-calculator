-- F1.51 — contratos persistíveis das fundações de Netrunner.
-- Access Points vivem no JSON já persistido de mesa_sessions.tactical_map;
-- a conexão mutável do combatente recebe sua própria coluna server-authoritative.

alter table public.mesa_combatants
  add column if not exists netrunner_state jsonb not null default jsonb_build_object(
    'isJackedIn', false,
    'connectedAccessPointId', null,
    'connectionType', null,
    'architectureId', null,
    'currentFloor', null,
    'unsafeJackOut', false,
    'engagedBlackIceIds', '[]'::jsonb,
    'interfaceRank', 0,
    'ramCurrent', 0,
    'ramMax', 0,
    'netActionsRemaining', 0,
    'netActionsMax', 0,
    'meatspaceActionUsedForNetrunning', false,
    'cyberdeckSlots', 0,
    'maxQuickhackSlots', 4,
    'equippedQuickhackIds', '[]'::jsonb
  );

alter table public.mesa_combatants
  add column if not exists net_effects jsonb not null default '[]'::jsonb;

comment on column public.mesa_combatants.netrunner_state is
  'F1.51 server-authoritative Jack In/Safe Jack Out/Unsafe Jack Out state';

comment on column public.mesa_combatants.net_effects is
  'F1.52 server-authoritative temporary Quickhack effects';

create or replace function public.commit_mesa_quickhack_resolution(
  p_session_id uuid,
  p_combat_id uuid,
  p_resolution_id text,
  p_claim_token uuid,
  p_actor_id uuid,
  p_target_id uuid,
  p_actions_before integer,
  p_actions_after integer,
  p_actor_state_before jsonb,
  p_actor_state_after jsonb,
  p_target_hp_before integer,
  p_target_dead_before boolean,
  p_target_patch jsonb,
  p_target_effects jsonb,
  p_target_conditions jsonb,
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
begin
  select * into resolution
  from public.mesa_attack_resolutions
  where session_id = p_session_id and combat_id = p_combat_id and resolution_id = p_resolution_id
  for update;
  if resolution.id is null then raise exception using errcode = 'P0001', message = 'resolution_not_claimed'; end if;
  if resolution.status = 'committed' then return resolution.result; end if;
  if resolution.status = 'failed' then raise exception using errcode = 'P0001', message = 'resolution_failed'; end if;
  if resolution.claim_token <> p_claim_token then raise exception using errcode = 'P0001', message = 'resolution_in_progress'; end if;

  update public.mesa_combatants
  set actions_remaining = p_actions_after, netrunner_state = p_actor_state_after
  where id = p_actor_id and combat_id = p_combat_id
    and actions_remaining = p_actions_before
    and netrunner_state is not distinct from p_actor_state_before;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception using errcode = 'P0001', message = 'action_conflict'; end if;

  update public.mesa_combatants
  set hp_current = coalesce((p_target_patch->>'hp_current')::integer, hp_current),
      is_dead = coalesce((p_target_patch->>'is_dead')::boolean, is_dead),
      combat_armor = coalesce(p_target_patch->'combat_armor', combat_armor),
      critical_injuries = coalesce(p_target_patch->'critical_injuries', critical_injuries),
      net_effects = p_target_effects,
      conditions = p_target_conditions
  where id = p_target_id and combat_id = p_combat_id
    and hp_current = p_target_hp_before and is_dead = p_target_dead_before;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception using errcode = 'P0001', message = 'hp_conflict'; end if;

  update public.mesa_combats
  set event_log = (
    select coalesce(jsonb_agg(value order by ord), '[]'::jsonb)
    from jsonb_array_elements(event_log || jsonb_build_array(jsonb_build_object('at', now(), 'kind', 'action', 'text', p_event_text))) with ordinality as entries(value, ord)
    where ord > greatest(0, jsonb_array_length(event_log || jsonb_build_array(1)) - 50)
  ), updated_at = now()
  where id = p_combat_id and session_id = p_session_id;

  update public.mesa_attack_resolutions
  set status = 'committed', result = p_result, updated_at = now(), committed_at = now()
  where id = resolution.id;
  return p_result;
end;
$$;
