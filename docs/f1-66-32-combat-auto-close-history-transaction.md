# F1.66.32 — Encerramento automático e histórico transacional

## Condição exata de encerramento

`advanceActiveTurn` calcula `advanceTurn(order, activeCombatantId, round, alive)`.
O encerramento automático ocorre somente quando o resultado possui
`advance.kind === "finished"`, isto é, não há um próximo combatant vivo para
receber o turno. Antes dessa decisão, combatants mortos são excluídos do
conjunto `alive`; combatants vivos continuam ordenados por iniciativa e
`sort_order`.

## Operações atuais de encerramento

No caminho Supabase atual, o encerramento automático:

1. recupera RAM dos combatants Netrunner;
2. atualiza `mesa_combats` para `finished`, limpa o combatant ativo e o horário
   do turno;
3. grava o evento `combat_finished` no event log;
4. procura a batalha ativa da sessão;
5. lê combatants e combate atuais;
6. mistura o estado final no roster inicial;
7. grava `status`, `ended_at`, `final_round`, roster final e event log em
   `mesa_battles`.

A limpeza de NET/ICE e efeitos de turno acontecem antes da decisão de
encerramento e continuam dependências separadas, ainda não migradas.

## Método preparado

Foi adicionado ao `MesaRepository` e implementado nos adapters local e
Supabase:

- `completeBattle(battleId, sessionId, patch)`.

No PostgreSQL local, a operação usa SQL parametrizado e só atualiza quando a
linha ainda possui `status = 'active'`, retornando a linha alterada. Isso
preserva a idempotência contra uma segunda conclusão. No Supabase, os mesmos
filtros são aplicados, sem alegar transação entre chamadas remotas.

Também foi preparado no store `completeActiveBattleWithRepository`. Ele usa
`findActiveBattle`, `listCombatantsBySession`, `findCombatBySession` e
`completeBattle` sobre o repository recebido. O snapshot final mantém:

- roster inicial mesclado com HP/morte/remoção atuais;
- rodada final atual, com fallback compatível;
- event log atual;
- timestamp de encerramento.

Esse helper agora é utilizado pelo caminho local transacional de
`advanceActiveTurn`; o caminho Supabase não foi alterado.

## Garantias e limitações

Quando usado dentro de `LocalPostgresTransactionContext`, o helper poderá
compartilhar a mesma conexão para combatants, combate, event log e histórico.
A operação condicional evita duplicação de histórico, mas os locks de combate,
batalha e combatants precisam ser adquiridos pelo futuro orquestrador antes da
leitura do snapshot.

O encerramento automático local agora participa do mesmo contexto quando o
avanço local é executado. Turnos de ICE e o encerramento explícito continuam
fora da migração.

A exclusão do combatant ativo continua bloqueada. Não é seguro apagar a linha
enquanto o avanço e o possível histórico final não participarem da mesma
transação.

## Critérios para integração futura

- bloquear combate, batalha e combatants afetados antes de decidir `finished`;
- executar recuperação de RAM e demais efeitos no mesmo contexto;
- atualizar combate, event log e `mesa_battles` antes de um único commit;
- tratar zero linhas de `completeBattle` como conclusão concorrente idempotente;
- fazer rollback também do roster e do event log em qualquer falha;
- publicar invalidação somente após o commit;
- validar snapshot final e isolamento entre sessões em PostgreSQL real.

## Testes preparados

`tests/mesa-local-transaction-context.test.ts` foi atualizado para incluir a
operação condicional de conclusão de battle na composição de adapters do mesmo
contexto. Os testes não foram executados.

## Arquivos alterados

- `src/lib/mesa/infrastructure.ts`
- `src/lib/mesa/localPostgresInfrastructure.ts`
- `src/lib/mesa/supabaseInfrastructure.ts`
- `src/lib/mesa/store.ts`
- `tests/mesa-local-transaction-context.test.ts`
- este documento

Nenhuma migration foi criada e nenhum commit foi feito.

**Nenhum teste, TypeScript, build ou lint foi executado.**
