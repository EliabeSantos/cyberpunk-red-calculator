# F1.66.4 — Escritas compostas de `mesa_combatants`

> **Atualização (F1.66.5):** a pendência de "PostgreSQL local descartável"
> descrita abaixo foi resolvida — ver `docs/f1-66-5-local-postgres-validation.md`,
> que também registra a correção de uma migration e a execução real da suíte
> local. Este documento permanece como registro da etapa F1.66.4.

> Executado em 09/10/2026. Supabase continua sendo a única implementação
> funcional. Nenhum modo local, WebSocket local ou seleção de hospedagem foi
> criado; nenhum commit foi feito.

## 1. Inventário das operações de escrita em `mesa_combatants`

| Família | Onde no `store.ts` | Operação | Invariante |
| --- | --- | --- | --- |
| **Materialização** | `insertCombatantRows` (chamada por `startCombat` e `addEnemies`) | `insert` | recusa PK duplicada; retry remove colunas de migração pendente sem derrubar o combate |
| **Materialização** | `syncActiveNetIceCombatants` | `upsert (onConflict: id)` | identidade completa no payload; colunas fora do payload preservadas |
| **Materialização** | `rollInitiativeForAll` | `upsert (onConflict: id)` | idem; `sort_order` canônico |
| **Materialização** | reinício de combate / `removeCombatant` | `delete` por `combat_id` / `id` | escopo obrigatório; nunca "apagar tudo" |
| **HP / espelho** | `updateEnemyHp` (CAS em `hp_current`) | `update` condicional | perda de CAS = no-op observável |
| **Movimento** | gateway de movimento | RPC `commit_mesa_move_resolution_atomic` | `resolutionId`, CAS, idempotência |
| **Ações** | `registerMesaRoll` (débito de ação) | `update` com `expected` em `actions_remaining`, `movement_remaining`, `is_dead` | 0 linhas = `409 action_conflict` |
| **Netrunner / detecção / stealth / posição / condições** | ~20 chamadas | `update` com escopo `session_id`/`combat_id` | isolamento por Mesa |
| **Iniciativa ICE / sort** | `syncNetIceInitiative` | `update` pontuais | `expected` em `initiative is null` |

## 2. Migração desta etapa: família **materialização**

Novos métodos em `MesaRepository` (`src/lib/mesa/infrastructure.ts`):

```ts
insertCombatants(rows, context): Promise<void>;
upsertCombatants(rows, context): Promise<void>;   // onConflict: "id"
deleteCombatants(scope: CombatantScope, context): Promise<void>;
```

- `CombatantScope` é uma união que exige **pelo menos uma chave** (`id`,
  `combatId` ou `sessionId`); o adapter recusa escopo vazio também em tempo de
  execução, antes de qualquer chamada ao banco.
- `context` é a mensagem de erro que o domínio já usava ("Falha ao criar os
  combatentes", etc.): o adapter apenas acrescenta o detalhe vindo do banco,
  mantendo os mesmos textos de erro observáveis.
- `SupabaseMesaRepository` implementa os três métodos com `insert`,
  `upsert(..., { onConflict: "id" })` e `delete` encadeado nos filtros de
  escopo.

Consumidores migrados (5 pontos, todos em `store.ts`):

1. `insertCombatantRows` — a retirada de colunas de migração pendente
   (`sourceKeySupport`/`suppliesSupport`/`tacticalPositionSupport`) continuou
   no domínio: só o `insert` em si saiu do store;
2. `syncActiveNetIceCombatants` (upsert de ICE);
3. `rollInitiativeForAll` (upsert de iniciativa/ordem);
4. reinício de combate (delete por `combat_id`);
5. `removeCombatant` (delete por `id`).

Telemetria preservada: cada chamada é envolvida por `measureMesaDb(...)` com o
mesmo nome de operação que `query()`/`stableMesaDbOperation` produzia antes
(`criar os combatentes`, `adicionar inimigos`, `sincronizar combatantes ICE`,
`salvar a iniciativa`, `limpar combatentes`, `remover o combatente`), e os
erros continuam sendo `DatabaseQueryError` com o mesmo prefixo de contexto.

**O que ficou no domínio (de propósito):** montagem dos payloads, regras de
materialização, detecção de colunas de migração, autorização, event-log e
publicação pós-commit.

## 3. Ordenação / identidade do ator (caso do reload)

`reloadIntegrated` escolhia o ator com `rows.find(participant_id = participante
e kind = 'character')` sobre um `SELECT` **sem `ORDER BY`**. Com duas linhas de
personagem para a mesma participação, a ordem física do Postgres decidia — e
como o ataque reescreve a linha, a ordem muda entre leituras (evidência em
`docs/f1-66-3-persistence-contracts.md`).

Solução: `selectParticipantCharacter(rows, participant, activeCombatantId)`
(em `src/lib/mesa/store.ts`), com regra explícita:

1. o combatente **ativo** quando pertence ao participante (o mesmo que a
   autoridade de turno vai julgar);
2. a linha ligada ao personagem da participação (`participant.characterId`);
3. ordem canônica da Mesa (`sort_order`, com `id` como desempate estável).

Aplicada nos três pontos idênticos: reload (`reloadIntegrated`), ator de
Hackable Object e ator de Quickhack. Nenhuma linha de outro participante, `kind`
ou Mesa sai da seleção.

Comportamento de gameplay **não mudou** no caso normal (uma linha por
participante, ambas as regras apontam para a mesma linha). Testes novos em
`tests/mesa-participant-character-selection.test.ts` (7 casos):

- ordem de leitura do banco não interfere;
- turno ativo vence, inclusive com linhas invertidas;
- `characterId` vinculado desempata sem turno;
- linha de outro participante/kind nunca é capturada;
- `authorizeCombatAttackActor` continua recusando `combatant_not_owned` (403)
  e `combatant_not_found` (404);
- `resolveAction` continua negando `not_your_turn` quando o turno é de outro.

## 4. Testes de contrato — o que foi executado de verdade

### Suíte reutilizável

`tests/contract/mesaRepositoryContractSuite.ts` define 8 casos, qualquer alvo
executa:

1. insert persiste payload e escopo (session/combat);
2. insert de id repetido → erro com contexto do domínio, linha original
   preservada;
3. upsert substitui só as colunas do payload e mantém a identidade;
4. leitura com escopo de outra Mesa/combate devolve `null`;
5. `updateCombatant` com CAS aplicado (1 linha) e CAS divergente (0 linhas),
   com o valor vencedor persistido;
6. update com escopo de outra Mesa não altera a linha;
7. delete remove apenas o escopo nomeado (id / combate), preservando a outra
   Mesa;
8. delete sem escopo é recusado sem tocar o banco.

### Alvos

| Alvo | Arquivo | Resultado desta execução |
| --- | --- | --- |
| Adaptador **Supabase** (PostgreSQL real via PostgREST, remoto) | `tests/mesa-repository-contract-supabase.test.ts` | **8/8 executados e aprovados** |
| **PostgreSQL local** descartável + adaptador local | `tests/mesa-repository-contract-local.test.ts` | **8/8 skipados**, motivo explícito: sem `MESA_LOCAL_TEST_DATABASE_URL` e sem adaptador local |
| Cliente **fake** (só mapeamento de chamadas) | `tests/mesa-infrastructure-contract.test.ts` | 6/6 — **não** é prova de equivalência SQL |

Preparação segura para o alvo local:

- `scripts/apply-contract-migrations.sh` aplica as 28 migrations em ordem
  lexicográfica em um banco informado por `MESA_CONTRACT_DATABASE_URL`;
  recusa rodar sem a variável e recusa nomes que não pareçam descartáveis
  (`contract`/`test`/`tmp`/`disposable`); não executa DROP/TRUNCATE.
- O script **não foi executado**: este ambiente não tem servidor PostgreSQL
  instalado (somente o cliente `psql`; sem Docker; `sudo` exige senha
  interativa). A validação local real continua **pendente** — decisão
  registrada com o usuário em 09/10/2026.

**Conclusão de cobertura:** os contratos de materialização, escopo e CAS estão
cobertos contra PostgreSQL real (via Supabase). A equivalência com um
PostgreSQL *local* — incluindo a aplicabilidade das migrations fora do
Supabase — **não** está demonstrada.

## 5. Diagnóstico da instabilidade de `mesa-attack-http-postgres`

O teste de concorrência HTTP falhava intermitentemente. Com diagnóstico
temporário (removido depois) capturamos o segundo modo: nas duas resoluções
concorrentes com `resolutionId` diferente, o perdedor devolveu
`400 target_defeated` — ele leu o alvo **depois** do commit vencedor, que o
derrotou. As recusas possíveis são:

- `409 action_conflict` — leu antes e perdeu o CAS;
- `403 insufficient_actions` — leu depois, orçamento já gasto;
- `400 target_defeated` — leu depois, alvo já derrotado.

A asserção foi ajustada para o invariante real — **exatamente uma aplicação e
exatamente uma recusa**, com o código da recusa pertencendo a esse conjunto —
em vez de exigir `409` fixo. Nenhuma autorização foi afrouxada: dois `200`
ainda falha, e código fora do conjunto também falha. Cinco execuções
consecutivas passaram depois da troca; o modo do reload (`403 not_your_turn`)
desapareceu com a correção de seleção do item 3.

## 6. Ainda acoplado a `store.ts`

- Leituras de `mesa_combats`/`mesa_combatants` que alimentam projeção,
  iniciativa, turno e validação de alvos (métodos de leitura de F1.66.3 existem,
  mas a maioria dos call sites ainda consulta direto);
- mutações compostas de HP, movimento (RPC), ações, netrunner, detecção,
  stealth, posição, condições e `event_log`;
- payloads e sequências claim/commit das RPCs de ataque, reload, item, dano,
  cura, death save, NET e quickhack;
- regras de Cyberpunk RED, autorização, gateways e publicação pós-commit.

## 7. Próximos bloqueios do modo local

1. **Adapter local de `MesaRepository`** — implementar os contratos (leitura,
   materialização, CAS) contra PostgreSQL direto, sem PostgREST.
2. **PostgreSQL descartável em execução** — instalar/subir um servidor e rodar
   `scripts/apply-contract-migrations.sh`; se alguma migration depender de
   objetos exclusivos do Supabase, corrigir nas migrations (nunca com DDL
   manual por fora).
3. **Rodar `tests/mesa-repository-contract-local.test.ts` de verdade** — só aí
   a equivalência local deixa de ser pendência.
4. Famílias restantes de extração (HP/movimento/ações, depois netrunner e
   event-log) e, por fim, `ResolutionStore` local + transporte de invalidações.

Nada disso foi declarado pronto: o modo local continua não existindo.
