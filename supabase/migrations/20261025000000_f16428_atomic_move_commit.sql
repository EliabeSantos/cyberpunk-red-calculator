-- F1.64.28 — CAS do movimento e confirmação da resolução na mesma transação.
-- O histórico de combate permanece fora desta RPC: ele é apresentação e não
-- pode transformar um orçamento já persistido em falha autoritativa.

create or replace function public.commit_mesa_move_resolution_atomic(
  p_session_id uuid,
  p_combat_id uuid,
  p_resolution_id text,
  p_claim_token uuid,
  p_actor_id uuid,
  p_movement_before integer,
  p_movement_after integer,
  p_actions_before integer,
  p_actions_after integer,
  p_position jsonb,
  p_netrunner_state jsonb,
  p_result jsonb
)
returns table (status text, result jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  resolution public.mesa_attack_resolutions%rowtype;
  changed integer;
begin
  -- A ordem resolução → combatente é a mesma ordem usada pelos commits
  -- autoritativos existentes. Isso serializa retries da mesma resolução antes
  -- de disputar o orçamento do combatente.
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
    return query select 'already_committed'::text, resolution.result;
    return;
  end if;
  if resolution.status = 'failed' then
    raise exception using errcode = 'P0001', message = 'resolution_failed';
  end if;
  if resolution.status <> 'processing' or resolution.claim_token <> p_claim_token then
    raise exception using errcode = 'P0001', message = 'resolution_in_progress';
  end if;

  update public.mesa_combatants
  set movement_remaining = p_movement_after,
      position = case when p_position is null then position else p_position end,
      netrunner_state = case when p_netrunner_state is null then netrunner_state else p_netrunner_state end
  where id = p_actor_id
    and combat_id = p_combat_id
    and movement_remaining = p_movement_before
    and actions_remaining = p_actions_before
    and is_dead = false;
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception using errcode = 'P0001', message = 'movement_conflict';
  end if;

  update public.mesa_attack_resolutions
  set status = 'committed',
      result = p_result,
      updated_at = now(),
      committed_at = now()
  where id = resolution.id
    and public.mesa_attack_resolutions.status = 'processing'
    and public.mesa_attack_resolutions.claim_token = p_claim_token;
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception using errcode = 'P0001', message = 'transaction_failed';
  end if;

  return query select 'committed'::text, p_result;
end;
$$;
