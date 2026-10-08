-- F1.53 — arquitetura NET estrutural e descoberta privada por Netrunner.
-- Acesso direto continua bloqueado por RLS; somente gateways server-side usam
-- estas colunas. A arquitetura é JSON validado pela aplicação para manter os
-- Floors/Nodes versionados juntos e compatíveis com a Tactical Map existente.

alter table public.mesa_sessions
  add column if not exists net_architectures jsonb not null default '[]'::jsonb;

alter table public.mesa_combatants
  add column if not exists net_discovery jsonb not null default '{}'::jsonb;

comment on column public.mesa_sessions.net_architectures is
  'F1.53 server-authoritative linear NET Architectures, Floors and Nodes';

comment on column public.mesa_combatants.net_discovery is
  'F1.53 private discovery state for this Netrunner combatant';
