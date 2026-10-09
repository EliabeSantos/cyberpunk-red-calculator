# F1.66.13 — Resoluções de NET no PostgreSQL local

## Operação identificada

O contrato `ResolutionStore` declara somente uma operação própria para esta
família: `commitNetAction`. O fluxo de `executeNetAction` em `store.ts` usa a
máquina de resolução de ataque para claim e release:

- `claim_mesa_attack_resolution`;
- `release_mesa_attack_resolution`;
- `commit_mesa_net_action_resolution`.

O adapter Supabase já implementava `commitNetAction`. O adapter local agora
encaminha os 16 argumentos oficiais da RPC, serializando os campos JSONB sem
reproduzir a lógica de NET.

## Garantias preservadas

`commit_mesa_net_action_resolution` permanece responsável por:

- lock e idempotência da resolução;
- validação do `claim_token` e escopo de sessão/combate;
- CAS de Actions, `netrunner_state` e `net_discovery`;
- CAS de `net_architectures`;
- rollback conjunto em qualquer conflito;
- atualização do event log e resultado persistido.

Não foram criados claims genéricos nem RPCs novas. Cálculos de rolagem,
arquitetura, descoberta, estado de ICE e consumo de NET Actions continuam no
domínio antes do commit.

## Contratos e drivers

Criada `tests/contract/netActionResolutionContractSuite.ts`, conectada a:

- `tests/mesa-net-action-resolution-contract-local.test.ts`;
- `tests/mesa-net-action-resolution-contract-supabase.test.ts`.

Ambos os drivers usam fixtures reais isoladas por UUID e cobrem commit válido,
replay/concor­rência, conflito de Actions com rollback de descoberta e
Architecture, release e isolamento entre sessões.

O destino local só aceita PostgreSQL descartável. Sem credenciais, os casos
ficam em skip explícito; falhas de schema ou conexão não produzem fallback.

## Dependências restantes

- Quickhack permanece fora desta etapa e continua dependente de
  `commit_mesa_quickhack_resolution`.
- Seleção de hosting e integração geral das rotas ao adapter local continuam
  pendentes.

## Validação

**Nenhum teste, TypeScript, build ou lint foi executado.** Nenhuma migration foi
alterada e nenhum commit foi criado.
