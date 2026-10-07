-- F1.29: configuração compartilhada do grid do Tactical Map.
alter table public.mesa_sessions
  alter column tactical_map set default '{"imageUrl":"","enabled":false,"pixelsPerMeter":50,"width":1000,"height":600,"grid":{"enabled":false,"size":1,"snap":false}}'::jsonb;

update public.mesa_sessions
set tactical_map = tactical_map || jsonb_build_object(
  'grid', coalesce(tactical_map->'grid', '{"enabled":false,"size":1,"snap":false}'::jsonb)
)
where tactical_map->'grid' is null;
