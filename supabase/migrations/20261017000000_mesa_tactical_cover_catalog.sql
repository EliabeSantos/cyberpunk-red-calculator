-- F1.44.1: marca obstáculos antigos para migração explícita de espessura.
-- Não escolhe thin/thick, não converte brick e não altera HP/DV legados.
-- A ausência de coverThickness é interpretada pelo servidor como configuração
-- legada até o GM escolher um perfil do catálogo.
update public.mesa_sessions
set tactical_map = jsonb_set(
  jsonb_set(
    tactical_map,
    '{geometry,walls}',
    coalesce((
      select jsonb_agg(
        case when item ? 'coverMaterial' and not (item ? 'coverThickness')
          then item || jsonb_build_object('coverThickness', null) else item end
        order by ord
      )
      from jsonb_array_elements(coalesce(tactical_map #> '{geometry,walls}', '[]'::jsonb)) with ordinality as entries(item, ord)
    ), '[]'::jsonb),
    true
  ),
  '{geometry,doors}',
  coalesce((
    select jsonb_agg(
      case when item ? 'coverMaterial' and not (item ? 'coverThickness')
        then item || jsonb_build_object('coverThickness', null) else item end
      order by ord
    )
    from jsonb_array_elements(coalesce(tactical_map #> '{geometry,doors}', '[]'::jsonb)) with ordinality as entries(item, ord)
  ), '[]'::jsonb),
  true
)
where tactical_map is not null and tactical_map ? 'geometry';
