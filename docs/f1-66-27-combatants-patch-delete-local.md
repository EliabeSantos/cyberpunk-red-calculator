# F1.66.27 — PATCH e DELETE de combatants no PostgreSQL local

## PATCH migrado

O caminho local de `updateCombatant` preserva:

- autenticação e autorização GM;
- escopo por `combatant_id`, `session_id` e `combat_id`;
- bloqueio de posição durante combate ativo;
- verificação de ocupação da posição;
- recusa de HP/morte de personagens durante combate ativo;
- clamp de HP de inimigos;
- normalização de `conditions` para 12 strings de até 40 caracteres;
- truncamento de `initiative` para inteiro;
- erro `empty_patch` quando nada é aplicável.

A operação usa `withLocalPostgresTransaction`, bloqueia o combatant com
`FOR UPDATE`, relê o combate no repository e aplica a atualização com filtros
de sessão e combate. O adapter não decide autorização nem regras de jogo.
PATCH não grava event log no comportamento existente, portanto não foi criado
um evento adicional.

Para posição, a validação continua usando as funções puras existentes de mapa
(`normalizeTacticalPosition` e `tacticalPositionsOverlap`); esta etapa não
migra o mapa tático.

## DELETE migrado parcialmente com bloqueio seguro

O DELETE local autentica, exige GM, bloqueia e relê o combatant, confirma que ele
é inimigo e remove a linha dentro da transação, sempre com filtros de sessão e
combate.

Quando o alvo é o `active_combatant_id`, a operação é recusada com
`active_combatant_delete_pending`. O caminho Supabase atual chama
`advanceActiveTurn`, que também pode:

- limpar estado de Netrunner/ICE;
- atualizar Actions e movimento;
- expirar efeitos;
- alterar o combate e o event log;
- finalizar a batalha e materializar histórico.

Esses consumidores ainda não compartilham o contexto local. Apagar somente o
combatant ativo seria uma migração parcial insegura, por isso não é feito
fallback nem exclusão incompleta. Combatants não ativos podem ser removidos
atomicamente, pois no caminho atual essa remoção não produz outras escritas.
A auditoria detalhada do bloqueio está em
`docs/f1-66-28-advance-active-turn-local.md`.

## Publicação

PATCH, DELETE e o POST já migrado publicam somente após o retorno bem-sucedido
da operação, através do `MesaEventTransport` selecionado pela factory. O evento
é apenas uma invalidação; nenhum snapshot ou dado privado é transmitido.

O caminho Supabase continua usando suas operações existentes. Não foram criadas
migrations nem métodos adicionais de contrato: os adapters atuais já cobrem
`findCombatantById`, `findCombatById`, `findCombatBySession`,
`updateCombatant` e `deleteCombatants`.

## Lacunas restantes

- remoção do combatant ativo depende da migração do avanço de turno;
- encerramento de combate, iniciativa independente, inventário, mapa, NET,
  stealth, detecção, ICE e resoluções continuam fora do modo local migrado;
- testes de integração PostgreSQL ainda precisam validar rollback, isolamento,
  colisão de posições e a recusa do combatant ativo;
- transporte local permanece limitado ao processo atual.

## Arquivos alterados

- `src/lib/mesa/store.ts`
- `src/app/api/mesa/[id]/combatants/route.ts`
- `tests/mesa-local-transaction-context.test.ts`
- este documento

Nenhuma migration foi criada e nenhum commit foi feito.

**Nenhum teste, TypeScript, build ou lint foi executado.**
