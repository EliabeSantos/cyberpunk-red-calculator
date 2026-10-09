# F1.66.5 — PostgreSQL local real e validação das migrations

> Executado em 09/10/2026. O modo Supabase continua sendo o único caminho
> executado pela aplicação. Nenhum commit foi feito.

## 1. Diagnóstico do ambiente e opção escolhida

Evidências coletadas antes de qualquer decisão:

| Verificação | Resultado |
| --- | --- |
| `psql --version` | 18.6 — **somente cliente** |
| `/usr/lib/postgresql/18/bin` | só ferramentas cliente; sem `postgres`, `initdb`, `pg_ctl` |
| `pg_isready -h 127.0.0.1:5432` | *no response* |
| Docker / podman / nerdctl | ausentes |
| `sudo -n true` | *interactive authentication is required* |
| `apt-cache policy postgresql-18` | Installed: **(none)**, Candidate: 18.6 |
| `npm ping` | OK (rede disponível) |

**Opção escolhida (autorizada pelo usuário):** instalar o servidor via apt.
Eu não executo `sudo`/`apt` nem altero serviços — o usuário rodou:

```bash
sudo apt-get update && sudo apt-get install -y postgresql-18
sudo -u postgres createuser -s "$(whoami)"   # papel local com peer auth
# se o WSL2 não subir o serviço sozinho:
sudo service postgresql start
```

Estado resultante: cluster `18/main` **online** em `/var/lib/postgresql/18/main`,
socket em `/var/run/postgresql`, papel `marbas` conectando por peer auth.

Para **encerrar**: `sudo service postgresql stop`. Para recriar o banco de
teste: `dropdb --if-exists mesa_contract_test && createdb mesa_contract_test`.

Alternativas que **não** foram usadas (registradas por completude): pacote npm
com binários embutidos (exigiria nova dependência de runtime para o servidor);
`pg-mem`/clientes fake (não é PostgreSQL real e não serve de prova).

## 2. Segurança do banco descartável

`scripts/apply-contract-migrations.sh` foi reforçado e **testado**:

| Regra | Comportamento verificado |
| --- | --- |
| Sem `MESA_CONTRACT_DATABASE_URL` | recusa e mostra o exemplo de uso |
| Nome do banco sem `contract`/`test`/`tmp`/`disposable` | recusa (`banco '/postgres' não está marcado como descartável`) |
| URL remota (`postgres://u:p@203.0.113.9/...`) | recusa: só destino local |
| Nome/credencial nunca impressos | só o nome do banco é citado no fim |
| Rastreabilidade | imprime `-> <migration>` antes de cada arquivo |
| Falha | para no primeiro erro e aponta **qual** migration falhou, sem rollback manual nem mascaramento |
| Nenhum DROP/TRUNCATE | o script só executa os arquivos de migration |

O alvo local `tests/mesa-repository-contract-local.test.ts` aplica a **mesma**
validação de URL e ainda separa dois erros distintos: falha de conexão vs.
banco sem migrations (nenhum vira skip silencioso).

Evidências de segurança da execução real:

- banco usado: `mesa_contract_test` (criado do zero para esta etapa);
- após a suíte: `mesa_sessions`, `mesa_combats`, `mesa_combatants` e
  `mesa_participants` com **0 linhas** (a fixture limpa as próprias Mesas via
  cascata);
- sem `MESA_LOCAL_TEST_DATABASE_URL`: 8 casos **skipados** com motivo explícito;
- URL apontando para `postgres` (banco do sistema): **erro visível**, não skip.

## 3. Validação das migrations (execução real)

Banco novo, migrations aplicadas em ordem lexicográfica:

```
dropdb --if-exists mesa_contract_test && createdb mesa_contract_test
MESA_CONTRACT_DATABASE_URL=postgres:///mesa_contract_test ./scripts/apply-contract-migrations.sh
→ OK: 28 migrations aplicadas em '/mesa_contract_test'
```

### Defeito encontrado e corrigido

`20261017000000_mesa_tactical_cover_catalog.sql` falhava em qualquer
PostgreSQL:

```
ERROR: column "entries.ord" must appear in the GROUP BY clause or be used in an aggregate function
```

Causa: `order by ord` estava **fora** do agregado, numa consulta sem `GROUP BY`
— SQL inválido, não uma incompatibilidade de versão.

Correção: `jsonb_agg(<expressão> order by ord)` (o `ORDER BY` dentro do
agregado), que é a forma válida e expressa exatamente a intenção do arquivo —
preservar a ordem original dos itens. Nenhuma outra parte da migration mudou.

**Compatibilidade com o histórico/Supabase existente:**

- a alteração é uma `UPDATE` sobre `mesa_sessions.tactical_map`; como o SQL
  original não podia ser executado em lugar nenhum, nenhum banco pode ter
  recebido esse efeito antes;
- verificação remota (leitura, service role): das **266** sessões, 163 têm
  `geometry`, mas há **0** itens em `walls`/`doors` — o efeito da migration é
  nulo também sobre os dados atuais, então não há drift a corrigir no Supabase;
- o histórico de migrations do projeto hospedado não é consultável via
  PostgREST (`supabase_migrations` não é schema exposto), o que fica registrado
  como limite desta verificação.

Nenhum DDL manual foi usado para contornar migration; nenhuma migration foi
pulada, reinicializada ou apagada.

### Schema resultante (banco novo)

| Item | Valor |
| --- | --- |
| Tabelas `public` | 10 (`mesa_sessions`, `mesa_participants`, `mesa_characters`, `mesa_combats`, `mesa_combatants`, `mesa_battles`, `mesa_attack_resolutions`, `mesa_reload_resolutions`, `mesa_item_consume_resolutions`, `mesa_discord_configs`) |
| Funções `public` | 20, incluindo os 10 `commit_mesa_*` |
| RLS | habilitado nas 10 tabelas, **0 policies** (desenho existente: só a rota server-side acessa) |
| Extensões | apenas `plpgsql` |
| Schemas com dados da aplicação | apenas `public` |

### Dependências exclusivas do Supabase: **nenhuma encontrada**

As migrations não referenciam `auth.*`, `pg_net`, `graphile_worker`,
`storage.*`, `alter publication ... supabase_realtime` nem papéis
`anon`/`authenticated`/`service_role`. Também não exigem `pgcrypto`
(`gen_random_uuid()` é nativo desde o PostgreSQL 13). As tabelas usadas pelo
código (`grep` de `from("...")` em `src/lib`) batem 1:1 com as criadas.

## 4. Adaptador local mínimo

`src/lib/mesa/localPostgresInfrastructure.ts` — `LocalPostgresMesaRepository`:

- implementa **apenas** o que a suíte de contrato cobre: as 6 leituras por
  escopo, `updateCombatant` (CAS), `insertCombatants`, `upsertCombatants`
  (`on conflict (id) do update`) e `deleteCombatants` (escopo obrigatório);
- SQL **parametrizado**; nomes de coluna validados por expressão regular antes
  de entrar em instrução montada;
- mesmos textos de erro do adapter Supabase (`<contexto>: <detalhe>`), mesma
  classe `DatabaseQueryError` e mesmos registros `snake_case` — o formato
  persistido não muda;
- payload ausente recebe `DEFAULT`, reproduzindo o resultado do PostgREST;
- **não** implementa `ResolutionStore`/`MesaEventTransport`, **não** é importado
  por nenhuma rota ou por `store.ts`: não há seleção de hospedagem nem fallback
  silencioso — a aplicação segue inteiramente em Supabase.

Dependência nova: `pg` (dependência de runtime, usada pelo adaptador local) e
`@types/pg` (dev), ambas autorizadas pelo usuário. `pg` não tem vulnerabilidade
conhecida no `npm audit` (as ocorrências listadas são pré-existentes: `next`,
`braces`, `sharp`, `source-map-js`).

## 5. Contratos executados contra PostgreSQL real

| Alvo | Execução real? | Resultado |
| --- | --- | --- |
| **PostgreSQL local descartável** (`mesa_contract_test`, 28 migrations) | **sim** | **8/8** |
| **Supabase remoto** (PostgreSQL real via PostgREST) | **sim** | **8/8** |
| Cliente fake (mapeamento de chamadas) | não — só mapeamento | 6/6 |

Casos cobertos nos dois alvos reais: persistência de payload e escopo;
recusa de PK duplicada com preservação da linha original; upsert parcial;
leitura com escopo de outra Mesa/combate; CAS aplicado e CAS conflitante;
update com escopo alheio; delete por escopo; delete sem escopo recusado.

Reprodução:

```bash
createdb mesa_contract_test
MESA_CONTRACT_DATABASE_URL=postgres:///mesa_contract_test ./scripts/apply-contract-migrations.sh
MESA_LOCAL_TEST_DATABASE_URL=postgres:///mesa_contract_test \
  node --experimental-strip-types --experimental-loader ./tests/ts-loader.mjs \
  --test tests/mesa-repository-contract-local.test.ts
```

Sem a variável, os 8 casos ficam **skipados** com motivo explícito — o
"default" do repositório continua sem exigir PostgreSQL local.

## 6. O que ainda bloqueia o self-hosting

1. **Seleção de hospedagem** (`MESA_HOSTING_MODE=supabase|local`) — não existe;
   e deve ser explícita, sem fallback silencioso.
2. **Adapter local completo**: `ResolutionStore` (claims/commits das RPCs
   `commit_mesa_*`) e `MesaEventTransport` (invalidações) — fora do escopo
   desta etapa, e nenhum gameplay foi migrado.
3. **Famílias restantes de `store.ts`**: leituras de projeção/turno, HP,
   movimento, ações, netrunner, `event_log`.
4. **Ordenação explícita em contrato**: hoje nem `listCombatantsByCombat` de
   nenhum adapter ordena (`ORDER BY` continua implícito — pendência conhecida
   desde o caso do reload).
5. **WebSockets locais**, Realtime remoto validado e porta/Radmin — fora do
   escopo; nada foi implementado aqui.

## 7. Resumo do que mudou

| Arquivo | Mudança |
| --- | --- |
| `supabase/migrations/20261017000000_mesa_tactical_cover_catalog.sql` | `order by ord` movido para dentro de `jsonb_agg` (SQL inválido → válido) |
| `scripts/apply-contract-migrations.sh` | validação de URL (local + descartável), rastreabilidade, aponta a migration que falhou, não imprime credencial |
| `src/lib/mesa/localPostgresInfrastructure.ts` | **novo** adapter mínimo de `MesaRepository` (só contratos) |
| `tests/mesa-repository-contract-local.test.ts` | monta o alvo local com `pg`; valida URL; erros distintos de conexão/schema; `close()` |
| `tests/contract/mesaRepositoryContractSuite.ts` | `close?()` opcional + hook `after` |
| `package.json` | `pg` (dependência) e `@types/pg` (dev) |
| `docs/f1-66-5-local-postgres-validation.md` | este documento |
