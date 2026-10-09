# F1.66.23 — Event log e histórico de batalhas locais

## Inventário confirmado

`store.ts` usa:

- `appendEvent` para read-modify-write de `mesa_combats.event_log`, com evento
  `at`, deduplicação por `resolutionId` e limite de 50 entradas;
- `findBattleByEncounter` para verificar o UNIQUE lógico de encontro;
- `reserveBattle` para inserir uma partida `active`;
- `updateBattleRoster` para salvar o snapshot de entrada;
- `discardBattle` para compensar uma reserva órfã;
- `completeActiveBattle` para salvar status, horário, rodada, roster final e
  event log;
- `listBattles` para histórico ordenado por `started_at desc`.

O schema de `20260927000001_mesa_battles.sql` confirma:

- FK `session_id` para `mesa_sessions` com cascade;
- `encounter_id` UNIQUE, permitindo vários `NULL`;
- status `active|completed`;
- snapshots `combatants` e `event_log` em JSONB;
- índice `(session_id, started_at desc)`;
- RLS sem policies, com acesso server-side.

## Operações de repository implementadas

`MesaRepository` agora declara e ambos os adapters implementam:

### Event log

- `findCombatEventLog(combatId, sessionId)`;
- `replaceCombatEventLog(combatId, sessionId, eventLog)`.

As operações exigem `combat_id` e `session_id`. O repository não cria eventos,
deduplica `resolutionId`, define timestamps nem escolhe visibilidade; essas
decisões continuam no domínio.

### Histórico

- `findBattleByEncounter`;
- `findActiveBattle`;
- `createBattle`;
- `updateBattle`;
- `deleteBattle`;
- `listBattles`.

O adapter local usa SQL parametrizado, JSONB e constraints PostgreSQL oficiais.
O adapter Supabase mantém os filtros e ordenação equivalentes. Limites de
listagem ficam limitados a 100 para evitar consultas sem limite acidental.

## O que não foi migrado

As funções do `store.ts` ainda não foram trocadas para esses métodos. Isso é
intencional: `startCombat`, reinício e encerramento combinam histórico, combate,
combatants, sessão e event log. Também possuem compensação de reserva e regras
de falha históricas.

Trocar apenas `appendEvent` ou `reserveBattle` por chamadas independentes
permitiria misturar bancos ou deixar uma reserva sem combatants. O read-modify-
write atual do event log também tem janela de corrida; os métodos isolados não
prometem atomicidade que ainda não existe no contrato.

## Próxima etapa necessária

Criar uma operação transacional agregada, ou um contexto transacional explícito,
capaz de executar no mesmo banco:

1. reservar/reutilizar `mesa_battles`;
2. criar/resetar `mesa_combats`;
3. remover e materializar combatants;
4. atualizar sessão;
5. gravar event log e snapshot inicial;
6. desfazer a reserva em falha.

O mesmo mecanismo deverá finalizar a partida com roster final e log. Só depois
será seguro migrar os consumidores de combate para o modo local.

## Riscos e limitações

- O event log ainda não tem CAS/lock no método isolado de substituição.
- O UNIQUE de `encounter_id` continua sendo a garantia do banco, mas a reserva
  ainda não está integrada a uma transação local com o início do combate.
- Projeção GM/jogador não está no adapter e não foi alterada.
- Nenhuma migration foi criada; a confirmação do schema do banco de runtime
  ainda é pendente.
- O transporte local continua sendo apenas invalidação em memória por processo.

## Arquivos alterados

- `src/lib/mesa/infrastructure.ts`
- `src/lib/mesa/localPostgresInfrastructure.ts`
- `src/lib/mesa/supabaseInfrastructure.ts`
- este documento

Nenhum fluxo de `startCombat`, reinício, `addEnemies`, iniciativa, inventário,
mapa, NET, stealth, detecção, ICE ou resolução foi migrado.

**Nenhum teste, TypeScript, build ou lint foi executado.**
