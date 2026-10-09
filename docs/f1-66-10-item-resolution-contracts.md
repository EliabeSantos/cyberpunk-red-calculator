# F1.66.10 — Contratos reais de consumo de itens e cura

## Drivers conectados

`tests/contract/itemResolutionContractSuite.ts` agora é executada pelos dois
alvos reais:

- `tests/mesa-item-resolution-contract-local.test.ts`, usando
  `LocalPostgresResolutionStore` e `pg` contra um banco local descartável;
- `tests/mesa-item-resolution-contract-supabase.test.ts`, usando
  `SupabaseResolutionStore` e as RPCs remotas com service role.

Ambos chamam os mesmos métodos do contrato: claim, release, commit de consumo
e commit de cura. Nenhuma fixture usa mock para validar atomicidade.

## Casos executados por cada driver

Para consumo e cura, os dois alvos executam:

- commit válido e estado `committed`;
- replay concorrente da mesma resolução sem efeitos duplicados;
- conflito de CAS sem alteração parcial, seguido de release;
- isolamento por sessão na chave completa da resolução.

As leituras de verificação consultam diretamente o banco e conferem status da
resolução, Actions, quantidade do inventário e HP.

## Fixtures e limpeza

Cada caso cria IDs UUID novos para duas sessões, dois combates e um combatente.
O combate principal inicia ativo, com o combatente como ativo e um item Medkit
unitário. Cura inicia com HP 10/20; consumo inicia com o mesmo inventário e
economia de Actions.

As sessões são a raiz de cascata das fixtures. O cleanup remove somente as duas
sessões criadas pelo caso. O alvo local só aceita URLs locais e bancos cujo nome
contenha `contract`, `test`, `tmp` ou `disposable`, seguindo o padrão dos
contratos anteriores.

Sem credenciais/URL, os casos são skips explícitos. Com ambiente configurado,
falha de conexão ou schema é reportada como erro, não como sucesso ou fallback.

## Validação

Conforme solicitado, **nenhum teste foi executado**. Também não foram
executados TypeScript, build ou lint. Nenhum commit foi criado.
