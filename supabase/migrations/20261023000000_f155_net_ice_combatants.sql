-- F1.55.1 — Black ICE participa do MESMO ciclo de initiative/turn da Mesa.
alter table public.mesa_combatants
  drop constraint if exists mesa_combatants_kind_check;

alter table public.mesa_combatants
  add constraint mesa_combatants_kind_check check (kind in ('character', 'enemy', 'net_ice'));

alter table public.mesa_combatants
  add column if not exists net_ice_state jsonb;

alter table public.mesa_combatants
  add column if not exists brain_damage integer not null default 0 check (brain_damage >= 0);

comment on column public.mesa_combatants.net_ice_state is
  'F1.55 Black ICE combatant state; never used as physical HP/equipment state';
