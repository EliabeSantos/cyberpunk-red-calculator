# F1.66.14 — Resolução de Quickhack no PostgreSQL local

## Operação identificada

O contrato `ResolutionStore` declara uma operação própria:

- `commitQuickhack`.

O fluxo de `executeCombatQuickhack` reutiliza a máquina de ataque para claim e
release:

- `claim_mesa_attack_resolution`;
- `release_mesa_attack_resolution`;
- `commit_mesa_quickhack_resolution`.

O adapter Supabase já possuía o commit. O adapter local agora encaminha a
assinatura final de 19 argumentos da RPC, incluindo os snapshots de supplies
adicionados para Shard Ejection.

## Garantias preservadas

A RPC oficial mantém:

- lock da resolução, `claim_token` e idempotência por `resolutionId`;
- CAS de Actions e `netrunner_state` do ator;
- CAS de HP, morte, supplies, efeitos e condições do alvo;
- rollback conjunto quando qualquer CAS falha;
- persistência do resultado e event log.

Nenhuma rolagem, regra de Quickhack, cálculo de dano, resistência ou validação
foi reproduzida no adapter local. Claims específicos de Quickhack também não
foram criados, pois a arquitetura real usa `mesa_attack_resolutions`.

## Suíte e drivers

Criada `tests/contract/quickhackResolutionContractSuite.ts`, conectada a:

- `tests/mesa-quickhack-resolution-contract-local.test.ts`;
- `tests/mesa-quickhack-resolution-contract-supabase.test.ts`.

Ambos os drivers usam fixtures reais isoladas por UUID e cobrem commit válido,
replay/concor­rência, conflito do estado do alvo com rollback do ator, release e
isolamento entre sessões.

As fixtures incluem estado do Netrunner, alvo com efeitos/condições e supplies,
permitindo verificar a garantia adicional da migration de Shard Ejection.

## Limitações

- A integração geral das rotas com seleção de hosting continua pendente.
- O contrato não calcula Quickhack; ele testa somente a fronteira transacional
  da RPC com snapshots já preparados.

## Validação

**Nenhum teste, TypeScript, build ou lint foi executado.** Nenhuma migration foi
alterada e nenhum commit foi criado.
