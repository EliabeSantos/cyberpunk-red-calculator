# F1.66.20 — Migração incremental de sessões e participantes para PostgreSQL local

## Escopo confirmado

O inventário F1.66.19 confirmou que a primeira fatia segura não inclui
personagens, combate ou histórico. Foram migrados somente os caminhos que
precisam de sessão/participante e não dependem desses domínios:

- `authenticate`: sessão por id + participante por token;
- `createMesa`: criação da sessão, criação do participante GM, vínculo `gm_id`
  e limpeza da sessão órfã;
- `joinMesa`: consulta por código, rejeição de sessão encerrada, lookup
  idempotente por token, atualização de conexão/nome e criação de jogador;
- `getMesaState`: leitura base de sessão, participantes, combate e combatants
  através do repository, mantendo a projeção GM/jogador no domínio;
- `leaveSession`: remoção escopada do participante;
- publicação posterior da rota de participante através do
  `MesaEventTransport` selecionado.

O transporte não recebe snapshots. A projeção continua sendo calculada no
store e entregue pelo GET autenticado.

## Contratos e adapters

`MesaRepository` agora também declara operações para:

- localizar sessão por `join_code`;
- criar/atualizar/remover sessão;
- listar/criar/atualizar/remover participantes;
- listar combatants por sessão.

`SupabaseMesaRepository` e `LocalPostgresMesaRepository` implementam essas
operações com filtros de sessão. O adapter local usa SQL parametrizado e os
defaults/constraints do schema; não reproduz validações de nome, token, papel,
status ou autorização, que permanecem em `store.ts`.

## Seleção e isolamento

Os caminhos migrados obtêm o repository por `createMesaHostingInfrastructure()`.
Com `MESA_HOSTING_MODE=local`, eles usam somente o pool local e o transporte
local. Com `supabase`, continuam usando os adapters Supabase.

Não há fallback automático. Imports de `supabaseAdmin`/adapters Supabase ainda
existem no módulo por causa dos domínios não migrados, mas os caminhos desta
fatia não chamam `getSupabaseAdmin()`, `.from()` ou `.rpc()` no modo local.

O escopo de sessão é aplicado nos métodos de participante e combatants. A
autorização permanece no domínio: `authenticate`, `requireGM`, `requirePlayer`
e ownership não foram movidos para o adapter.

## Operações ainda dependentes do Supabase

Continuam fora desta etapa:

- vinculação e snapshot de personagens (`linkCharacter`); no modo local agora
  falha explicitamente com `local_character_integration_pending` antes de tocar
  Supabase;
- criação/atualização transacional de combates e materialização completa;
- event log e histórico de `mesa_battles`;
- mapa tático, arquiteturas NET, stealth, detecção, ICE e estado auxiliar;
- todas as resoluções, claims e commits ainda chamados diretamente pelo store;
- `finishSession` e fluxos de fechamento ainda não integrados ao local;
- publicação de outras rotas que continuam usando `publishMesaState` diretamente.

Assim, o modo local já pode validar a fatia de sessão/participante e leitura
base, mas ainda não suporta a mesa completa.

## Transações e riscos

A criação de mesa mantém a sequência existente (criar sessão, criar GM,
atualizar `gm_id`, apagar órfã em falha). Não foi inventada uma RPC ou uma
transação nova; a equivalência transacional completa dessa sequência continua
uma lacuna conhecida.

As operações de resolução não foram modificadas. Locks, CAS, `claim_token`,
idempotência e rollback continuam delegados às RPCs oficiais quando esses
fluxos forem migrados.

Antes de habilitar o caminho completo local ainda é necessário verificar, em um
banco local limpo e no banco de runtime, a presença das migrations, colunas e
funções finais. `select 1` do lifecycle não comprova o schema completo.

## Arquivos alterados

- `src/lib/mesa/infrastructure.ts`
- `src/lib/mesa/localPostgresInfrastructure.ts`
- `src/lib/mesa/supabaseInfrastructure.ts`
- `src/lib/mesa/store.ts`
- `src/app/api/mesa/[id]/participant/route.ts`
- este documento

Nenhuma migration foi alterada. Testes contratuais específicos para as novas
operações de sessão/participante ainda devem ser adicionados ou executados na
próxima validação.

**Nenhum teste, TypeScript, build ou lint foi executado.**
