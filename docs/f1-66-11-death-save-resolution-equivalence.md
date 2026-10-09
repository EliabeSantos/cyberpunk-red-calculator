# F1.66.11 — Resolução de Death Save no PostgreSQL local

## Operação e RPC

`LocalPostgresResolutionStore.commitDeathSave` foi implementado chamando a
função SQL oficial `commit_mesa_death_save_resolution`. O claim e o release não
ganharam métodos paralelos: Death Save reutiliza corretamente
`claim_mesa_attack_resolution` e `release_mesa_attack_resolution`, na tabela
`mesa_attack_resolutions`, como o fluxo existente de `store.ts`.

O adapter local apenas encaminha os argumentos `p_*`, incluindo os snapshots
antes/depois, token e resultado já calculado pelo domínio. Não replica rolagem,
DC, penalidades, morte ou estado NET.

## Particularidades preservadas

A RPC oficial mantém o lock da resolução, idempotência por `resolutionId`,
validação de `claim_token` e CAS simultâneo de `death_save_dc`,
`death_save_failures`, `is_dead` e `hp_current < 1`. Quando o resultado marca a
morte, a própria RPC também encerra o estado de Netrunner. O event log e o
status da resolução são atualizados na mesma transação.

Não foi introduzido claim/recovery específico porque essa família não possui
essas RPCs: a arquitetura real usa a máquina de ataque compartilhada.

## Contratos e drivers

Foi criada `tests/contract/deathSaveResolutionContractSuite.ts`, conectada a:

- `tests/mesa-death-save-resolution-contract-local.test.ts`;
- `tests/mesa-death-save-resolution-contract-supabase.test.ts`.

Ambos os drivers usam bancos reais, fixtures isoladas por UUID e cleanup por
cascata das sessões criadas. Os casos cobrem commit válido, replay/concor­rência,
conflito CAS sem estado parcial, release e isolamento entre sessões.

O destino local é aceito somente quando é PostgreSQL local descartável. Sem
configuração, os casos são skips explícitos; falhas de conexão ou schema não
viram fallback nem falso sucesso.

## Validação

**Nenhum teste, TypeScript, build ou lint foi executado.** Nenhuma migration foi
alterada e nenhum commit foi criado.
