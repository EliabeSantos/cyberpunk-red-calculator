# F1.66.28 — Auditoria de `advanceActiveTurn` no PostgreSQL local

## Resultado

`advanceActiveTurn` **não foi migrado** nesta etapa. Não é seguro executar
apenas o cálculo do próximo combatant ou os resets de Actions dentro de uma
transação local, porque o fluxo atual possui dependências adicionais que ainda
usam o caminho Supabase.

A preparação detalhada dos adapters e dependências está em
`docs/f1-66-29-turn-dependencies-transactional-preparation.md`.

## Fluxo atual inventariado

O método:

1. lê todos os combatants pela ordem persistida;
2. desconecta Netrunners mortos e remove seus vínculos com ICE;
3. calcula o próximo combatant com `sortByInitiative` e `advanceTurn`;
4. quando termina, recupera RAM, marca o combate como `finished`, grava evento
   e conclui a partida em `mesa_battles`;
5. quando continua, expira efeitos temporários e condições relacionadas;
6. aplica efeitos periódicos de Quickhack e CAS de HP;
7. zera Actions/MOVE do combatant anterior;
8. recupera RAM e reinicia ações do próximo Netrunner;
9. inicializa Actions/MOVE do próximo combatant;
10. atualiza `active_combatant_id`, rodada e `turn_started_at`;
11. grava evento de turno ou rodada.

## Dependências que bloqueiam a transação local

As seguintes operações ainda não possuem uma implementação integrada ao mesmo
contexto PostgreSQL local:

- `clearNetIceEngagement`, que altera arquitetura/engajamento NET;
- `applyQuickhackEndTurnEffects`, que usa o engine e pode alterar HP, efeitos,
  condições e event log;
- `recoverAllNetrunnerRam`, que atualiza estado NET de vários combatants;
- `completeActiveBattle`, que lê combatants, combate e `mesa_battles` e grava o
  snapshot final do histórico;
- consumidores de event log e resoluções que podem concorrer com o avanço.

Além disso, o método atual não é uma operação isolada de um único combatant:
ele pode escrever várias linhas de combatants, `mesa_combats` e
`mesa_battles`. Migrar somente as escritas simples perderia atomicidade em
falhas intermediárias.

## Decisão de segurança

Nenhuma chamada parcial a `withLocalPostgresTransaction` foi adicionada para
fingir que o avanço está migrado. O caminho Supabase continua intacto.

Por consequência, a exclusão local do `active_combatant_id` continua recusada
com `active_combatant_delete_pending`. Apagar a linha sem executar todas as
dependências deixaria o ponteiro de turno e os efeitos relacionados
inconsistentes.

## Critérios para futura migração

Antes de habilitar `advanceActiveTurn` local, será necessário:

1. oferecer adapters locais para as mutações NET/Quickhack usadas pelo método;
2. incluir event log, combatants, combate e histórico no mesmo contexto;
3. preservar CAS de HP e efeitos;
4. bloquear o combate e as linhas afetadas antes de selecionar o próximo turno;
5. confirmar que falhas em qualquer dependência produzem rollback completo;
6. publicar invalidação somente depois do commit;
7. testar término automático e avanço normal contra PostgreSQL real.

Essa etapa não migra encerramento, NET como domínio completo, ICE, detecção,
stealth, inventário, mapa ou resoluções independentes.

## Arquivos alterados

- este documento

Não foram criadas migrations nem commits.

**Nenhum teste, TypeScript, build ou lint foi executado.**
