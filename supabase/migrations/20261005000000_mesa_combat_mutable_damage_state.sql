-- F1.7.15 — estado mutável de dano separado do snapshot imutável.
alter table public.mesa_combatants
  add column if not exists combat_armor jsonb;

alter table public.mesa_combatants
  add column if not exists critical_injuries jsonb;

comment on column public.mesa_combatants.combat_armor is
  'Estado mutável de armor produzido pelo Combat Engine durante o combate.';

comment on column public.mesa_combatants.critical_injuries is
  'Critical Injuries produzidas pelo Combat Engine durante o combate.';
