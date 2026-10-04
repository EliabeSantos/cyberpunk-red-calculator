-- F1.7.4 — dados imutáveis usados para reconstruir o combatente no servidor.
--
-- O JSON é um snapshot por instância e por combate, não uma referência viva ao
-- catálogo local. HP/economia/iniciativa continuam nas colunas mutáveis de
-- mesa_combatants; este campo guarda os dados de ficha usados pelo engine.
alter table public.mesa_combatants
  add column if not exists combat_snapshot jsonb;

alter table public.mesa_combatants
  add column if not exists combat_ammo jsonb;


comment on column public.mesa_combatants.combat_snapshot is
  'Snapshot server-side do CombatParticipant criado no início do combate.';

comment on column public.mesa_combatants.combat_ammo is
  'Estado mutável de munição por weaponId, consumido pelo ataque server-side.';
