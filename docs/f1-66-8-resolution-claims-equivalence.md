# F1.66.8 — Claims, recovery e finalização local de ataque/recarga

## Auditoria do fluxo

Ataque e reload seguem a mesma máquina de resolução, com tabelas separadas:

1. o domínio autentica e valida Mesa, papel, ator, alvo/arma, turno e regras;
2. consulta uma resolução já persistida para replay, falha ou processamento;
3. executa a RPC de claim, que cria a linha `processing` ou devolve o claim
   existente sob lock;
4. uma requisição concorrente observa o claim e aguarda, sem executar o Engine
   novamente;
5. o domínio monta os argumentos `p_*` já calculados;
6. a RPC de commit bloqueia a resolução, verifica `claim_token`, executa os
   CASs de ator/alvo e marca a resolução como `committed` na mesma transação;
7. em falha antes do commit, o domínio chama release e a RPC marca a claim como
   `failed`;
8. recovery após espera verifica claims abandonados e os converte para
   `failed` depois de 30 segundos;
9. event-log/publicação permanecem depois do commit — nunca são pré-condição
   para os efeitos autoritativos.

As RPCs oficiais reutilizadas são:

- `claim_mesa_attack_resolution`;
- `recover_mesa_attack_resolution`;
- `release_mesa_attack_resolution`;
- `commit_mesa_attack_resolution`;
- `claim_mesa_reload_resolution`;
- `recover_mesa_reload_resolution`;
- `release_mesa_reload_resolution`;
- `commit_mesa_reload_resolution`.

## Adapter local

`LocalPostgresResolutionStore` foi ampliado com os métodos de claim, recovery,
release e commit de ataque e reload. Cada método chama a função SQL existente
via `pg`, com parâmetros posicionais e JSONB serializado. O adapter não contém
regras de dano, alvo, recarga, custo ou turno.

`LocalPostgresMoveResolutionStore` continua disponível como alias compatível,
herdando do adapter de resolução local comum.

O `ResolutionStatus` agora também representa `missing`, estado devolvido pelas
RPCs de recovery.

## Contratos preparados

`tests/contract/resolutionClaimContractSuite.ts` foi criado para os dois alvos
reais e cobre, para ataque e reload:

- claim inicial;
- repetição da mesma resolução;
- concorrência de claims;
- recovery de claim abandonado;
- release após falha;
- commit e replay idempotente;
- isolamento por sessão/combate;
- conflito de token sem efeitos parciais.

Targets preparados:

- `tests/mesa-resolution-claims-local.test.ts`;
- `tests/mesa-resolution-claims-supabase.test.ts`.

As fixtures usam sessões, combates, combatentes e resoluções descartáveis. Os
testes **não foram executados nesta etapa**, conforme solicitado.

## Limitações

- O adapter local ainda não implementa as operações de item, dano, death save,
  cobertura, NET ou quickhack.
- A seleção de hospedagem e a integração das rotas continuam pendentes.
- O modo Supabase não foi removido nem substituído; a aplicação continua sem
  fallback silencioso.
- Nenhum commit, teste, build, verificação TypeScript ou lint foi executado
  nesta etapa.
