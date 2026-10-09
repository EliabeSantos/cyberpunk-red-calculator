# F1.66.12 — Resolução de dano à cobertura no PostgreSQL local

## Operação e RPC

`LocalPostgresResolutionStore.commitCoverDamage` foi implementado usando a RPC
oficial `commit_mesa_attack_cover_resolution`.

Dano à cobertura reutiliza a máquina de resolução de ataque existente:

- claim: `claim_mesa_attack_resolution`;
- release: `release_mesa_attack_resolution`;
- commit: `commit_mesa_attack_cover_resolution`.

Não foram criadas operações específicas de claim/recovery/release, pois elas
não existem para esta família.

## Garantias preservadas

A RPC continua responsável por locks, `claim_token`, idempotência por
`resolutionId`, CAS de Actions e munição, CAS do HP da cobertura, atualização
atômica do `tactical_map`, event log e status da resolução.

O adapter local somente encaminha os argumentos `p_*` e serializa os campos
JSONB na fronteira PostgreSQL. Não duplica cálculo de dano, resistência,
destruição ou transições de estado.

## Contrato e drivers

Criada `tests/contract/coverDamageResolutionContractSuite.ts`, conectada a:

- `tests/mesa-cover-damage-resolution-contract-local.test.ts`;
- `tests/mesa-cover-damage-resolution-contract-supabase.test.ts`.

Os dois drivers usam fixtures reais e cobrem:

- dano válido;
- replay e concorrência;
- conflito de HP sem efeitos parciais, incluindo rollback do ator;
- isolamento entre sessões.

As fixtures criam sessões, combates, ator, munição e uma parede de cobertura
isolada por UUID. A limpeza remove somente as sessões criadas pelo caso. O
PostgreSQL local só aceita bancos descartáveis.

## Limitações

- NET e quickhack permanecem fora desta etapa.
- A integração geral das rotas com seleção de hosting continua pendente.
- A suíte não recalcula o dano: usa um resultado já preparado pelo domínio para
  validar exclusivamente a fronteira transacional da RPC.

## Validação

**Nenhum teste, TypeScript, build ou lint foi executado.** Nenhuma migration foi
alterada e nenhum commit foi criado.
