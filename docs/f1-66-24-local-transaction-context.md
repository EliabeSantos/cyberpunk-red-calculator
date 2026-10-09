# F1.66.24 — Contexto transacional local compartilhado

## API

`LocalPostgresLifecycle.beginTransaction()` adquire um único `PoolClient`,
executa `BEGIN` e cria um `LocalPostgresTransactionContext` com:

- `repository: LocalPostgresMesaRepository` usando o mesmo client;
- `resolutionStore: LocalPostgresResolutionStore` usando o mesmo client;
- `query(sql, params)` para operações SQL auxiliares controladas;
- `commit()`;
- `rollback()`;
- `release()`.

Também existe `withLocalPostgresTransaction(callback)`, que obtém o lifecycle
selecionado, executa o callback, confirma em sucesso, desfaz em erro e sempre
libera a conexão.

O objeto retornado pela factory local expõe `beginLocalTransaction`. O modo
Supabase não expõe uma API transacional falsa: chamadas RPC independentes não
são tratadas como uma transação composta.

Quando a factory recebe `localPool` injetado, ela não associa automaticamente
um lifecycle descoberto pelo URL a esse pool. Para habilitar transações nesse
caso, `localLifecycle` também deve ser fornecido e corresponder ao mesmo pool;
isso evita que repositories e contexto transacional usem bancos/conexões
distintos.

## Garantias do lifecycle

- repository e resolution store recebem o mesmo `PoolClient`;
- `activeOperations` inclui queries do pool e transações abertas;
- shutdown aguarda transações ativas e bloqueia novas aquisições;
- rollback é tentado em erro do callback ou de commit;
- `release()` é idempotente e devolve o client ao pool;
- contextos finalizados recusam novas queries;
- nenhum contexto ou autorização é guardado globalmente;
- pools continuam memoizados por URL pelo lifecycle, não por request.

Erros de conexão/commit/rollback não expõem credenciais. Se rollback também
falhar, o erro original do callback é preservado pelo helper e o release ainda
é tentado.

## Limites

O contexto está implementado e testado em isolamento, mas nenhum fluxo de
combate o utiliza ainda. Portanto, `startCombat`, reinício, encerramento,
`addEnemies`, iniciativa, histórico e event log ainda não têm atomicidade local
garantida por este contexto.

O adapter Supabase permanece sem transação composta simulada. A integração dos
fluxos deverá construir todo o trabalho no contexto local antes do commit, sem
misturar o client do pool com chamadas independentes.

## Critérios de aceite para a próxima migração

1. todas as escritas de uma operação composta recebem repositories do mesmo
   contexto;
2. nenhuma função chama `new Pool`, `getSupabaseAdmin` ou um adapter fora do
   contexto durante a operação;
3. falha em qualquer etapa produz rollback verificável;
4. commit ocorre uma única vez, seguido de release;
5. concorrência mantém locks, constraints, CAS e isolamento de sessão;
6. o teste real local verifica estado antes/depois, não apenas a sequência de
   comandos de um fake client;
7. o caminho Supabase continua usando as RPCs oficiais sem alegar atomicidade
   adicional.

## Arquivos alterados

- `src/lib/mesa/hostingInfrastructure.ts`
- `tests/mesa-local-transaction-context.test.ts`
- este documento

Nenhuma migration foi alterada e nenhum fluxo de combate foi migrado.

**Nenhum teste, TypeScript, build ou lint foi executado.**
