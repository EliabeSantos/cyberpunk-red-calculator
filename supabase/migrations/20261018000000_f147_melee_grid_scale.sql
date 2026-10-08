-- F1.47.1: o espaço padrão do Tactical Map equivale a 2m.
-- Mapas que já tinham uma célula explicitamente configurada não são alterados;
-- somente o legado que ainda corresponde ao default F1.29 (1m, sem exibição e
-- sem snap) é normalizado.
alter table public.mesa_sessions
  alter column tactical_map set default '{"imageUrl":"","enabled":false,"pixelsPerMeter":50,"width":1000,"height":600,"grid":{"enabled":false,"size":2,"snap":false}}'::jsonb;

update public.mesa_sessions
set tactical_map = jsonb_set(tactical_map, '{grid,size}', '2'::jsonb, true)
where tactical_map is not null
  and tactical_map->'grid'->>'size' = '1'
  and coalesce(tactical_map->'grid'->>'enabled', 'false') = 'false'
  and coalesce(tactical_map->'grid'->>'snap', 'false') = 'false';
