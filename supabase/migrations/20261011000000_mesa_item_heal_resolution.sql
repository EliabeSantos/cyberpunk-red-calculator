-- F1.13.2 — commit ATÔMICO de "item + cura" numa única transação.
--
-- Mesma tabela/resolução de F1.13.1 (`mesa_item_consume_resolutions`, claim e
-- release reaproveitados tal como estão) com UMA diferença: esta RPC também
-- escreve o HP, com CAS em `hp_current` ao lado do CAS de `supplies` e de
-- `actions_remaining`. Assim, consumo do item, cura e débito de Action
-- acontecem ou juntos, ou nada acontece — nunca "consumiu mas não curou".
--
-- Cadeia de segurança (todas obrigatórias para a linha mudar):
--   • resolução reservada com o MESMO `claim_token` (idempotência);
--   • combate ainda `active` e com o MESMO ativo (turno não virou no meio);
--   • `actions_remaining = antes` e `>= 1`;
--   • `supplies` byte a byte como o servidor leu (dois requests concorrentes
--     nunca consomem a mesma unidade);
--   • `hp_current = antes` e o ator vivo (outra cura/dano no meio do caminho).
-- Qualquer divergência → `consumption_conflict`, sem efeito parcial.

create or replace function public.commit_mesa_item_heal_resolution(
  p_session_id uuid,
  p_combat_id uuid,
  p_resolution_id text,
  p_claim_token uuid,
  p_actor_id uuid,
  p_actions_before integer,
  p_actions_after integer,
  p_supplies_before jsonb,
  p_supplies_after jsonb,
  p_hp_before integer,
  p_hp_after integer,
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
     or p_amount <= 0
     or p_hp_before is null
     or p_hp_after is null
     or p_hp_after < p_hp_before              -- cura nunca reduz HP
     or p_hp_after > p_hp_before + p_amount   -- cura nunca ultrapassa o ganho do item
     then
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
      supplies = p_supplies_after,
      hp_current = p_hp_after
  where id = p_actor_id
    and combat_id = p_combat_id
    and actions_remaining = p_actions_before
    and actions_remaining >= 1
    and is_dead = false
    and hp_current = p_hp_before
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
