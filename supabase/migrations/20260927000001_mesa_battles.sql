-- Histórico de partidas + encontro de uso único (27/09/2026).
--
-- Quando o Mestre lança um combate a partir de um encontro, a partida nasce
-- aqui identificada pelo `encounter_id` (o id do encontro na tela
-- /gm/encounters). Duas promessas nascem desta tabela:
--
--   1. **O encontro é de uso único** — `encounter_id` é UNIQUE: um encontro
--      que já entrou em combate não pode ser lançado de novo, em nenhuma mesa
--      (decisão de 27/09/2026). O bloqueio é do SERVIDOR, não da UI.
--      Combate avulso (sem encontro) grava `encounter_id = NULL`, e o UNIQUE
--      do PostgreSQL deixa passar vários NULLs.
--   2. **Histórico de partidas** — ao fim do combate (GM encerrar, sessão
--      encerrar ou fim automático por todos os inimigos caídos) a linha vira
--      `completed` e guarda o snapshot final: com que vida cada um entrou,
--      quem saiu no meio, quem morreu, rodada final e log de eventos.
--
-- `mesa_combats` continua sendo o combate VIVO (resetado a cada luta, único
-- por sessão); esta tabela é só registro e sobrevive a esse reset.
--
-- Retrocompatível: a tabela é nova e opcional. Se não existir, o servidor
-- detecta na primeira escrita (`battleSupport = "no"`), segue SEM histórico e
-- sem bloqueio de encontro, e `GET /api/mesa/[id]/battles` responde
-- `503 migration_pending`. O combate em si nunca depende dela.
--
-- Mesmo padrão das migrações anteriores: RLS habilitado sem policies —
-- só o servidor (service role) lê/escreve, pelas rotas /api/mesa.

create table if not exists public.mesa_battles (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.mesa_sessions(id) on delete cascade,
  -- Código da mesa junto do registro: o histórico precisa sobreviver à lista
  -- de mesas do navegador (membershipStore), que o Mestre pode limpar.
  join_code      text not null check (join_code ~ '^[A-Z0-9]{5}$'),
  -- Chave do encontro em /gm/encounters — NULL quando o combate foi avulso.
  encounter_id   text unique,
  encounter_name text not null check (char_length(encounter_name) between 1 and 60),
  status         text not null default 'active' check (status in ('active', 'completed')),
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  final_round    integer,
  -- Snapshot dos combatentes: nasce com a vida de ENTRADA e ganha
  -- hpEnd/isDead/removed quando a partida é fechada.
  combatants     jsonb not null default '[]'::jsonb,
  -- Mesmo log curto do combate (jsonb append-only, recortado em 50 entradas).
  event_log      jsonb not null default '[]'::jsonb
);

create index if not exists mesa_battles_session_idx
  on public.mesa_battles (session_id, started_at desc);

alter table public.mesa_battles enable row level security;
