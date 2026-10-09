# F1.66.1 — Auditoria e arquitetura de hospedagem híbrida

> Auditoria realizada em 09/10/2026. Este documento descreve o estado atual e
> o desenho recomendado; não habilita o modo local nem altera o backend atual.

## Conclusão executiva

Hoje a Mesa é **Supabase-only no servidor**. O cliente pode usar Supabase
Realtime, mas o transporte é opcional: sem as variáveis públicas ou quando o
canal falha, `useMesaState` reconcilia por GET autenticado e polling de 4 s.
Isso não é um modo local: as rotas continuam exigindo
`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`.

Não é seguro obter o modo local trocando somente a URL. O ponto de acoplamento
está em `src/lib/mesa/store.ts`, que reúne autenticação, autorização,
consultas, RPCs, concorrência e chamadas ao Combat Engine.

## Inventário das dependências

### Supabase no servidor

- `src/lib/supabaseAdmin.ts` cria o cliente com service role, somente em rotas
  Node, e falha explicitamente quando as variáveis não existem.
- `src/lib/mesa/store.ts` usa `mesa_sessions`, `mesa_participants`,
  `mesa_characters`, `mesa_combats`, `mesa_combatants`, `mesa_battles`,
  `mesa_attack_resolutions`, `mesa_reload_resolutions` e
  `mesa_item_consume_resolutions`.
- As migrations definem funções SQL para claim/commit/recover/release de
  resoluções, commit atômico de movimento, dano/cura, death save, reload,
  consumo, net actions e quickhacks. Elas são parte do contrato de
  concorrência, não apenas detalhes de persistência.
- `src/lib/discord/sessionStore.ts` usa Supabase separado para configuração do
  Discord. Isso deve ser uma capacidade opcional, não a persistência implícita
  da Mesa local.

### Supabase no navegador

- `src/lib/mesa/realtime.ts` usa somente `NEXT_PUBLIC_SUPABASE_URL` e
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- O canal `mesa:<sessionId>` transporta apenas invalidação. O snapshot nunca é
  aceito do canal; cada cliente faz GET autenticado e recebe sua projeção.
- A service-role key não é lida pelo navegador.

### Autenticação, autorização e persistência

- A Mesa não depende de Supabase Auth para participantes. O navegador gera e
  guarda um `playerToken`; cada request envia `x-mesa-token`.
- O servidor resolve o participante por sessão + token, deriva GM/player do
  banco e valida posse, turno, combatente, sessão e operação.
- `gm_id`, `role`, `participant_id`, isolamento por `session_id`, CAS e
  `resolutionId` são invariantes. Campos de identidade enviados pelo cliente
  não são autoridade.
- As 32 rotas em `src/app/api/mesa` são gateways HTTP; as mutações chegam ao
  store e somente ele decide o resultado e grava o estado.

| Variável | Processo | Finalidade |
| --- | --- | --- |
| `SUPABASE_URL` | servidor | API/banco remoto |
| `SUPABASE_SERVICE_ROLE_KEY` | servidor | acesso privilegiado das rotas |
| `NEXT_PUBLIC_SUPABASE_URL` | navegador | Realtime opcional |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | navegador | Realtime público limitado |
| `ABLY_API_KEY` / Discord | servidor | integração independente |

`@supabase/supabase-js` é a dependência runtime declarada em `package.json`.
`src/lib/supabaseAdmin.ts` e `src/lib/discord/sessionStore.ts` são os únicos
clientes server-side encontrados; `src/lib/mesa/realtime.ts` é o cliente
browser-side. Os testes PostgreSQL (`tests/*postgres.test.ts` e os gateways que
verificam `SUPABASE_URL`) pulam de forma explícita quando o ambiente remoto não
está configurado; isso não constitui prova de funcionamento local.

## Contratos entre domínio e infraestrutura

O domínio reutilizável está nos módulos puros de `src/lib/combat/`,
`src/lib/combatEngine.ts`, `src/lib/mesa/rollPolicy.ts` e nas funções de
resolução. A infraestrutura ainda está misturada no store:

```text
HTTP route -> mesa/store.ts
             ├─ autenticação/autorização
             ├─ leitura atual do estado
             ├─ regra/Combat Engine
             ├─ claim + transação/CAS + idempotência
             └─ publicação de invalidação
```

A fronteira necessária é uma interface **server-side**, não uma cópia das
regras:

1. `MesaRepository`: leituras, gravações condicionais e operações de sessão;
2. `ResolutionStore`: claim, recuperação e commit idempotente;
3. `MesaEventTransport`: publicação de invalidação, sem snapshot;
4. autenticação/autorização comum, executada antes do repository.

O store deve continuar sendo a fachada de domínio. Supabase e PostgreSQL local
devem cumprir o mesmo contrato e retornar os mesmos erros de domínio.

## Arquitetura dos dois modos

### `supabase` — modo existente

1. Exige `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` e falha claro se
   estiverem ausentes.
2. Usa migrations e funções SQL atuais.
3. Mantém token de participante e validações GM/player atuais.
4. Publica invalidação no Supabase Realtime quando configurado.
5. Mantém GET autenticado + polling como reconciliação e fallback.

### `local` — modo futuro, explícito

1. Exige `MESA_HOSTING_MODE=local` e `MESA_LOCAL_DATABASE_URL`; não tenta
   conectar ao Supabase quando esse modo foi selecionado.
2. Aplica o mesmo esquema PostgreSQL em uma instância local. Credenciais ficam
   exclusivamente no servidor anfitrião.
3. Reutiliza token, autenticação, autorização e projeções privadas; não aceita
   `role` do cliente.
4. Usa WebSocket local somente para invalidação. O cliente sempre reconcilia
   pelo GET autenticado e mantém polling até o WebSocket ser validado.
5. Falhas são reportadas como falhas do modo selecionado; não existe fallback
   silencioso entre local e Supabase.
6. Discord e outras integrações remotas são capacidades explícitas e não podem
   bloquear criação, entrada ou combate local.

O modo deve ser escolhido no boot do servidor, nunca inferido pela ausência de
uma variável ou por uma falha de rede. Uma futura configuração deve validar
exatamente as credenciais do modo selecionado.

## PostgreSQL local e WebSocket

A opção recomendada é manter nomes, tipos, constraints e funções SQL
compatíveis com todas as migrations atuais. Primeiro deve existir uma suíte de
contrato contra PostgreSQL local; só depois o repository local pode substituir
as chamadas Supabase. `pg_dump`/`pg_restore` pode migrar dados, mas não deve
ser a definição do esquema.

Devem permanecer `unique(session_id, combat_id, resolution_id)`, os estados
`processing/committed/failed`, `claim_token`, locks `FOR UPDATE`, verificações
de valores anteriores e `row_count` dos commits condicionais. Isso inclui
movimento, ações, munição, HP, arquitetura e estado de netrunner.

O WebSocket local deve ser um adaptador de transporte, preferencialmente um
processo Node separado ou um servidor explicitamente suportado pelo runtime.
O evento mínimo é `{ sessionId, stateVersion, at }`; o browser valida a sessão
e faz GET. Nenhum snapshot privado atravessa o canal.

## Migração, riscos e compatibilidade

- `store.ts` tem muitos caminhos e os RPCs carregam invariantes que não ficam
  visíveis nos tipos TypeScript; extrair a interface antes de implementar evita
  divergência.
- As migrations são cumulativas, incluindo colunas e redefinições de funções;
  o bootstrap local deve executá-las em ordem.
- IDs UUID/texto e JSONB devem preservar formato. Resoluções `processing`
  exigem política de recuperação antes de exportar dados.
- RLS do Supabase é defesa adicional ao acesso server-side. No local, usuário
  PostgreSQL sem exposição externa, firewall e segredo fora do navegador
  substituem a fronteira de rede, sem remover autorização da aplicação.
- Supabase Realtime e WebSocket local precisam do mesmo contrato de invalidação
  e do mesmo polling.

## Alteração desta auditoria e próxima tarefa

Esta etapa adiciona somente este inventário. Nenhuma migration, rota, regra de
jogo, autenticação, permissão ou cliente Supabase foi alterado; nenhum fallback
entre modos foi implementado.

Próxima tarefa: extrair, em mudança isolada, interfaces para
`MesaRepository`, `ResolutionStore` e `MesaEventTransport`, mantendo o adapter
Supabase como única implementação. Adicionar testes de contrato contra o
Supabase existente e PostgreSQL local descartável; só então implementar o
adapter local e, depois, o WebSocket local.
