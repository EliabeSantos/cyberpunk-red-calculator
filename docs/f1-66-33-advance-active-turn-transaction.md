# F1.66.33 — `advanceActiveTurn` transacional local

## Sequência integrada

No modo local, `endTurn` relê o combate e o combatant ativo pelo repository e
chama `advanceActiveTurn` dentro de `withLocalPostgresTransaction`. O caminho
Supabase continua usando a implementação anterior.

A transação local adquire locks em ordem fixa:

1. sessão;
2. combate;
3. batalha ativa;
4. todos os combatants do combate.

Depois relê o estado atual e executa:

- desconexão de Netrunners mortos, limpeza de vínculo ICE e event log;
- seleção pura do próximo combatant por iniciativa, morte e `sort_order`;
- expiração de efeitos e condições;
- dano periódico de Quickhack/Overheat com CAS de HP;
- consumo de Actions/MOVE do combatant anterior;
- recuperação de RAM e reset do estado NET do próximo;
- inicialização de Actions/MOVE do próximo;
- atualização de rodada, turno ativo e timestamp;
- event log de turno/rodada.

Quando o engine retorna `finished`, a transação também:

- recupera RAM;
- marca `mesa_combats` como `finished`;
- grava `combat_finished`;
- materializa o roster final e event log em `mesa_battles` via
  `completeActiveBattleWithRepository`/`completeBattle`.

O commit ocorre apenas depois de todas essas operações. Falhas propagam para
`withLocalPostgresTransaction`, que executa rollback e libera a conexão.

## Operações integradas

O caminho local usa somente `context.repository` e as variantes preparadas de:

- Architecture/limpeza de ICE;
- updates de combatants com escopo e CAS;
- efeitos periódicos de Quickhack;
- recuperação de RAM;
- event log read-modify-write;
- atualização do combate;
- conclusão condicional da batalha.

Nenhuma dessas operações abre conexão independente. A implementação Supabase
permanece separada e não recebe alegação de atomicidade entre chamadas remotas.

## Limitações explícitas

- Turnos cujo combatant ativo é `net_ice` continuam recusados no modo local,
  pois `executeBlackIceTurn` ainda não foi integrado ao contexto.
- Outros consumidores públicos NET/ICE e resoluções continuam fora desta
  migração.
- `endCombat` explícito ainda usa o caminho Supabase e não foi migrado.
- A exclusão do combatant ativo continua bloqueada.
- Publicação local ocorre na rota após o commit; nenhum snapshot privado é
  transportado.

## Garantias

- isolamento por sessão e combate nas leituras/escritas;
- locks em ordem consistente para o fluxo local;
- CAS mantido para HP, iniciativa e recuperação de RAM;
- conclusão de battle condicionada a `status = 'active'`, evitando duplicação;
- rollback conjunto de combatants, combate, log e histórico em falha;
- caminho Supabase preservado sem fallback automático.

## Testes preparados

`tests/mesa-local-transaction-context.test.ts` continua cobrindo a composição
de adapters, rollback de mutações relacionadas e conclusão condicional de
battle. Foram mantidos casos para falha intermediária e reutilização segura do
contexto. Os testes não foram executados.

## Arquivos alterados

- `src/lib/mesa/store.ts`
- `src/app/api/mesa/[id]/combat/turn/route.ts`
- `tests/mesa-local-transaction-context.test.ts`
- este documento

Nenhuma migration ou commit foi criado.

**Nenhum teste, TypeScript, build ou lint foi executado.**
