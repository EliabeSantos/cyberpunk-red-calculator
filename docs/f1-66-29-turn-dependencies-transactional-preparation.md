# F1.66.29 — Preparação transacional das dependências de `advanceActiveTurn`

## Resultado

`advanceActiveTurn` continua **não migrado** e a exclusão do combatant ativo
continua bloqueada. A auditoria confirmou que os adapters locais já aceitam um
`PoolClient` por meio do `LocalPostgresTransactionContext`; portanto, não foi
necessário adicionar métodos duplicados ou abrir uma conexão nova para cada
escrita.

Esta etapa prepara e documenta a composição futura, mas não afirma atomicidade
do fluxo enquanto ele continuar chamando `db()` e Supabase.

## Inventário operacional

| Operação | Domínio | Persistência atual | Contexto local disponível |
| --- | --- | --- | --- |
| listar combatants e ordenar | combate | `mesa_combatants.select` | `listCombatantsByCombat`, sobre o mesmo client |
| desconectar Netrunner morto | NET/ICE | `clearNetIceEngagement` + update de `netrunner_state` | update genérico existe; leitura/escrita de `net_architectures` ainda não está composta no store |
| calcular próximo turno | engine | `sortByInitiative`/`advanceTurn` | puro, sem conexão |
| expirar Quickhack/condições | Quickhack | updates de `net_effects`/`conditions` | `updateCombatant` com CAS já existe |
| dano periódico Overheat | engine/Quickhack | engine + update CAS de HP + event log | regras puras existem; composição no contexto ainda não está ligada |
| zerar Actions/MOVE anterior | combate | update de `mesa_combatants` | `updateCombatant` com escopo/CAS |
| recuperar RAM | NET | updates de `netrunner_state` | update genérico existe; função de domínio ainda usa `db()` |
| iniciar Actions/MOVE próximo | combate | update de `mesa_combatants` | `updateCombatant` com escopo |
| atualizar combate | combate | update de `mesa_combats` | `updateCombat` com escopo de sessão |
| gravar turno/rodada | event log | read-modify-write de `event_log` | `findCombatEventLog` + `replaceCombatEventLog` no mesmo client |
| finalizar combate | combate/histórico | update de combate + event log | `updateCombat` existe; composição com roster ainda usa Supabase |
| concluir `mesa_battles` | histórico | `completeActiveBattle` via Supabase | `findActiveBattle`/`updateBattle` existem, mas o snapshot composto ainda não foi migrado |

## O que já pode participar da transação

Quando recebidos de `context.repository`, os seguintes métodos não adquirem
conexões independentes:

- `listCombatantsByCombat` e `findCombatantById`;
- `updateCombatant`, inclusive `expected` para CAS;
- `updateCombat`;
- `findCombatEventLog` e `replaceCombatEventLog`;
- `findActiveBattle`, `listBattles` e `updateBattle`;
- `completeBattle`, com condição `status = 'active'` para conclusão idempotente;
- `updateSession` para `net_architectures`, quando o domínio tiver validado o
  payload.

Para tornar a futura limpeza de ICE explícita no contrato, foram adicionados
`findSessionNetArchitectures` e `updateSessionNetArchitectures`. Ambos os
adapters os implementam; no modo local, quando chamados por
`context.repository`, usam o mesmo `PoolClient`.

O `LocalPostgresResolutionStore` também usa o `Queryable` recebido. RPCs SQL
locais chamadas por ele permanecem na mesma conexão quando o store é criado
por `context.resolutionStore`.

Não foram adicionados métodos de regra de jogo aos adapters: Actions, dano,
ordem, efeitos e seleção do próximo combatant continuam no domínio.

## Bloqueios ainda existentes

1. `advanceActiveTurn` lê e grava diretamente via `db()`/Supabase.
2. `clearNetIceEngagement` ainda chama `db()` diretamente; os novos métodos de
   Architecture estão preparados, mas o domínio ainda não os utiliza no
   avanço.
3. `applyQuickhackEndTurnEffects` executa engine, CAS e eventos em chamadas
   ainda não compostas no caminho local.
4. `recoverAllNetrunnerRam` faz várias escritas diretas sem contexto.
5. `completeActiveBattle` combina combatants, combate, event log e
   `mesa_battles` fora do contexto local.
6. O encerramento automático exige histórico e permanece fora desta etapa.
7. Outros consumidores NET/ICE/stealth/detecção e resoluções continuam em
   famílias não migradas.

Por esses motivos, não foi criada uma versão local parcial de
`advanceActiveTurn` e não foi liberada a exclusão do combatant ativo.

## Critérios objetivos para a próxima migração

- o método recebe um `LocalPostgresTransactionContext` ou é chamado dentro de
  `withLocalPostgresTransaction`;
- todas as leituras e escritas usam `context.repository`,
  `context.resolutionStore` ou queries auxiliares no próprio context;
- combate e combatants são bloqueados antes da seleção do próximo turno;
- atualizações de HP/efeitos mantêm CAS;
- event log e snapshot de batalha são gravados antes de um único commit;
- encerramento automático reverte combate, event log, roster e histórico em
  qualquer falha;
- publicação ocorre somente após o commit;
- testes PostgreSQL verificam avanço normal, término, efeitos, locks,
  rollback e isolamento entre sessões.

## Testes preparados

`tests/mesa-local-transaction-context.test.ts` foi ampliado para exercitar,
sem execução nesta etapa, a composição de updates de combatants, combate,
event log, sessão e battle no mesmo contexto, além de rollback de falha
intermediária.

## Arquivos alterados

- `tests/mesa-local-transaction-context.test.ts`
- este documento

Nenhuma migration foi criada, nenhum fluxo foi habilitado e nenhum commit foi
feito.

**Nenhum teste, TypeScript, build ou lint foi executado.**
