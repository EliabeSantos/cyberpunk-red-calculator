-- F1.33: vector geometry belongs to the existing Tactical Map JSON.
-- Existing maps keep all current configuration and receive empty collections.
alter table public.mesa_sessions
  alter column tactical_map set default '{"imageUrl":"","enabled":false,"pixelsPerMeter":50,"width":1000,"height":600,"geometry":{"walls":[],"doors":[]}}'::jsonb;

update public.mesa_sessions
set tactical_map = jsonb_set(
  tactical_map,
  '{geometry}',
  '{"walls":[],"doors":[]}'::jsonb,
  true
)
where tactical_map is not null
  and not (tactical_map ? 'geometry');
