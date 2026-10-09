# F1.66.30 — Integração transacional de NET/ICE e Quickhack

## Resultado

As operações necessárias foram auditadas e a interface de Architecture da
sessão foi explicitada nos adapters. `advanceActiveTurn` continua não
migrado, e nenhuma exclusão de combatant ativo foi liberada.

## Operações localizadas

### NET/ICE

- `clearNetIceEngagement`: lê `mesa_sessions.net_architectures`, remove o
  vínculo `engagedNetrunnerId` do nó Black ICE e grava a arquitetura;
- `syncActiveNetIceCombatants`: materializa/atualiza combatants `net_ice` a
  partir da Architecture;
- `syncNetIceInitiative`: lê e atualiza iniciativa/ordenação de ICE;
- `recoverAllNetrunnerRam`: lê `netrunner_state` e restaura RAM;
- operações de Jack In/Out, reparo e destruição de cyberdeck também podem
  limpar Architecture e estado NET, mas não fazem parte do avanço migrado.

### Quickhack

- `activeQuickhackEffects`: cálculo puro dos efeitos vigentes;
- expiração: atualiza `net_effects` e `conditions`;
- `applyQuickhackEndTurnEffects`: executa o Combat Engine, aplica dano com CAS
  em `hp_current`, atualiza o efeito e grava evento de Overheat;
- reset de Actions/MOVE e estado `netrunner_state` do próximo combatant.

### Infraestrutura já compatível

`LocalPostgresMesaRepository`, quando construído no contexto, já permite:

- leitura/listagem de combatants;
- updates genéricos com escopo de sessão/combate;
- CAS via `expected`;
- update de `mesa_combats`;
- leitura/substituição de event log;
- update de sessão e de battle.

Foram adicionados ao contrato e aos adapters:

- `findSessionNetArchitectures(sessionId)`;
- `updateSessionNetArchitectures(sessionId, architectures)`.

Esses métodos não normalizam Architecture nem decidem regras NET: recebem e
devolvem dados persistidos. No local, usam o `Queryable` recebido, portanto
podem operar sobre o mesmo `PoolClient` de `LocalPostgresTransactionContext`.
O adapter Supabase mantém a implementação equivalente sem alegar transação
composta.

## Garantias preservadas

- lógica de Quickhack, dano, duração, condições e RAM continua em funções de
  domínio/puras;
- updates que já usam CAS continuam disponíveis no repository;
- escopos de sessão e combate permanecem obrigatórios nas escritas de
  combatants;
- nenhum fallback para Supabase foi introduzido no modo local;
- nenhuma chamada foi adicionada a `advanceActiveTurn`.

## Bloqueios restantes

1. `clearNetIceEngagement`, `syncActiveNetIceCombatants`,
   `syncNetIceInitiative`, `recoverAllNetrunnerRam` e
   `applyQuickhackEndTurnEffects` ainda são funções do store que chamam
   `db()` diretamente.
2. O dano periódico precisa executar engine, CAS, efeitos e event log no mesmo
   contexto antes de ser usado no avanço.
3. A limpeza de Architecture deve bloquear a sessão e ser composta com o
   `netrunner_state` do combatant.
4. Encerramento automático e materialização final de `mesa_battles` continuam
   fora desta etapa.
5. RPCs/resoluções NET existentes ainda não foram convertidos em consumidores
   de um contexto de avanço; não foram simuladas chamadas independentes.

Como esses efeitos ainda não compartilham efetivamente uma única transação,
não há atomicidade local garantida para `advanceActiveTurn` e o bloqueio do
combatant ativo permanece.

## Critérios de aceite futuro

- funções de domínio recebem um contexto explícito, sem chamar `db()`;
- Architecture, combatants, combate e event log usam o mesmo client;
- dano periódico mantém CAS em HP e atualiza o efeito uma única vez;
- locks cobrem combate, combatants afetados e sessão/Architecture;
- falha em NET, Quickhack ou persistência reverte todas as alterações;
- nenhum encerramento/histórico é executado parcialmente;
- testes reais verificam RAM, condições, duração, Overheat, ICE e isolamento.

## Testes preparados

`tests/mesa-local-transaction-context.test.ts` foi ampliado para exercitar o
uso conjunto de updates de combatants, combate, event log, sessão e battle no
mesmo contexto. Os testes não foram executados.

## Arquivos alterados

- `src/lib/mesa/infrastructure.ts`
- `src/lib/mesa/localPostgresInfrastructure.ts`
- `src/lib/mesa/supabaseInfrastructure.ts`
- `tests/mesa-local-transaction-context.test.ts`
- este documento

Nenhuma migration foi criada e nenhum commit foi feito.

**Nenhum teste, TypeScript, build ou lint foi executado.**
