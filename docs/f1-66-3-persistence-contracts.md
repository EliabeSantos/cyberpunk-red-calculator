# F1.66.3 — Contratos de persistência da Mesa

Esta etapa amplia os contratos sem alterar o schema, as rotas ou as regras.
O adapter Supabase continua sendo a única implementação funcional.

## `mesa_combats`

| Operação observada no store | Responsabilidade | Invariante |
| --- | --- | --- |
| `select` por `session_id` | localizar o combate da Mesa | sessão é o escopo obrigatório |
| `select` por `id` | consultar combate carregado | `session_id` deve ser aplicado quando disponível |
| `update` de `status`, turno e `event_log` | persistir transição do combate | somente após autorização e resolução do servidor |
| `select event_log` + `update event_log` | acrescentar evento | evento deriva do estado autoritativo, nunca do snapshot do cliente |

Essas leituras agora estão representadas por `findCombatBySession` e
`findCombatById` em `MesaRepository`. As mutações de combate continuam no
store porque ainda exigem agrupar validação, atualização de combatants,
event-log e publicação em uma única sequência controlada.

## `mesa_combatants`

O store usa as seguintes classes de operação:

- listar por `combat_id` ou `session_id` para projeção, iniciativa, turno e
  validação de alvos;
- localizar por `id` com escopo de `combat_id`/`session_id`;
- inserir e fazer `upsert` durante materialização de participantes, inimigos e
  ICE;
- atualizar estado de netrunner, stealth, detecção, posição, HP, munição,
  suprimentos, ações e movimento;
- remover combatants ao reconstruir ou encerrar combate;
- atualizações condicionais de HP, movimento, ações e estados derivados.

`MesaRepository` agora cobre as leituras principais e
`updateCombatant({ id, sessionId, combatId, patch, expected })`. O campo
`expected` é o ponto explícito para CAS; o adapter Supabase o transforma em
filtros `eq`/`is` e retorna as linhas afetadas. O consumidor continua
responsável por interpretar `0` linhas como conflito.

Inserção, remoção, upsert e mutações compostas permanecem acopladas ao store
nesta etapa para não separar incorretamente operações que dependem de
autorização, estado atual e publicação pós-commit.

## Famílias de RPC

`ResolutionStore` agora descreve as famílias presentes nas migrations e no
store:

| Família | Claim/recovery/release | Commit |
| --- | --- | --- |
| Ataque | `mesa_attack_resolutions` | ataque integrado |
| Reload | `mesa_reload_resolutions` | reload |
| Item | `mesa_item_consume_resolutions` | consumo e cura |
| Movimento | claim de ataque | `commit_mesa_move_resolution_atomic` |
| Death save | claim de ataque | `commit_mesa_death_save_resolution` |
| Cover | claim de ataque | `commit_mesa_attack_cover_resolution` |
| NET action | claim de ataque | `commit_mesa_net_action_resolution` |
| Quickhack | claim de ataque | `commit_mesa_quickhack_resolution` |

Os métodos de commit recebem argumentos `p_*` já validados pelo store. O
adapter não executa o Combat Engine, não recalcula HP, não escolhe alvo e não
altera `resolutionId`. Locks, transações, `claim_token`, estados
`processing/committed/failed`, CAS e idempotência continuam nas funções SQL.

## Testes de contrato

`tests/mesa-infrastructure-contract.test.ts` verifica sem conexão remota:

- filtros de sessão/combate nas leituras;
- preservação do filtro CAS em atualizações de combatant;
- mapeamento de claim/release/commit para RPCs específicos;
- propagação de `DatabaseQueryError` sem inventar resultado.

Os testes não comprovam que PostgreSQL local possui as mesmas migrations; essa
validação continua sendo requisito da futura implementação local.

## Observação: flakiness de `tests/mesa-attack-http-postgres.test.ts`

Durante a validação este teste remoto falhou intermitentemente. Uma execução
com diagnóstico capturou a causa de um dos modos: o reload retornou
`403 not_your_turn`. A fixture cria **dois** combatentes `character` para o
mesmo participante (`playerActorId` e `actionActorId`), e `reloadIntegrated`
resolve o ator com `rows.find(participant_id === participante && kind === "character")`
sobre um `select` **sem `ORDER BY`**. Como o ataque reescreve a linha de
`playerActorId`, a ordem de leitura do Postgres pode devolver `actionActorId`
primeiro; esse combatente não é o `active_combatant_id` e a negação é correta.

Esse trecho é idêntico ao `HEAD` (`git show HEAD:src/lib/mesa/store.ts`) e o
arquivo de teste não tem diff em relação ao `HEAD`; a ambiguidade é da fixture
(dois personagens por participante), não da extração de F1.66.3. O segundo modo
(`409 action_conflict` ausente na disputa concorrente) não pôde ser reproduzido
com diagnóstico: 20 execuções subsequentes passaram, incluindo duas suítes
completas.

Nenhum teste de autorização foi enfraquecido e nenhum teste foi alterado além
da correção da identidade `gm_id` descrita acima.

## Correção da fixture de `tests/engine-mesa-integration.test.ts`

As sete falhas da linha de base (`f1662`) vinham de `gm_id: "gm"` na sessão
enquanto o participante GM tem id `"gm-participant"`. `requireGM()` exige
`session.gmId === participant.id`, então a rejeição estava correta. A fixture
foi corrigida para `gm_id: "gm-participant"` (uma Mesa válida); nenhuma regra
de autorização foi afrouxada, e rejeições de identidades incompatíveis seguem
cobertas por `tests/mesa-player-authorization.test.ts`.

## Ainda acoplado

`src/lib/mesa/store.ts` ainda constrói diretamente a maioria das consultas de
`mesa_combats`/`mesa_combatants`, as mutações compostas e os payloads de RPC.
Isso é intencional: a próxima extração deve migrar uma família completa por
vez, preservando a ordem autenticar → ler estado atual → validar → resolver →
commit → invalidar.
