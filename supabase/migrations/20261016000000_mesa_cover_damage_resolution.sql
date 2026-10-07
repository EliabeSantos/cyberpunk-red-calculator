-- F1.43: atomic Cover HP damage commit using the existing attack resolution claim.
create or replace function public.commit_mesa_attack_cover_resolution(
  p_session_id uuid,
  p_combat_id uuid,
  p_resolution_id text,
  p_claim_token uuid,
  p_actor_id uuid,
  p_actions_before integer,
  p_actions_after integer,
  p_ammo_before jsonb,
  p_ammo_after jsonb,
  p_obstacle_id text,
  p_hp_before integer,
  p_hp_after integer,
  p_destroyed boolean,
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
  tactical_map jsonb;
  changed integer;
  index integer;
  item jsonb;
  path text[];
begin
  select * into resolution
  from public.mesa_attack_resolutions
  where session_id = p_session_id and combat_id = p_combat_id and resolution_id = p_resolution_id
  for update;
  if resolution.id is null then raise exception using errcode = 'P0001', message = 'resolution_not_claimed'; end if;
  if resolution.status = 'committed' then return resolution.result; end if;
  if resolution.status = 'failed' then raise exception using errcode = 'P0001', message = 'resolution_failed'; end if;
  if resolution.claim_token <> p_claim_token then raise exception using errcode = 'P0001', message = 'resolution_in_progress'; end if;
  if p_hp_after < 0 then raise exception using errcode = 'P0001', message = 'invalid_cover_hp'; end if;

  update public.mesa_combatants
  set actions_remaining = p_actions_after, combat_ammo = p_ammo_after
  where id = p_actor_id and combat_id = p_combat_id
    and actions_remaining = p_actions_before
    and combat_ammo is not distinct from p_ammo_before;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception using errcode = 'P0001', message = 'action_conflict'; end if;
  changed := 0;

  select s.tactical_map into tactical_map
  from public.mesa_sessions s where s.id = p_session_id for update;
  if tactical_map is null then raise exception using errcode = 'P0001', message = 'cover_not_found'; end if;
  for index in 0..coalesce(jsonb_array_length(tactical_map #> '{geometry,walls}') - 1, -1) loop
    item := tactical_map #> array['geometry','walls',index::text];
    if item->>'id' = p_obstacle_id then
      if (item->>'coverHP')::integer is distinct from p_hp_before then raise exception using errcode = 'P0001', message = 'cover_hp_conflict'; end if;
      path := array['geometry','walls',index::text,'coverHP'];
      tactical_map := jsonb_set(tactical_map, path, to_jsonb(p_hp_after), true);
      tactical_map := jsonb_set(tactical_map, array['geometry','walls',index::text,'destroyed'], to_jsonb(p_destroyed), true);
      changed := 1;
      exit;
    end if;
  end loop;
  if changed is distinct from 1 then
    for index in 0..coalesce(jsonb_array_length(tactical_map #> '{geometry,doors}') - 1, -1) loop
      item := tactical_map #> array['geometry','doors',index::text];
      if item->>'id' = p_obstacle_id then
        if item->>'state' <> 'closed' or (item->>'coverHP')::integer is distinct from p_hp_before then raise exception using errcode = 'P0001', message = 'cover_hp_conflict'; end if;
        tactical_map := jsonb_set(tactical_map, array['geometry','doors',index::text,'coverHP'], to_jsonb(p_hp_after), true);
        tactical_map := jsonb_set(tactical_map, array['geometry','doors',index::text,'destroyed'], to_jsonb(p_destroyed), true);
        changed := 1;
        exit;
      end if;
    end loop;
  end if;
  if changed is distinct from 1 then raise exception using errcode = 'P0001', message = 'cover_not_found'; end if;
  update public.mesa_sessions set tactical_map = tactical_map, updated_at = now() where id = p_session_id;
  update public.mesa_combats set event_log = (
    select coalesce(jsonb_agg(value order by ord), '[]'::jsonb)
    from jsonb_array_elements(event_log || jsonb_build_array(jsonb_build_object('at', now(), 'kind', 'action', 'text', p_event_text))) with ordinality entries(value, ord)
    where ord > greatest(0, jsonb_array_length(event_log || jsonb_build_array(1)) - 50)
  ), updated_at = now() where id = p_combat_id and session_id = p_session_id;
  update public.mesa_attack_resolutions set status = 'committed', result = p_result, updated_at = now(), committed_at = now() where id = resolution.id;
  return p_result;
end;
$$;
