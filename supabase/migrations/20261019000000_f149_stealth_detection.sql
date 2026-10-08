-- F1.49: estado autoritativo de Stealth e conhecimento por observador.
alter table public.mesa_combatants
  add column if not exists stealth_state text not null default 'not_stealthed'
    check (stealth_state in ('not_stealthed', 'stealthed')),
  add column if not exists detected_by jsonb not null default '[]'::jsonb;
