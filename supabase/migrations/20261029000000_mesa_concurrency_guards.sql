-- Atomic event append shared by Supabase RPC and the local PostgreSQL adapter.
-- The row lock makes concurrent appenders serialize; resolutionId makes safe
-- retries idempotent without relying on an in-memory mutex.
create or replace function public.append_mesa_combat_event(
  p_combat_id uuid,
  p_session_id uuid,
  p_event jsonb,
  p_max_events integer default 50
)
returns setof public.mesa_combats
language plpgsql
set search_path = public
as $$
declare
  current_log jsonb;
  event_resolution_id text;
  next_log jsonb;
begin
  select event_log into current_log
    from public.mesa_combats
   where id = p_combat_id and session_id = p_session_id
   for update;
  if not found then return; end if;

  current_log := case when jsonb_typeof(current_log) = 'array' then current_log else '[]'::jsonb end;
  event_resolution_id := nullif(p_event->>'resolutionId', '');
  if event_resolution_id is not null and exists (
    select 1 from jsonb_array_elements(current_log) entry
     where entry->>'resolutionId' = event_resolution_id
  ) then
    return query select * from public.mesa_combats where id = p_combat_id;
    return;
  end if;

  select coalesce(jsonb_agg(value order by ord), '[]'::jsonb)
    into next_log
    from (
      select value, ord
        from jsonb_array_elements(current_log || jsonb_build_array(p_event)) with ordinality as elements(value, ord)
       where ord > greatest(
         (jsonb_array_length(current_log || jsonb_build_array(p_event)) - greatest(p_max_events, 1)),
         0
       )
    ) kept;

  return query update public.mesa_combats
    set event_log = next_log, updated_at = now()
   where id = p_combat_id and session_id = p_session_id
   returning *;
end;
$$;
