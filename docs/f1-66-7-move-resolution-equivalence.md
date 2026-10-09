# F1.66.7 — Resolução atômica de movimentação

## Fluxo auditado

`movePlayerCombatant` mantém a sequência existente:

1. autentica `sessionId` + `x-mesa-token`;
2. valida papel, sessão ativa, `resolutionId`, ator e destino;
3. valida posse, tipo do combatente, turno, geometria, distância, Access Point
   e estado de Netrunner no domínio;
4. consulta/reproduz resolução existente;
5. reivindica a resolução por `claim_mesa_attack_resolution`;
6. relê o ator e o estado atual antes de calcular o resultado;
7. executa a regra pura `resolveAction`/`applyAction`;
8. chama `commit_mesa_move_resolution_atomic`;
9. somente depois do commit tenta escrever `event_log` e retorna o resultado;
10. em erro, libera a claim; a RPC oficial faz rollback do CAS e da resolução.

A publicação/invalidação permanece fora do commit e depois dele, através da
sequência já existente da rota. O event-log é apresentação: falha nele não
desfaz orçamento ou resultado já persistido.

## Contrato

`ResolutionStore.commitMove` agora retorna explicitamente:

```ts
{ status: "committed" | "already_committed"; result: TResult | null }
```

O adapter Supabase chama a RPC e normaliza a primeira linha retornada. O novo
`LocalPostgresMoveResolutionStore` chama a **mesma função SQL oficial** via
`pg`; não reproduz locks, claim, CAS ou idempotência em TypeScript.

Os argumentos `p_*` continuam sendo montados pelo domínio. O adapter não
calcula distância, custo, posição, alvo, turno ou estado de Netrunner.

## Invariantes transacionais preservados

`commit_mesa_move_resolution_atomic` continua responsável por:

- lock da linha de resolução (`FOR UPDATE`);
- replay `already_committed`;
- validação de claim e `claim_token`;
- CAS de `combat_id`, `movement_remaining`, `actions_remaining` e `is_dead`;
- atualização de posição/estado de Netrunner;
- marcação da resolução como committed na mesma transação;
- rollback completo em `movement_conflict` ou `transaction_failed`.

## Testes de contrato reais

`tests/contract/moveResolutionContractSuite.ts` executa os mesmos cinco casos
nos dois adapters:

- movimentação válida;
- replay com o mesmo `resolutionId`;
- duas chamadas concorrentes, com um commit e um replay;
- conflito CAS sem alteração parcial;
- resolução fora do escopo sem alterar o combatente.

Resultados:

| Ambiente | Resultado |
| --- | ---: |
| PostgreSQL local real, 28 migrations | **5/5** |
| Supabase remoto real | **5/5** |

Os fixtures criam sessões, combates, combatente e resolução `processing`, e
removem tudo por cascata ao final de cada caso.

## Bloqueios restantes

- `ResolutionStore` local ainda não é completo: somente `commitMove` foi
  implementado como slice desta etapa;
- claims/recovery e demais commits de ataque, reload, item, dano, death save,
  NET e quickhack continuam sem adapter local;
- seleção explícita de hospedagem e integração das rotas continuam fora do
  escopo;
- transporte de invalidações/WebSockets locais permanece pendente.

O self-hosting não está pronto e nenhum commit foi criado.
