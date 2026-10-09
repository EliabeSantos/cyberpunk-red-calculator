# F1.66.9 — Consumo de itens e cura no ResolutionStore local

## Operações implementadas

`LocalPostgresResolutionStore` agora implementa os métodos que já existiam no
contrato `ResolutionStore` para esta família:

- `claimItemConsume`;
- `releaseItemConsume`;
- `commitItemConsume`;
- `commitItemHeal`.

O claim e o release compartilham a tabela `mesa_item_consume_resolutions`,
conforme o desenho oficial da funcionalidade. Cura não ganhou uma tabela
paralela: usa a mesma resolução de consumo e somente troca a função de commit.

## RPCs oficiais reutilizadas

- `claim_mesa_item_consume_resolution`;
- `release_mesa_item_consume_resolution`;
- `commit_mesa_item_consume_resolution`;
- `commit_mesa_item_heal_resolution`.

Os argumentos `p_*` são encaminhados em sua ordem declarada nas migrations e
os snapshots JSONB são serializados somente na borda PostgreSQL. O adapter não
implementa inventário, quantidade, cálculo de cura, HP máximo, autorização ou
economia de Actions.

## Garantias preservadas

As transações, locks, CAS de `supplies`, `actions_remaining` e `hp_current`,
validação de turno/combate, `claim_token`, `resolutionId`, idempotência e
rollback continuam sob autoridade das funções SQL oficiais. O replay de uma
resolução committed continua retornando o resultado persistido pela RPC, sem
consumir o item novamente.

O adapter Supabase não foi alterado: ele já chamava as mesmas quatro RPCs.
Nenhum fallback entre hosts, rota HTTP, autenticação ou regra de jogo foi
modificado.

## Contrato preparado

Foi criada `tests/contract/itemResolutionContractSuite.ts`, com cenários para
consumo e cura válidos, replay/concorrência, conflito de CAS sem efeitos
parciais, release após falha e isolamento da chave de resolução. A suíte exige
drivers com fixtures reais; os testes de rota Supabase existentes continuam
cobrindo os fluxos HTTP e suas validações de domínio.

## Limitações e bloqueios

- A suíte compartilhada foi posteriormente ligada aos drivers reais local e
  Supabase em `F1.66.10`; não usa mocks para provar atomicidade.
- Claims/recovery das demais famílias e death save, cobertura, NET e quickhack
  continuam fora desta etapa.
- Seleção explícita de hosting, integração das rotas ao adapter local e
  transporte local de eventos continuam pendentes.

## Validação

Conforme solicitado, **nenhum teste, TypeScript, build ou lint foi executado**.
Nenhum commit foi criado.
