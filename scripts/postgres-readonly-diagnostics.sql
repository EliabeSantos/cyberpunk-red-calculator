-- F1.64.11 — procedimento manual, somente leitura.
--
-- NÃO executar automaticamente. Usar somente em um banco de testes descartável
-- com uma role read-only. Não coloque senha, token, service key ou URL com
-- credenciais neste arquivo nem no relatório.
--
-- Pré-requisitos:
--   psql "$SUPABASE_MESA_TEST" -v ON_ERROR_STOP=1 -f this-file.sql
--
-- Substitua os marcadores <SESSION_UUID>, <COMBAT_UUID> e <RESOLUTION_ID>
-- apenas na sessão local. Nunca os comite se contiverem dados privados.

\set ON_ERROR_STOP on

-- A sessão fica read-only e com limites conservadores. Estes SETs só afetam a
-- sessão psql; não alteram banco, schema, funções ou políticas.
set default_transaction_read_only = on;
set statement_timeout = '5s';
set lock_timeout = '1s';

begin read only;

-- ---------------------------------------------------------------------------
-- 1. Planos sem execução: seguros para SELECTs representativos.
-- ---------------------------------------------------------------------------

explain (format json)
select id, status, initiative_started, active_combatant_id
from public.mesa_combats
where session_id = '<SESSION_UUID>'::uuid;

explain (format json)
select id, session_id, participant_id, kind, initiative, movement_remaining
from public.mesa_combatants
where combat_id = '<COMBAT_UUID>'::uuid
order by sort_order;

explain (format json)
select id, session_id, combat_id, resolution_id, status
from public.mesa_attack_resolutions
where session_id = '<SESSION_UUID>'::uuid
  and combat_id = '<COMBAT_UUID>'::uuid
  and resolution_id = '<RESOLUTION_ID>';

explain (format json)
select id, status, tactical_map
from public.mesa_sessions
where id = '<SESSION_UUID>'::uuid;

-- Consulta de autenticação. O token deve ser fornecido somente por variável
-- temporária do psql, nunca escrito neste arquivo ou no log:
-- \set player_token 'VALOR SOMENTE NA SESSÃO LOCAL'
-- explain (format json)
-- select id, session_id, role, character_id
-- from public.mesa_participants
-- where session_id = '<SESSION_UUID>'::uuid
--   and player_token = :'player_token';

-- ---------------------------------------------------------------------------
-- 2. EXPLAIN ANALYZE: opcional e explícito.
-- ---------------------------------------------------------------------------
-- Só descomente em banco de teste, com IDs descartáveis e SELECTs sem efeitos
-- colaterais. Nunca aplicar a RPC claim/commit/release ou qualquer função que
-- contenha INSERT, UPDATE, DELETE, FOR UPDATE ou efeitos de combate.
--
-- explain (analyze, buffers, format json)
-- select id, session_id, participant_id, kind, initiative, movement_remaining
-- from public.mesa_combatants
-- where combat_id = '<COMBAT_UUID>'::uuid
-- order by sort_order;

-- ---------------------------------------------------------------------------
-- 3. Sessões, esperas e locks — requer permissões de monitoramento.
-- ---------------------------------------------------------------------------

select pid, state, wait_event_type, wait_event,
       backend_start, xact_start, query_start, state_change,
       application_name
from pg_catalog.pg_stat_activity
where datname = current_database()
order by query_start nulls last;

select locktype, mode, granted, count(*) as lock_count
from pg_catalog.pg_locks
group by locktype, mode, granted
order by granted, locktype, mode;

-- Métricas acumuladas do database; não são métricas de uma requisição isolada.
select datname, numbackends, xact_commit, xact_rollback,
       blks_read, blks_hit, temp_files, temp_bytes
from pg_catalog.pg_stat_database
where datname = current_database();

-- Alguns ambientes expõem estatísticas do PgBouncer, outros não. A consulta é
-- opcional e pode retornar erro de relação/permissão; não criar views nem roles.
-- select * from pg_catalog.pg_stat_activity where application_name ilike '%pgbouncer%';
-- select * from pgbouncer.show_pools;

rollback;

-- Após a carga controlada, repetir somente as consultas de observação acima.
-- Não incluir query text, tokens, URLs ou parâmetros privados no relatório.
