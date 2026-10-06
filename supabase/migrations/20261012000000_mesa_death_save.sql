-- F1.15 — Death Save server-authoritative na Mesa.
-- Os campos são a projeção do estado já existente em Character.combat.
alter table public.mesa_combatants
  add column if not exists death_save_dc integer not null default 0 check (death_save_dc >= 0),
  add column if not exists death_save_failures integer not null default 0 check (death_save_failures >= 0);

-- A claim permanece na infraestrutura durável de mesa_attack_resolutions.
-- Esta RPC adiciona apenas o commit atômico específico dos dois campos novos,
-- HP/morte e resultado. O resultado nunca vem do cliente: é calculado no
-- servidor e recebido aqui já validado pelo gateway.
drop function if exists public.commit_mesa_death_save_resolution(
  uuid, uuid, text, uuid, uuid, integer, boolean, integer, integer, boolean, jsonb, text
);

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
  where session_id = p_session_id
    and combat_id = p_combat_id
    and resolution_id = p_resolution_id
  for update;

  if resolution.id is null then
    raise exception using errcode = 'P0001', message = 'resolution_not_claimed';
  end if;
  if resolution.status = 'committed' then return resolution.result; end if;
  if resolution.status = 'failed' then
    raise exception using errcode = 'P0001', message = 'resolution_failed';
  end if;
  if resolution.claim_token <> p_claim_token then
    raise exception using errcode = 'P0001', message = 'resolution_in_progress';
  end if;

  update public.mesa_combatants
  set death_save_dc = p_dc_after,
      death_save_failures = p_failures_after,
      is_dead = p_dead_after
  where id = p_actor_id
    and combat_id = p_combat_id
    and kind = 'character'
    and hp_current < 1
    and is_dead = p_dead_before
    and death_save_dc = p_dc_before
    and death_save_failures = p_failures_before;
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception using errcode = 'P0001', message = 'death_save_conflict';
  end if;

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

  update public.mesa_attack_resolutions
  set status = 'committed', result = p_result, updated_at = now(), committed_at = now()
  where id = resolution.id;
  return p_result;
end;
$$;
