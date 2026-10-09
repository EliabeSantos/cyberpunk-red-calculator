-- A released claim remains auditable and cannot be claimed as an unfinished
-- operation again. Keep the row and mark it failed, matching the other
-- resolution families and the recovery contract.
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
  update public.mesa_attack_resolutions
  set status = 'failed', updated_at = now()
  where session_id = p_session_id
    and combat_id = p_combat_id
    and resolution_id = p_resolution_id
    and claim_token = p_claim_token
    and status = 'processing';
$$;

create or replace function public.release_mesa_reload_resolution(
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
  update public.mesa_reload_resolutions
  set status = 'failed', updated_at = now()
  where session_id = p_session_id
    and combat_id = p_combat_id
    and resolution_id = p_resolution_id
    and claim_token = p_claim_token
    and status = 'processing';
$$;
