# F1.66.22 — Combate e materialização no PostgreSQL local

## Resultado da auditoria

`getMesaState` já utilizava o repository selecionado desde a etapa anterior:

- `findSessionById`;
- `listParticipantsBySession`;
- `findCombatBySession`;
- `listCombatantsBySession`.

Isso preserva a ordenação `sort_order ASC NULLS LAST, id ASC`. A projeção
GM/jogador, visibilidade NET, mapa e estado privado continuam sendo calculados
no domínio/store, depois da leitura; nenhum adapter decide visibilidade.

## Contratos/adapters ampliados

Foram adicionados a `MesaRepository` e implementados nos adapters Supabase e
PostgreSQL local:

- `createCombat`;
- `updateCombat` com `combat_id` e `session_id` obrigatórios;
- tipos `MesaCombatCreate`.

Os adapters apenas persistem os campos recebidos. Status, rodada, iniciativa,
HP, ações, condições e regras continuam sob responsabilidade do domínio.

## Bloqueio de migração do fluxo de início

O fluxo `startCombat` ainda não foi migrado para local. Ele combina, na mesma
sequência:

1. consulta/reserva de `mesa_battles` e UNIQUE de `encounter_id`;
2. leitura de participantes e fichas;
3. reset ou criação de `mesa_combats`;
4. remoção e inserção de vários `mesa_combatants`;
5. atualização de sessão;
6. append no event log;
7. snapshot inicial do histórico;
8. compensação da reserva em caso de falha.

Como histórico e event log estão fora do escopo F1.66.22, substituir apenas
algumas escritas por queries locais criaria estados mistos e perderia rollback.
Por isso, `startCombat`, `addEnemies`, `removeCombatant`, iniciativa e demais
mutações compostas continuam no caminho atual até existir uma operação
transacional agregada no repository/serviço apropriado.

Nenhuma operação foi substituída por várias escritas independentes para fingir
atomicidade.

## Garantias e limitações

- Leituras migradas usam escopo de sessão.
- A ordenação dos combatants foi mantida nos dois adapters.
- `createCombat` e `updateCombat` estão preparados para uma etapa posterior,
  mas ainda não são usados pelo fluxo composto de início/reinício.
- HP, ações e CAS existentes permanecem disponíveis, mas consumidores de
  combate ainda instanciam adapters Supabase diretamente.
- Não foram migrados inventário, mapa tático, NET, stealth, detecção, ICE,
  histórico ou resoluções.
- A presença das migrations no banco de runtime ainda precisa ser verificada;
  o lifecycle local não substitui validação de schema/RPC.

## Arquivos alterados

- `src/lib/mesa/infrastructure.ts`
- `src/lib/mesa/localPostgresInfrastructure.ts`
- `src/lib/mesa/supabaseInfrastructure.ts`
- este documento

Nenhuma migration foi alterada e nenhum commit foi criado.

**Nenhum teste, TypeScript, build ou lint foi executado.**
