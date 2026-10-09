# F1.66.25 — Início e reinício de combate no PostgreSQL local

## Fluxo reconstruído

O fluxo anterior de `startCombat` executava, nesta ordem:

1. autenticação, autorização GM e validação de sessão ativa;
2. consulta do encontro em `mesa_battles`;
3. consulta do combate vivo da sessão;
4. leitura dos participantes e fichas vinculadas;
5. reserva da partida, quando necessária;
6. remoção/reset do combate existente ou criação de `mesa_combats`;
7. materialização dos personagens e inimigos em `mesa_combatants`;
8. atualização da sessão para `active`;
9. gravação do evento `combat_started`;
10. snapshot inicial dos combatants em `mesa_battles`.

No caminho anterior, a reserva era compensada por `delete` em caso de erro,
mas as escritas não formavam uma transação única. O caminho local agora inclui
todas essas mutações no mesmo contexto PostgreSQL.

## Implementação local

`startCombat` seleciona a factory antes de qualquer leitura específica do
combate. Em `local`, chama `beginLocalTransaction()` e usa exclusivamente:

- `context.repository` para sessões, combate, participantes, personagens,
  battles e combatants;
- `context.query` para `SELECT ... FOR UPDATE` das linhas concorrentes;
- o mesmo `PoolClient` durante toda a operação.

As linhas de batalha vinculadas ao encontro, o combate da sessão e os
participantes da sessão são bloqueados antes da decisão de iniciar/reiniciar;
as fichas vinculadas são protegidas com `FOR SHARE` antes da materialização.
O `UNIQUE(encounter_id)` continua sendo a autoridade final para corridas entre
transações que ainda não possuem uma linha de encontro.

Em sucesso ocorre um único `COMMIT`, seguido de `release`. Em qualquer erro,
ocorre `ROLLBACK` e a conexão é devolvida ao pool. Assim, não ficam reservas,
combatants, reset de combate, alteração de sessão, log ou snapshot parciais.

## Regras preservadas

- encontro concluído continua recusado;
- encontro ativo em outra sessão continua recusado;
- reinício sem `restart: true` continua recusado;
- combate ativo sem partida reutilizável continua recusado;
- participantes sem personagem são ignorados;
- `gm_only`/`character` continua sendo decidido no store;
- HP, Actions, MOVE, snapshots, supplies, posições, ordem e campos de inimigo
  continuam sendo montados pelo mesmo domínio;
- adapters não projetam dados por papel nem calculam regras de jogo.

## Efeitos dentro e fora da transação

Dentro da transação ficam a reserva/reutilização da partida, reset/criação do
combate, remoção e inserção de combatants, atualização de sessão, event log e
snapshot inicial da partida.

A invalidação externa é publicada somente pela rota, depois que `startCombat`
retorna com o commit concluído. A rota usa o `MesaEventTransport` da factory:
Supabase no modo Supabase e transporte local em memória no modo local. O evento
carrega somente a invalidação da sessão; nenhum snapshot, token ou dado privado
é transmitido.

## Supabase

O caminho Supabase existente de `startCombat` não foi substituído nem recebeu
uma simulação de transação por chamadas independentes. A implementação local é
selecionada explicitamente pela factory; no modo local, o fluxo migrado não
chama `getSupabaseAdmin`, `.from()` ou `.rpc()`.

## O que permanece fora do escopo

Não foram migrados:

- encerramento de combate;
- iniciativa isolada;
- remoção/atualização posterior de combatants;
- inventário, mapa, NET, stealth, detecção, ICE e resoluções;
- materialização dos fluxos que ainda usam Supabase diretamente.

Esses fluxos não podem reutilizar a garantia desta etapa até receberem o mesmo
contexto explicitamente.

## Testes e limitações

O teste de contexto transacional existente cobre commit, rollback, falha de
commit, isolamento e reutilização segura. A próxima cobertura deverá executar
o fluxo completo contra PostgreSQL local e verificar estado de battle, combate,
combatants, sessão e event log após sucesso e rollback. Também deverá cobrir
concorrência real de dois inícios do mesmo encontro e o bloqueio por `UNIQUE`.

Nenhuma migration foi criada. A presença das migrations no banco de runtime
continua sendo pré-requisito.

## Arquivos alterados

- `src/lib/mesa/store.ts`
- `src/app/api/mesa/[id]/combat/route.ts`
- este documento

**Nenhum teste, TypeScript, build ou lint foi executado.**
