# F1.66.15 — Auditoria de cobertura do `ResolutionStore` e prontidão do modo local

> Auditoria documental do estado posterior à F1.66.14. Nenhum código de
> produção, contrato, migration ou rota foi alterado nesta etapa.

## 1. Resumo executivo

O projeto possui uma extração incremental útil, mas **não possui ainda um modo
local completo**. O PostgreSQL local já tem implementações reais para o
`MesaRepository` e para todas as operações atualmente declaradas em
`ResolutionStore`. Essas implementações encaminham argumentos às funções SQL
oficiais e não substituem as regras do domínio.

Isso não é suficiente para executar uma mesa sem Supabase: `store.ts` continua
criando `getSupabaseAdmin()` diretamente, as rotas dependem desse store, e o
único `MesaEventTransport` implementado é o Supabase. Não existe seleção
explícita de hospedagem, autenticação local, publicação local de invalidações ou
integração do adapter local ao servidor.

Portanto, a situação atual é:

- **Cobertura de contratos:** ampla para as fatias já extraídas.
- **Integração da aplicação:** Supabase-only.
- **Equivalência funcional comprovada:** somente para as validações históricas
  registradas nos relatórios; as mudanças mais recentes da F1.66.14 ainda não
  foram executadas neste estado.
- **Prontidão para uso real local:** não atingida.

## 2. Matriz de contratos e adapters

### 2.1 `MesaRepository`

| Operação declarada | Supabase | PostgreSQL local | Consumidor principal | SQL/função oficial | Contrato/driver | Situação e riscos |
|---|---|---|---|---|---|---|
| `findSessionById` | Implementada via `mesa_sessions` | Implementada com SQL parametrizado | autenticação, leitura de estado e rotas de Mesa | `SELECT` | `mesaRepositoryContractSuite`; driver local e Supabase | **Completa na fatia**. Integração do domínio ainda usa Supabase diretamente em outros caminhos. |
| `findParticipantByToken` | Implementada com escopo de sessão/token | Implementada com SQL parametrizado | `authenticate` | `SELECT` | mesma suíte/ambos drivers | **Completa na fatia**. Associação e autorização continuam no domínio. |
| `findCombatBySession`, `findCombatById` | Implementadas | Implementadas | carregamento de combate, ataques e estado | `SELECT` com escopo | suíte de repository/ambos drivers | **Completa na fatia**. Mutação de combate/event log permanece fora do contrato. |
| `listCombatantsByCombat`, `findCombatantById` | Implementadas com ordenação canônica e escopo | Implementadas com a mesma ordenação/escopo | materialização, autenticação de ator, regras de combate | `SELECT` | suíte de repository/ambos drivers | **Completa na fatia**. Não cobre todas as leituras auxiliares do store. |
| `updateCombatantHp` | Update condicional/CAS | Update condicional/CAS | `syncCombatHp` | `UPDATE` parametrizado | suíte de repository/ambos drivers | **Completa na fatia**. Cálculo, autorização e supplies continuam no domínio. |
| `debitCombatantAction` | Update condicional/CAS | Update condicional/CAS | `performAction` e fluxos de ação | `UPDATE` parametrizado | suíte de repository/ambos drivers | **Completa na fatia**. Deve continuar recebendo snapshots já validados. |
| `updateCombatant` | Update filtrado por escopo/expected | Equivalente SQL parametrizado | mutações auxiliares/materialização | `UPDATE` parametrizado | suíte de repository/ambos drivers | **Completa na fatia**. Não é uma transação geral de combate. |
| `insertCombatants` | Inserção explícita | Inserção parametrizada | início/materialização de combate | `INSERT` | suíte de repository/ambos drivers | **Completa na fatia**. Duplicidade é erro; não há fallback/merge silencioso. |
| `upsertCombatants` | Upsert por `id` | Upsert equivalente | materialização/ICE | `UPSERT` | suíte de repository/ambos drivers | **Completa na fatia**. O payload e as colunas ainda são montados pelo domínio. |
| `deleteCombatants` | Delete com escopo obrigatório | Delete com escopo obrigatório | desmontagem/materialização | `DELETE` | suíte de repository/ambos drivers | **Completa na fatia**. Não representa exclusão de sessão/participante. |

O adapter local implementa a interface inteira de `MesaRepository`, mas o
`store.ts` só usa esse adapter em uma construção localizada; a maior parte dos
acessos segue através de `db()`/Supabase. Assim, “implementado” não significa
“caminho da aplicação selecionável”.

### 2.2 `ResolutionStore`

| Família/operação | Supabase | PostgreSQL local | Consumidores em `store.ts`/rotas | RPC oficial | Contratos e drivers | Situação |
|---|---|---|---|---|---|---|
| Ataque: `findAttack`, `recoverAttack`, `claimAttack`, `releaseAttack`, `commitAttack` | Implementadas | Implementadas | `executeCombatAttack` e rotas de ataque | `claim_mesa_attack_resolution`, `recover_mesa_attack_resolution`, `release_mesa_attack_resolution`, `commit_mesa_attack_resolution` | `resolutionClaimContractSuite`; ataque/recarga real local e Supabase | **Completa na fatia**, sujeita à integração Supabase-only. |
| Reload: `findReload`, `recoverReload`, `claimReload`, `releaseReload`, `commitReload` | Implementadas | Implementadas | `executeCombatReload` e rota de reload | RPCs correspondentes de `mesa_reload_resolutions` | suíte compartilhada de claims/ataque-reload; drivers reais | **Completa na fatia**. |
| Item: `claimItemConsume`, `releaseItemConsume`, `commitItemConsume` | Implementadas | Implementadas | consumo de item | `claim_mesa_item_consume_resolution`, `release_mesa_item_consume_resolution`, `commit_mesa_item_consume_resolution` | `itemResolutionContractSuite`; drivers local/Supabase | **Completa na fatia**. |
| Cura: `commitItemHeal` | Implementada | Implementada | cura por item | `commit_mesa_item_heal_resolution` e claim/release de item | mesma suíte; drivers local/Supabase | **Completa na fatia**. Não há claim paralelo de cura. |
| Movimento: `commitMove` | Implementada | Implementada | `movePlayerCombatant`/rota de movimento | `commit_mesa_move_resolution_atomic` | `moveResolutionContractSuite`; drivers local/Supabase | **Completa na fatia**. O resultado possui `committed`/`already_committed`. |
| Death Save: `commitDeathSave` | Implementada | Implementada | `executeDeathSave`/rota de Death Save | claim/release de ataque e `commit_mesa_death_save_resolution` | `deathSaveResolutionContractSuite`; drivers local/Supabase | **Completa na fatia**. Reutiliza a máquina de ataque. |
| Cobertura: `commitCoverDamage` | Implementada | Implementada | ação de dano à cobertura | claim/release de ataque e `commit_mesa_attack_cover_resolution` | `coverDamageResolutionContractSuite`; drivers local/Supabase | **Completa na fatia**. |
| NET: `commitNetAction` | Implementada | Implementada | `executeNetAction`/rota NET | claim/release de ataque e `commit_mesa_net_action_resolution` | `netActionResolutionContractSuite`; drivers local/Supabase | **Completa na fatia**. |
| Quickhack: `commitQuickhack` | Implementada | Implementada na F1.66.14 | `executeCombatQuickhack`/fluxo de Quickhack | claim/release de ataque e `commit_mesa_quickhack_resolution` | `quickhackResolutionContractSuite`; drivers local/Supabase preparados | **Implementada, não validada no estado atual**. |

Os commits locais não duplicam rolagem, cálculo de dano, inventário, estado NET
ou autorização: serializam JSONB na borda e chamam as funções SQL públicas.
Claims de ataque são reutilizados por Death Save, cobertura, NET e Quickhack,
conforme o desenho oficial.

Não há no contrato atual operações para recovery independente de item/Quickhack,
nem para outras famílias que ainda não foram extraídas. Isso é uma lacuna de
escopo, não uma implementação ausente em um método já declarado.

### 2.3 `MesaEventTransport`

| Operação | Supabase | PostgreSQL local | Consumidores | Função | Testes | Situação |
|---|---|---|---|---|---|---|
| `publishInvalidation` | `SupabaseMesaEventTransport` publica no canal Realtime | Ausente | rotas e mutações após persistência | `publishMesaState`/Supabase Realtime | Não há driver local equivalente | **Parcial**. A publicação é otimista e não deve ser pré-condição do commit. |
| `subscribeInvalidation` | Implementada com `subscribeMesaState` | Ausente | `useMesaState` no navegador | canal `mesa:<sessionId>` | cobertura indireta de cliente, sem contrato real local | **Parcial**. O fallback existente é polling HTTP, não realtime local. |

## 3. Acessos diretos à infraestrutura

O padrão encontrado por busca de `getSupabaseAdmin`, `.from`, `.rpc` e
`publishMesaState` é o seguinte. A lista agrupa ocorrências pelo papel
infraestrutural; não houve migração nesta etapa.

### 3.1 `src/lib/mesa/store.ts`

`db()` em `store.ts` retorna diretamente `getSupabaseAdmin()`. Os usos
abrangem:

| Categoria | Exemplos observados | Classificação |
|---|---|---|
| Leitura/escrita de persistência | sessões, participantes, combates, combatants, batalhas, tactical map, event log e leituras auxiliares | **Precisa de abstração** para modo local. As leituras básicas já têm partes em `MesaRepository`, mas não todas as mutações/entidades. |
| RPC de resolução | claims/recovery/release de ataque/reload e chamadas de commit, inclusive famílias já extraídas | **Precisa passar pelo `ResolutionStore`**. Os contratos cobrem as famílias listadas, mas os caminhos ainda chamam Supabase diretamente. |
| Autenticação/autorização | consultas a sessão/participante e verificações de papel/ownership | A decisão deve permanecer no domínio; a **fonte de dados precisa ser abstraída** para local. Não deve ser movida para o adapter sem preservar autorização. |
| Event log | leitura, append e updates de `mesa_combats.event_log` | **Ainda sem contrato transacional geral**. O desenho atual aceita falha posterior ao commit; a implementação local precisará preservar essa ordem e o limite de 50 eventos. |
| Telemetria | mensagens/contextos de `DatabaseQueryError`, estágios de resolução/publicação | Pode permanecer agnóstica, mas os adapters locais precisam manter códigos/contextos observáveis. |

Esses acessos são evidência de acoplamento, não uma autorização para
refatorá-los nesta fase.

### 3.2 Rotas e transporte

As rotas de `/api/mesa` não fazem consultas Supabase diretamente segundo a
auditoria de imports e chamadas; em geral delegam ao `store.ts`. Contudo,
algumas rotas também importam `publishMesaState` diretamente após mutações,
incluindo a rota de arquitetura NET e a rota de combatants. Esse acesso é:

- **publicação de eventos**, não persistência nem autorização;
- específico do Supabase hoje;
- coberto conceitualmente por `MesaEventTransport`, mas não injetado nas rotas.

`src/lib/mesa/realtime.ts` é cliente/browser e cria um cliente público Supabase
para assinatura. `realtimeServer.ts` usa service role e `after()` para publicar.
O fallback para polling de 4 segundos é transporte HTTP existente, não uma
implementação local de WebSocket.

## 4. Prontidão do modo local

| Componente | Já existe | Incompleto ou ausente | Avaliação |
|---|---|---|---|
| `MesaRepository` | Adapter local parametrizado, escopos, CAS, materialização e contratos reais | Não está selecionado pelo servidor; entidades fora do contrato permanecem no store | **Parcial; não integrado** |
| `ResolutionStore` | Todas as operações declaradas têm implementação local e RPC oficial correspondente | Chamadores ainda são majoritariamente Supabase; Quickhack F1.66.14 não foi validado após a alteração | **Implementado como slice; não pronto** |
| `MesaEventTransport` | Adapter Supabase de publicação/assinatura | Nenhum adapter local, canal, broker ou transporte in-process | **Ausente para local** |
| Autenticação/autorização/participantes | `authenticate`, papéis, ownership e tokens no store/Supabase | Banco local não é fonte configurável; não há serviço local integrado nem política de sessão selecionável | **Supabase-only** |
| Event log/publicação | Event log persistido no fluxo atual; publicação Realtime opcional, com polling de segurança | Escrita/leitura do log não está em repository/serviço completo; publicação local ausente | **Parcial** |
| Seleção explícita de hosting | Nenhuma variável/factory de hosting encontrada | Sem `MESA_HOSTING_MODE`, factory ou erro explícito por modo; nenhum fallback local | **Ausente** |
| Inicialização/configuração local | Script para migrations em banco descartável; `pg` e adapters | Não inicia banco para a aplicação, não configura pool lifecycle nem integra env de produção | **Preparação de testes apenas; não runtime** |
| Migrations/schema | Todas as migrations foram aplicadas e validadas historicamente em banco local descartável | Processo de upgrade/health-check/locking para instalação real não existe | **Preparado para contrato; não operacional** |
| Rotas HTTP/serviços de domínio | Rotas e store funcionais no caminho Supabase | Rotas dependem implicitamente de `store.ts` Supabase; sem injeção de infraestrutura | **Não local** |
| Realtime/WebSocket/polling/reconciliação | Realtime Supabase, GET autenticado e polling de 4 s | Sem WebSocket/local pub-sub; polling local só funcionaria depois de as rotas usarem o local | **Parcial, Supabase-only** |
| Inicialização, encerramento e recuperação | Cliente Supabase memoizado; pools de teste fechados pelos drivers | Sem bootstrap/shutdown do pool local, health checks, recuperação de conexão ou recovery operacional | **Ausente para servidor local** |
| Empacotamento/instalador Windows | Não foram encontrados scripts/dependências de Electron, Tauri, `pkg` ou instalador | Distribuição do banco, migrations, serviço e configuração Windows | **Ausente** |

O texto “local” em `MESA_LOCAL_TEST_DATABASE_URL` e nos scripts refere-se a
fixtures/contratos descartáveis. Não é uma seleção de hosting da aplicação.

## 5. Riscos técnicos conhecidos

### Concorrência e atomicidade

As RPCs oficiais preservam locks, `claim_token`, CAS, idempotência e rollback
para as famílias extraídas. O risco principal é o caminho de execução: enquanto
`store.ts` chamar diretamente Supabase, não existe garantia de que a aplicação
use o mesmo adapter que os contratos locais exercitam. Event log/publicação
continuam fora de vários commits atômicos por decisão documentada; isso deve
continuar sendo tratado como pós-commit, sem desfazer efeitos autoritativos.

### Autorização e isolamento

Os adapters locais aplicam filtros de sessão/combate nos contratos cobertos,
mas não substituem `authenticate`, papel GM/player ou ownership. Uma integração
parcial poderia ler de local e autorizar contra Supabase, ou inverter as fontes,
criando isolamento inconsistente. A seleção deve ser por request/processo e
compartilhar uma única fonte de dados e configuração.

### Divergência entre bancos

Há risco de divergência de tipos JSONB, mensagens de erro, defaults, ordenação,
colunas auxiliares e migrations quando uma nova RPC for adicionada. O adapter
local reduz esse risco ao encaminhar `p_*` para SQL oficial, mas isso só é
comprovável com os drivers reais executados contra os dois alvos.

### Recuperação e claims abandonados

Ataque/reload possuem recovery oficial e contratos correspondentes. Famílias
que reutilizam a tabela de ataque dependem da recuperação dessa máquina. Não há
um mecanismo genérico local de observabilidade/retry para claims abandonados,
nem operações de recovery próprias para item/Quickhack no contrato.

### Eventos e disponibilidade

Sem transporte local, o cliente pode usar polling somente se o servidor local
estiver efetivamente integrado às rotas. Sem health check e lifecycle do pool,
falhas de banco durante requests podem ser confundidas com falhas de sessão ou
publicação.

## 6. Estratégia recomendada, por dependência

1. **Fixar o contrato de hosting e lifecycle.** Definir configuração explícita,
   erro quando o modo selecionado não estiver configurado, criação/encerramento
   de pool e health check; sem fallback silencioso.
2. **Completar o `MesaRepository` necessário ao fluxo integral.** Inventariar
   cada leitura/escrita restante do store (sessões, participantes, combates,
   battles, mapa, log e arquiteturas NET) e criar contratos somente onde a
   operação é realmente compartilhável.
3. **Injetar repository/resolution store no domínio.** Substituir gradualmente
   `db()` e RPCs diretas pelos contratos, mantendo autenticação, regras e
   publicação na mesma ordem observável.
4. **Definir event log e transporte local.** Separar append/read do log da
   invalidação; implementar transporte local mínimo (ou declarar polling como
   modo suportado) e preservar falha de publicação como não bloqueante.
5. **Integrar rotas e autenticação por uma factory única.** Testar que uma
   request inteira usa o mesmo modo, banco e política de autorização.
6. **Validar migrations e equivalência em ambos os drivers.** Executar suites
   compartilhadas, incluindo Quickhack, além de testes de integração de rotas,
   concorrência e recuperação.
7. **Só depois tratar distribuição Windows.** Empacotar servidor, configuração,
   migrações e ciclo de vida do PostgreSQL; não confundir isso com a preparação
   descartável dos contratos.

## 7. Critérios objetivos de prontidão

### Para integração do modo local

- factory de hosting explícita e coberta por testes, sem fallback implícito;
- todas as rotas de Mesa usam a infraestrutura selecionada;
- nenhuma leitura/escrita/RPC de persistência fora de contratos inventariados,
  salvo o cliente Realtime explicitamente classificado como transporte;
- `MesaRepository`, `ResolutionStore` e `MesaEventTransport` disponíveis para o
  modo local ou polling local formalmente escolhido;
- autenticação, ownership, papéis e isolamento de sessão exercitados em rotas;
- pool local com inicialização, shutdown, health check e erros observáveis;
- migrations aplicáveis de forma rastreável a uma instalação limpa;
- suites contratuais local e Supabase executadas no mesmo commit, incluindo
  Quickhack, com resultados registrados.

### Para uso real de uma mesa

Além dos itens acima:

- teste de fluxo completo: criar mesa, entrar, vincular personagem, iniciar
  combate, executar todas as famílias suportadas, consultar/reconciliar estado;
- concorrência real de duas requisições para claims, commits e conflitos;
- recuperação de processo/banco e claims abandonados;
- política documentada de backup, migração e upgrade do schema;
- transporte/reconciliação validado para múltiplos clientes ou polling com
  latência e comportamento de falha aceitáveis;
- empacotamento/instalador e operação Windows testados, se essa for a meta;
- validação automatizada e revisão das diferenças observáveis de erros,
  autorização, JSONB, ordenação e idempotência.

## 8. Estratégia de validação e limitações desta auditoria

Suites contratuais preparadas no repositório:

- `mesaRepositoryContractSuite`;
- `resolutionClaimContractSuite`;
- `moveResolutionContractSuite`;
- `itemResolutionContractSuite`;
- `deathSaveResolutionContractSuite`;
- `coverDamageResolutionContractSuite`;
- `netActionResolutionContractSuite`;
- `quickhackResolutionContractSuite`.

Há drivers reais local e Supabase para repository, movimento, item/cura,
Death Save, cobertura, NET e Quickhack. Os relatórios anteriores registram
validações do repository/movimento e uma execução ampla anterior, além de
execuções parciais com skips explícitos conforme as credenciais disponíveis.
Esses resultados são históricos e não comprovam automaticamente o estado
posterior à F1.66.14.

Em especial, a suíte de Quickhack e as alterações mais recentes da F1.66.14
estão preparadas, mas não foram executadas nesta auditoria. Também não foi
encontrado um conjunto de integração de rotas que prove a troca completa de
hosting.

**Nenhum teste, TypeScript, build ou lint foi executado nesta etapa.**
