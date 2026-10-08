-- F1.58 — derrota encerra a sessão NET na mesma transação que confirma a morte.
-- Mantém a infraestrutura de resolução existente; não cria um gateway paralelo.

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
  set actions_remaining = p_actions_after, combat_ammo = p_ammo_after
  where id = p_actor_id and combat_id = p_combat_id
    and actions_remaining = p_actions_before
    and combat_ammo is not distinct from p_ammo_before;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception using errcode = 'P0001', message = 'action_conflict'; end if;

  if p_target_patch <> '{}'::jsonb then
    update public.mesa_combatants
    set hp_current = coalesce((p_target_patch->>'hp_current')::integer, hp_current),
        is_dead = coalesce((p_target_patch->>'is_dead')::boolean, is_dead),
        combat_armor = coalesce(p_target_patch->'combat_armor', combat_armor),
        critical_injuries = coalesce(p_target_patch->'critical_injuries', critical_injuries)
    where id = p_target_id and combat_id = p_combat_id
      and hp_current = p_target_hp_before and is_dead = p_target_dead_before;
    get diagnostics changed = row_count;
    if changed <> 1 then raise exception using errcode = 'P0001', message = 'hp_conflict'; end if;
  end if;

  -- A defeated character cannot remain Jacked In or keep an ICE engagement.
  if (p_target_patch->>'is_dead')::boolean is true then
    update public.mesa_combatants
    set netrunner_state = coalesce(netrunner_state, '{}'::jsonb) || jsonb_build_object(
      'isJackedIn', false,
      'connectedAccessPointId', null,
      'connectionType', null,
      'architectureId', null,
      'currentFloor', null,
      'unsafeJackOut', false,
      'engagedBlackIceIds', '[]'::jsonb,
      'netActionsRemaining', 0,
      'meatspaceActionUsedForNetrunning', false
    )
    where id = p_target_id and combat_id = p_combat_id and kind = 'character';
  end if;

  if p_event_text is not null then
    update public.mesa_combats
    set event_log = (
      select coalesce(jsonb_agg(value order by ord), '[]'::jsonb)
      from jsonb_array_elements(event_log || jsonb_build_array(jsonb_build_object('at', now(), 'kind', 'action', 'text', p_event_text))) with ordinality as entries(value, ord)
      where ord > greatest(0, jsonb_array_length(event_log || jsonb_build_array(1)) - 50)
    ), updated_at = now()
    where id = p_combat_id and session_id = p_session_id;
  end if;

  update public.mesa_attack_resolutions
  set status = 'committed', result = p_result, updated_at = now(), committed_at = now()
  where id = resolution.id;
  return p_result;
end;
$$;

create or replace function public.commit_mesa_death_save_resolution(
  p_session_id uuid,
  p_combat_id uuid,
  p_resolution_id text,
  p_claim_token uuid,
  p_actor_id uuid,
  p_dc_before integer,
  p_dead_before boolean,
  p_failures_before integer,
  p_dc_after integer,
  p_failures_after integer,
  p_dead_after boolean,
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
  set death_save_dc = p_dc_after, death_save_failures = p_failures_after, is_dead = p_dead_after
  where id = p_actor_id and combat_id = p_combat_id and kind = 'character'
    and hp_current < 1 and is_dead = p_dead_before
    and death_save_dc = p_dc_before and death_save_failures = p_failures_before;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception using errcode = 'P0001', message = 'death_save_conflict'; end if;

  if p_dead_after then
    update public.mesa_combatants
    set netrunner_state = coalesce(netrunner_state, '{}'::jsonb) || jsonb_build_object(
      'isJackedIn', false,
      'connectedAccessPointId', null,
      'connectionType', null,
      'architectureId', null,
      'currentFloor', null,
      'unsafeJackOut', false,
      'engagedBlackIceIds', '[]'::jsonb,
      'netActionsRemaining', 0,
      'meatspaceActionUsedForNetrunning', false
    )
    where id = p_actor_id and combat_id = p_combat_id and kind = 'character';
  end if;

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
