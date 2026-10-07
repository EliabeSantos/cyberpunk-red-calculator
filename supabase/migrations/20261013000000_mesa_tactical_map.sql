-- Tactical Map: configuração pertence à Mesa; posição pertence ao combatente.
alter table public.mesa_sessions
  add column if not exists tactical_map jsonb not null default '{"imageUrl":"","enabled":false,"pixelsPerMeter":50,"width":1000,"height":600}'::jsonb;

alter table public.mesa_combatants
  add column if not exists position jsonb not null default '{"x":0.5,"y":0.5}'::jsonb;

alter table public.mesa_combatants
  add column if not exists avatar_url text;

alter table public.mesa_combatants
  drop constraint if exists mesa_combatants_position_valid;

alter table public.mesa_combatants
  add constraint mesa_combatants_position_valid check (
    jsonb_typeof(position) = 'object'
    and (position->>'x')::numeric between 0 and 1
    and (position->>'y')::numeric between 0 and 1
  );
