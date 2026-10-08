-- F1.54 — commit atômico de Pathfinder/Backdoor/Control. Reutiliza a tabela de
-- resoluções duráveis existente no combate, sem criar uma economia paralela.
create or replace function public.commit_mesa_net_action_resolution(
  p_session_id uuid,
  p_combat_id uuid,
  p_resolution_id text,
  p_claim_token uuid,
  p_actor_id uuid,
  p_actions_before integer,
  p_actions_after integer,
  p_actor_state_before jsonb,
  p_actor_state_after jsonb,
  p_discovery_before jsonb,
  p_discovery_after jsonb,
  p_architecture_before jsonb,
  p_architecture_after jsonb,
  p_result jsonb,
  p_event_text text,
  p_private_to_participant_id uuid
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
  set actions_remaining = p_actions_after,
      netrunner_state = p_actor_state_after,
      net_discovery = p_discovery_after
  where id = p_actor_id and combat_id = p_combat_id
    and actions_remaining = p_actions_before
    and netrunner_state is not distinct from p_actor_state_before
    and net_discovery is not distinct from p_discovery_before;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception using errcode = 'P0001', message = 'action_conflict'; end if;

  update public.mesa_sessions
  set net_architectures = p_architecture_after, updated_at = now()
  where id = p_session_id and net_architectures is not distinct from p_architecture_before;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception using errcode = 'P0001', message = 'architecture_conflict'; end if;

  update public.mesa_combats
  set event_log = (
    select coalesce(jsonb_agg(value order by ord), '[]'::jsonb)
    from jsonb_array_elements(event_log || jsonb_build_array(jsonb_build_object('at', now(), 'kind', 'action', 'text', p_event_text, 'privateToParticipantId', p_private_to_participant_id))) with ordinality as entries(value, ord)
    where ord > greatest(0, jsonb_array_length(event_log || jsonb_build_array(1)) - 50)
  ), updated_at = now()
  where id = p_combat_id and session_id = p_session_id;

  update public.mesa_attack_resolutions
  set status = 'committed', result = p_result, updated_at = now(), committed_at = now()
  where id = resolution.id;
  return p_result;
end;
$$;
