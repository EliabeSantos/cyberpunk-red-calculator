# F1.66.26 — `addEnemies` atômico no PostgreSQL local

## Fluxo auditado

O fluxo existente:

1. autentica o participante;
2. exige GM;
3. consulta combate ativo;
4. sanitiza a lista de inimigos;
5. consulta o maior `sort_order` do combate;
6. materializa os combatants inimigos, com HP, MOVE, Actions, iniciativa,
   snapshot, supplies e posição;
7. grava um evento no `mesa_combats.event_log`.

`addEnemies` não altera `mesa_battles`, fichas, sessão ou rodada. Também não
executa iniciativa: quando a iniciativa já começou, os inimigos entram com
`initiative = 0`, exatamente como no caminho Supabase existente.

## Caminho local implementado

Depois da autenticação e validação no store, o modo local usa
`withLocalPostgresTransaction`. O callback usa o `repository` e o
`PoolClient` do contexto compartilhado:

- bloqueia o combate da sessão com `FOR UPDATE`;
- relê e valida o combate ativo pelo repository;
- bloqueia os combatants do combate antes de calcular o próximo
  `sort_order`;
- insere todos os novos combatants em uma operação do repository;
- relê o event log dentro da mesma transação;
- acrescenta o evento e mantém o limite de 50 entradas;
- atualiza o event log com escopo de `combat_id` e `session_id`;
- confirma somente depois de todas as etapas.

Falha na inserção, no event log ou em qualquer etapa causa rollback da conexão;
não ficam combatants órfãos nem evento sem os combatants correspondentes.
`FOR UPDATE` impede que duas inclusões concorrentes escolham a mesma posição.

## Autorização e regras preservadas

Autenticação, autorização GM, validação de payload, sanitização, cálculo de
MOVE, Actions, HP, supplies, snapshots, iniciativa e posições continuam no
`store.ts`. O adapter somente persiste linhas prontas e aplica filtros de
sessão/combate.

Não foram adicionadas regras de Cyberpunk RED nem alterações de CAS. O lock é
apenas a proteção necessária para a leitura e atualização do `sort_order` e do
event log. O endpoint não possuía uma chave de idempotência própria; essa
semântica permanece igual, e um retry válido adiciona os inimigos novamente,
como no caminho Supabase.

## Publicação e Supabase

A rota POST publica somente após o retorno bem-sucedido de `addEnemies`, logo
após o commit, usando o `MesaEventTransport` selecionado pela factory. O
payload continua sendo apenas uma invalidação.

O caminho Supabase de `addEnemies` permanece inalterado. A migração posterior
F1.66.27 cobre PATCH e DELETE no modo local, mantendo o publicador Supabase
para os fluxos ainda não migrados.

## Testes preparados

Os testes de contexto transacional cobrem uso de repositories compartilhados,
commit, rollback após falha intermediária, isolamento e devolução da conexão.
Ainda é necessária uma suíte de integração com PostgreSQL real para verificar
`addEnemies` completo, concorrência de `sort_order`, limite do event log e
estado persistido após rollback.

## Dependências e limitações restantes

- encerramento de combate, iniciativa isolada, inventário, mapa, NET, stealth,
  detecção, ICE e resoluções não foram migrados;
- `mesa_battles` não é alterada por `addEnemies`, preservando o comportamento
  atual;
- o modo local depende das migrations existentes no banco de runtime;
- o transporte local continua limitado ao processo atual.

Nenhuma migration foi criada e nenhum commit foi feito.

## Arquivos alterados

- `src/lib/mesa/store.ts`
- `src/app/api/mesa/[id]/combatants/route.ts`
- `tests/mesa-local-transaction-context.test.ts`
- este documento

**Nenhum teste, TypeScript, build ou lint foi executado.**
