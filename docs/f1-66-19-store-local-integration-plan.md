# F1.66.19 — Plano de integração do `store.ts` com a infraestrutura local

> Auditoria realizada sobre o estado posterior às F1.66.16–F1.66.18. Este
> documento não altera código, contratos, rotas, migrations ou configuração.

## 1. Resumo executivo

O `store.ts` ainda é efetivamente Supabase-only. A factory
`createMesaHostingInfrastructure` já consegue montar:

- `SupabaseMesaRepository`, `SupabaseResolutionStore` e
  `SupabaseMesaEventTransport` no modo Supabase;
- `LocalPostgresMesaRepository`, `LocalPostgresResolutionStore` e
  `LocalMesaEventTransport` no modo local, desde que o pool local esteja
  disponível.

Porém, a factory não é usada pelo `store.ts`. O store mantém `db()` em
`src/lib/mesa/store.ts:161-163`, que chama `getSupabaseAdmin()`, e constrói
adapters Supabase diretamente em vários pontos. Portanto, alterar somente a
factory não impede requisições Supabase no modo local.

O caminho seguro é uma migração incremental por contratos de infraestrutura,
começando por autenticação/leitura básica e persistência de sessão, passando por
combate/materialização, e somente então substituindo mutações auxiliares e
resoluções. Cada etapa precisa manter a regra no domínio e mover apenas a
persistência/concorrência para adapters ou funções SQL oficiais.

### Fatos confirmados

- `MesaRepository` cobre leituras básicas, materialização de combatants, HP,
  débito condicional de ações e CAS de combatants em ambos os adapters.
- `ResolutionStore` declara e possui implementação local para ataque, reload,
  itens/cura, movimento, Death Save, cobertura, NET e Quickhack.
- `LocalMesaEventTransport` é um barramento em memória por sessão/processo e
  não transporta snapshots.
- O store ainda chama diretamente Supabase para persistência, RPCs,
  autenticação e publicação indireta pelas rotas.
- Os relatórios anteriores registram validação histórica das migrations locais,
  mas não uma validação da integração completa do store.

### Hipóteses que ainda precisam de verificação

- Que o banco local em uso contém todas as migrations e as versões finais das
  funções SQL; F1.66.5 registrou uma aplicação histórica em banco descartável,
  mas isso não é um health check do banco de runtime.
- Que todas as colunas opcionais usadas atualmente (`position`, `supplies`,
  `source_key`, estados NET e campos de histórico) estão presentes em toda
  instalação local.
- Que um transporte em memória é suficiente para a topologia final; ele não
  atravessa múltiplos processos/instâncias.

## 2. Limite da auditoria e dependências chamadas pelo store

`store.ts` importa regras e transformações puras, como Combat Engine,
`battleHistory`, `netrunner`, `netCombat`, `tacticalGeometry`, `visibility`,
`netArchitecture`, `rollPolicy` e adaptadores de ficha. Esses módulos não foram
identificados como clientes de banco; devem continuar fora da camada de
infraestrutura.

Os acessos de persistência são centralizados em `db()` ou em instâncias
explícitas de `SupabaseMesaRepository`/`SupabaseResolutionStore`. Publicação é
feita por rotas através de `realtimeServer.ts`, não pelo domínio puro. Esse
limite deve ser preservado: o domínio calcula e autoriza; a infraestrutura lê,
grava, faz CAS/transação e publica somente invalidação.

## 3. Inventário direto do Supabase em `store.ts`

As linhas abaixo são referências ao estado auditado; algumas linhas contêm
mais de uma operação encadeada.

### 3.1 Entrada, autenticação e sessão

| Local/função | Operação direta | Dados/efeito | Contrato local | Situação |
|---|---|---|---|---|
| `db()` em `:161`; `authenticate` em torno de `:1373` | `mesa_sessions` + `mesa_participants` | valida sessão, token, papel, status e participante | `findSessionById`, `findParticipantByToken` | **Parcialmente coberto**; o consumer ainda não usa o repository local. |
| criação/join, aproximadamente `:2772-2940` | insert/update/delete em `mesa_sessions`, `mesa_participants`, `mesa_characters` | cria mesa, atribui GM, registra participante e personagem | nenhum contrato para criação/join/personagem | **Ausente**. |
| `linkCharacter`, aproximadamente `:2951-2994` | updates de participante, leitura/insert/update de `mesa_characters` | vinculação e snapshot de ficha | nenhum contrato de participante/personagem | **Ausente**. |
| `leaveSession`, `:6780` | delete de participante | desconexão e `participant_id` via FK | nenhum contrato de participante delete | **Ausente**; precisa preservar semântica GM/player. |

A autorização não deve ser movida para o adapter. O adapter deve fornecer a
linha dentro do escopo; `authenticate`, `requireGM`, `requirePlayer`, ownership
e vínculo de personagem continuam no domínio. A associação do token nunca pode
ser guardada em `globalThis`.

### 3.2 Leituras e materialização de combate

| Local/função | Operações | Contrato/adapters | Lacuna |
|---|---|---|---|
| `listCombatants`, `:480-485`; `getMesaState`, `:2477-2481` | leitura de combatants por sessão/combate e projeção | `listCombatantsByCombat`, `findCombatantById`; ambos adapters | `getMesaState` também lê sessão, participantes e combate em paralelo, mas não há contrato agregado nem projeção local injetada. |
| iniciativa/ICE, `:1216-1255`, `:4874-5005` | select/update de iniciativa, `sort_order`, snapshots e ICE | leituras básicas e `upsertCombatants` cobrem apenas parte | faltam operações específicas ou devem ser reduzidas a `updateCombatant` com escopo/CAS. |
| início/reinício de combate, `:3168-3326` | lê combate/participantes, cria/atualiza combate, apaga/upsert combatants, atualiza status | materialização local cobre insert/upsert/delete de combatants | faltam criação/atualização transacional de combate, participantes e event log. |
| remoção/edição, `:3568-3687` | leitura, update e delete de combatants | `findCombatantById`, `updateCombatant`, `deleteCombatants` | consumidores ainda instanciam `SupabaseMesaRepository` diretamente; alguns updates não passam escopo completo. |
| HP e ações, aproximadamente `:3852-3870`, `:5543`, `:6591` | update condicional de HP/ações | `updateCombatantHp`, `debitCombatantAction` | adapter existe; uso ainda Supabase direto ou adapter Supabase explícito. |

O fluxo de materialização precisa ser transacional onde hoje a sequência
depende de várias escritas. Não basta trocar cada `.from()` por uma query local
independente: início de combate, atualização de roster e cleanup devem ter
rollback e escopos equivalentes.

### 3.3 Combate, event log e histórico

| Local/função | Operação | Contrato/adapters | Lacuna |
|---|---|---|---|
| `appendEvent`, `:3032-3039` | lê e atualiza `mesa_combats.event_log`, recorta 50 eventos | nenhum contrato | **Ausente**. Precisa de append/replace condicional ou operação transacional própria. |
| `reserveBattle`, `:488-549` | cria `mesa_battles`, UNIQUE de `encounter_id` | nenhum contrato | **Ausente**; exige tratar corrida de encontro e idempotência. |
| `updateBattleRoster`, `completeActiveBattle`, `:561-638` | lê/atualiza histórico, merge de roster, evento e rodada final | `battleHistory` é puro, mas não é adapter | **Ausente**. Deve preservar snapshot inicial, removidos e participantes que entraram depois. |
| `discardBattle`, `:574-579` | remove reserva órfã | nenhum contrato | **Ausente**, com semântica de compensação. |
| `endCombat`/`finishSession`, `:6671-6718` | finaliza combate, partida e sessão | nenhum contrato agregado | **Ausente**. A ordem commit → histórico → publicação precisa ser documentada e testada. |
| `listBattles`, `:6721-6745` | histórico somente GM | nenhum repository local | **Ausente**; precisa preservar projeção/autorização. |

`mesa_battles` é a principal fonte histórica de partidas, enquanto
`mesa_participants` conserva a associação da sessão. A futura integração não
deve apagar participantes ao fechar a sessão nem transportar projeções privadas
no `MesaEventTransport`.

### 3.4 Estado NET, mapa, stealth e detecção

| Domínio e referências | Operações diretas | Situação local |
|---|---|---|
| Black ICE/iniciativa, `:1216-1281`, `:2555-2610`, `:5466-5569` | leituras/updates de `net_architectures`, `netrunner_state`, `net_discovery`, ICE e dano | `ResolutionStore.commitNetAction` cobre somente o commit atômico de NET. Leituras auxiliares, turnos de ICE, RAM, REZZ e estados ainda não têm contrato local específico. |
| jack in/out e quickhack preparatório, `:1643-1906`, `:2421-2455`, `:5627-5729` | updates diretos de `netrunner_state`, ações, arquitetura e mapa | `commitQuickhack` cobre o commit oficial; autenticação, conexão, reparo/destruição de cyberdeck e cleanup ainda são diretos. |
| NET action, `:1941-2057` | claim/release/commit RPC | `claimAttack`, `releaseAttack`, `commitNetAction` | **Implementado no adapter**, mas consumer direto; preservar claim token, CAS e isolamento. |
| dispositivos/mapa, `:2147-2277`, `:2648-2756`, `:3617-3621` | leitura/update de `tactical_map`, `net_architectures`, posição e dispositivos | nenhum contrato de sessão/mapa | **Ausente**. Deve incluir CAS/escopo e não mover validação de geometria para SQL sem necessidade. |
| stealth/detection, `:1068`, `:1584-1616` | leitura/update de `position`, `detected_by`, `stealth_state` | repository cobre genericamente combatant, mas consumer direto | **Parcial**; avaliar operação genérica com expected/escopo antes de criar métodos específicos. |

### 3.5 Resoluções e RPCs

| Família | Chamadas diretas observadas | Contrato local | SQL oficial e garantias |
|---|---|---|---|
| Ataque | claim/commit/release em `:4310-4464`, `:6019-6379` | completo | `mesa_attack_resolutions`; locks, claim token, CAS, idempotência e rollback. |
| Death Save | `:4566-4623` | somente `commitDeathSave`; claim/release reutilizam ataque | `commit_mesa_death_save_resolution`; CAS de Death Save e eventual desconexão NET. |
| Reload | `:5926-5967` | completo | `mesa_reload_resolutions`; recovery e release oficiais. |
| Movimento | `:5661-5827` | `commitMove`; claim/release ainda ataque no domínio | `commit_mesa_move_resolution_atomic`; resultado committed/already committed. |
| Cobertura | `:6408-6495` | `commitCoverDamage` | `commit_mesa_attack_cover_resolution`; CAS de munição/ações/obstáculo. |
| Item/cura | `:6937-6971`, `:7163-7201` | completo | `mesa_item_consume_resolutions` e `commit_mesa_item_heal_resolution`. |
| NET/Quickhack | NET `:1941-2057`; Quickhack `:2343-2413` | commits completos; claims ataque | RPCs finais de NET e Quickhack, incluindo JSONB e CAS próprios. |

O risco desta área é maior que uma substituição textual: o domínio atualmente
relê combatants, calcula resultado e então chama a RPC. A migração deve trocar
claim/release/commit pelo mesmo `ResolutionStore` em uma unidade de família,
sem reimplementar SQL, regras ou rolagens em TypeScript.

## 4. Operações já cobertas versus lacunas de contrato

### Cobertura confirmada

`MesaRepository` possui no Supabase e no local:

- sessão por id e participante por token;
- combate por sessão/id;
- combatants por combate/id;
- update de HP com expected;
- débito de ação com expected;
- update genérico, insert, upsert e delete escopados.

`ResolutionStore` possui os métodos declarados em `infrastructure.ts:177-200`
nos dois adapters. O adapter local chama funções SQL oficiais com parâmetros
posicionais e serialização JSONB na fronteira.

`MesaEventTransport` possui Supabase e local. O local isola por `sessionId`,
remove listeners com `close()` e só emite invalidação.

### Lacunas concretas

Não há contrato/adapter para:

1. criação, atualização e encerramento de `mesa_sessions`;
2. criação, atualização e remoção de `mesa_participants`;
3. criação, leitura, upsert e snapshot de `mesa_characters`;
4. criação/atualização transacional de `mesa_combats`;
5. leitura/escrita de `event_log`;
6. criação, reserva, conclusão e consulta de `mesa_battles`;
7. `tactical_map`, `net_architectures` e campos auxiliares de sessão;
8. leituras/escritas auxiliares de NET, stealth, detecção e ICE;
9. consultas de resolução de item e demais leituras usadas para replay;
10. factory/injeção no `store.ts` e nos serviços/rotas.

Essas lacunas não devem ser preenchidas com um `Repository` genérico que aceite
qualquer tabela. Cada contrato deve explicitar escopo, expected/CAS e se a
operação exige transação.

## 5. SQL, migrations e garantias a preservar

### Estado das migrations

As migrations encontradas definem as tabelas base de sessão, participantes,
personagens, combate/combatants, histórico (`20260927000001`), resolução de
ataque/reload/item e funções de movimento, Death Save, cobertura, NET e
Quickhack. F1.66.5 registra que as migrations foram aplicadas em um banco local
descartável.

Isso confirma a existência histórica dos arquivos, mas **não confirma** que o
banco local de runtime atual está na mesma revisão. Antes de cada etapa deve
haver um schema/version check seguro e uma execução limpa dos migrations no
driver local; não se deve presumir que `select 1` prova a presença das RPCs.

### Garantias por categoria

- **Autorização:** token + sessão + papel + ownership permanecem em
  `store.ts`/serviço de domínio; adapters não aceitam identidade global.
- **Isolamento:** toda leitura/escrita deve incluir `session_id` e, quando
  aplicável, `combat_id`; `resolutionId` sempre usa a chave completa.
- **Concorrência:** claims e commits continuam nas RPCs oficiais; updates
  auxiliares precisam de expected/CAS ou transação explícita.
- **Idempotência:** replay retorna o resultado persistido; não repetir cálculo
  nem publicar como se fosse uma nova ação.
- **Locks/rollback:** qualquer sequência que crie combate, reserve histórico ou
  finalize partida deve usar transação local equivalente, sem commits parciais.
- **Projeção:** GET autenticado continua filtrando visão GM/player; o transporte
  local jamais substitui essa projeção.
- **Publicação:** publicar invalidação somente depois do commit; falha do
  transporte não transforma commit confirmado em erro que incentive retry.

## 6. Pontos de acesso indireto ao Supabase

Mesmo que `db()` fosse substituído, estes pontos poderiam reintroduzir acesso:

1. `new SupabaseMesaRepository()` em `:398`, `:1238`, `:1384`, `:3207`,
   `:3578`, `:3852`, `:3870`, `:4977`, `:5543` e `:6591`;
2. `new SupabaseResolutionStore()` em `:5790`;
3. import direto de `SupabaseMesaRepository`/`SupabaseResolutionStore` em `:138`;
4. `realtimeServer.ts`, que chama `getSupabaseAdmin()` em `:57`;
5. rotas que chamam `publishMesaState` diretamente após mutations, como a rota
   de participante e outras rotas de Mesa;
6. clientes browser em `realtime.ts`, que usam `NEXT_PUBLIC_SUPABASE_*`.

No modo local, a factory deve ser a única origem dos adapters e as rotas/cliente
devem receber o transporte selecionado. Até essa migração, deve existir uma
barreira explícita: se `MESA_HOSTING_MODE=local`, qualquer caminho ainda
Supabase-only deve falhar com erro de integração ausente, nunca trocar para
Supabase silenciosamente.

`supabaseAdmin.ts` pode continuar sendo importado por módulos de tipos/erros
desde que não seja chamado no ramo local; o critério é não executar
`getSupabaseAdmin()`/`createClient()` nem `publishMesaState` no modo local.

## 7. Sequência incremental recomendada

### Etapa A — Contexto de infraestrutura por request

Criar uma factory/contexto server-side memoizado que entregue repository,
resolution store e event transport selecionados. A autorização da request fica
fora do singleton; apenas clientes/pools compartilháveis podem ser globais.

**Aceite:** uma request Supabase não consegue obter adapter local e vice-versa;
modo ausente/inválido falha; testes espiam que local não chama Supabase.

### Etapa B — Autenticação, sessão, participantes e personagens

Adicionar contratos explícitos para:

- `findSessionByJoinCode`;
- criar/atualizar sessão;
- criar/consultar/atualizar/remover participante;
- ler/criar/atualizar personagem snapshot;
- transição de status de sessão com expected/status anterior.

Extrair `authenticate`, join, create, link character e leave sem mover
`requireGM`, `requirePlayer` ou ownership para adapters.

**Aceite:** criar/entrar/vincular/sair funciona em ambos os bancos; token de
outra sessão não autentica; GM/player mantêm exatamente os mesmos erros e
status; nenhuma query Supabase ocorre no modo local.

### Etapa C — Combate e projeção base

Adicionar operações de combate para find/create/update/finish e um reader
agregado para o estado base, além de materialização transacional de combatants.
Usar os métodos existentes para CAS de HP/ações e remover todas as construções
explícitas de adapters Supabase.

**Aceite:** iniciar/reiniciar combate, materializar roster, ordenar iniciativa,
remover combatant e sincronizar HP/ações funcionam localmente com rollback e
isolamento por sessão.

### Etapa D — Event log e histórico

Criar contratos para append/read de `event_log` e para o ciclo de
`mesa_battles`: reservar encontro, atualizar roster, concluir, descartar órfão
e listar histórico. O merge deve continuar em `battleHistory.ts`, que é puro.

**Aceite:** corrida de dois inícios respeita UNIQUE/erro `encounter_used`;
finalização salva snapshot e log; falha de publicação não desfaz persistência;
histórico GM não revela projeção indevida a player.

### Etapa E — Resoluções por família

Migrar, nesta ordem, movimento; ataque/reload; itens/cura; Death Save; cobertura;
NET; Quickhack. Em cada família:

1. trocar `find/recover/claim/release/commit` diretos pelo `ResolutionStore`;
2. manter cálculos e validações no store;
3. garantir que os argumentos `p_*` sejam os mesmos;
4. executar contrato compartilhado local/Supabase antes de avançar.

**Aceite:** replay, concorrência, conflito CAS, rollback e isolamento têm o
mesmo resultado observável nos dois drivers.

### Etapa F — Estado auxiliar e ações restantes

Extrair mapa tático, arquiteturas NET, stealth, detecção, ICE, cyberdeck,
posição, expiração de efeitos e recuperação de RAM. Reutilizar `updateCombatant`
somente quando o expected/escopo for suficiente; criar métodos específicos
quando houver invariantes transacionais.

**Aceite:** nenhum `.from`/`.rpc` direto permanece em `store.ts` para os fluxos
suportados; cada operação tem contrato, adapter, escopo e teste.

### Etapa G — Rotas, publicação e shutdown

Injetar o contexto nas rotas e substituir `publishMesaState` por
`eventTransport.publishInvalidation`. `useMesaState` continua fazendo GET e
polling. Registrar shutdown do lifecycle local no processo, sem iniciar
PostgreSQL do sistema operacional.

**Aceite:** fluxo HTTP completo local sem Supabase; clientes da mesma instância
recebem invalidação; múltiplas instâncias são suportadas por broker ou declaradas
em modo polling; encerramento não corta operações ativas.

## 8. Riscos e dependências

| Risco | Evidência | Mitigação |
|---|---|---|
| Fallback acidental para Supabase | `db()` e adapters explícitos no store | factory/contexto obrigatório e teste que bloqueia `getSupabaseAdmin` em local |
| Parcialidade entre leituras e writes | `getMesaState` e fluxos compostos usam várias queries | contratos agregados/transações por caso de uso, não simples substituição textual |
| Divergência de RPC final | migrations têm `create or replace` em revisões posteriores | aplicar migrations em ordem e testar assinatura/resultado no banco local |
| Cross-session | várias queries antigas filtram só `id`/`combat_id` | exigir escopo de sessão nos contratos e revisar cada chamada antes de migrar |
| Vazamento GM/player | projeção ocorre depois de leituras compartilhadas | manter `projectCombatForPlayer` no domínio e não publicar snapshots |
| Histórico incompleto | `mesa_battles` é opcional em código legado e tem fallback Supabase | tornar dependência explícita no modo local; não tratar migration ausente como histórico vazio |
| Realtime em múltiplos processos | transporte local usa `globalThis` | broker local futuro ou polling documentado |
| Pool/lifecycle | `globalThis` é por instância, não cluster | health check, shutdown por processo e testes de recuperação |
| Estado global do store | caches como `battleSupport`/suporte de colunas são processuais | separar capability cache por backend e invalidar após schema/configuração mudar |

## 9. Critérios globais de conclusão

A integração do store só deve ser declarada concluída quando:

1. não houver chamada direta a `getSupabaseAdmin`, `.from`, `.rpc` ou
   `new Supabase*` em `store.ts` para operações suportadas;
2. cada acesso estiver em contrato com implementação Supabase e local, ou
   estiver explicitamente marcado como não suportado e falhar no modo local;
3. todas as rotas utilizarem o contexto do hosting selecionado;
4. autenticação, autorização, ownership e projeções tiverem os mesmos testes
   nos dois backends;
5. migrations/RPCs locais forem verificadas em banco limpo e no banco de
   runtime;
6. suites reais de repository, resoluções, histórico, isolamento e concorrência
   passarem em ambos os drivers;
7. falha de publicação, perda de conexão, retry, shutdown e recuperação não
   alterarem a semântica de commit;
8. nenhum caminho local inicializar cliente Supabase ou publicar via
   `realtimeServer`.

## 10. Validação desta etapa

Esta entrega é somente auditoria e planejamento. Foram consultados os contratos,
adapters, factory, transporte local, store e migrations disponíveis.

**Nenhum teste, TypeScript, build, lint ou outra verificação automatizada foi
executado. Nenhum arquivo de produção foi alterado e nenhum commit foi criado.**
