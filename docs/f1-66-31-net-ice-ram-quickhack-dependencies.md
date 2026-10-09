# F1.66.31 — Dependências NET/ICE, RAM e Quickhack

## Resultado

Foram preparadas variantes orientadas a `MesaRepository` para as dependências
necessárias ao futuro `advanceActiveTurn`. Elas não chamam `db()`, não criam
conexões e não foram conectadas ao fluxo público de avanço.

As funções públicas/atuais continuam no caminho existente até que todas as
dependências possam ser compostas. Portanto, ainda não há atomicidade local
declarada para `advanceActiveTurn`.

## Operações preparadas

### Architecture e ICE

- `clearNetIceEngagementWithRepository` lê e atualiza
  `mesa_sessions.net_architectures` via `MesaRepository`;
- `syncActiveNetIceCombatantsWithRepository` lê a Architecture, preserva
  iniciativa existente e materializa/atualiza ICE via `upsertCombatants`;
- `syncNetIceInitiativeWithRepository` calcula iniciativa com a mesma regra,
  usa CAS `initiative IS NULL` e reordena via updates escopados.

As funções de domínio continuam responsáveis por normalização, identificação
de nós e rolagem. Os adapters apenas persistem payloads.

### RAM

- `recoverAllNetrunnerRamWithRepository` lista combatants do combate e atualiza
  `netrunner_state` por sessão/combate;
- a escrita usa o estado anterior como `expected`, mantendo proteção CAS para
  concorrência.

### Quickhack/Overheat

- `applyQuickhackEndTurnEffectsWithRepository` usa o mesmo Combat Engine;
- aplica o dano e atualiza `net_effects` com CAS em `hp_current`;
- grava o evento de Overheat através de
  `appendEventWithRepository`, que usa read-modify-write no mesmo repository;
- o chamador transacional deverá manter o lock de `mesa_combats` durante o
  event log.

### Event log

`appendEventWithRepository` foi preparado para preservar timestamp, deduplicação
por `resolutionId` e limite de 50 eventos sem obter outro client.

## Contexto compartilhado

Todas as variantes recebem `MesaRepository`. Quando esse objeto é
`context.repository`, os seguintes elementos usam o mesmo `PoolClient`:

- Architecture da sessão;
- combatants, incluindo CAS de HP, estado NET, efeitos e iniciativa;
- combate;
- event log.

As chamadas Supabase correspondentes permanecem implementadas no adapter
Supabase, mas não são apresentadas como uma transação composta.

## Bloqueios restantes

1. Consumidores públicos NET/ICE fora de `advanceActiveTurn` ainda usam o
   caminho Supabase.
2. As funções Supabase legadas continuam chamando `db()` diretamente.
3. A seleção do próximo turno local agora compõe locks de combate e
   combatants com essas variantes.
4. Consumidores NET/ICE independentes e resoluções continuam fora desta etapa.
5. Turnos de combatants `net_ice` ainda são bloqueados no modo local.
6. A exclusão do combatant ativo continua bloqueada; não há fallback para
   apagar apenas a linha sem avançar o turno.

## Garantias e critérios de aceite

- nenhum método preparado adquire conexão independente;
- escopo de sessão/combate está presente nas escritas de combatants;
- CAS permanece aplicado ao HP, iniciativa e recuperação de RAM;
- falha em qualquer método deve ser propagada ao contexto para rollback;
- locks de combate/combatants devem ser adquiridos pelo futuro orquestrador;
- event log, estado NET e combatants devem confirmar em um único commit;
- publicação deve ocorrer somente após o commit;
- testes PostgreSQL devem validar Overheat, expiração, RAM, ICE, CAS e rollback.

## Testes preparados

`tests/mesa-local-transaction-context.test.ts` foi atualizado para exercitar
Architecture e as escritas de dependências no mesmo contexto, além do rollback
conjunto. Os testes não foram executados.

## Arquivos alterados

- `src/lib/mesa/store.ts`
- `src/lib/mesa/infrastructure.ts`
- `src/lib/mesa/localPostgresInfrastructure.ts`
- `src/lib/mesa/supabaseInfrastructure.ts`
- `tests/mesa-local-transaction-context.test.ts`
- este documento

Nenhuma migration foi criada e nenhum commit foi feito.

**Nenhum teste, TypeScript, build ou lint foi executado.**
