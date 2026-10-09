# F1.66.16 — Factory explícita de hosting

## Contrato

`createMesaHostingInfrastructure` retorna um conjunto coerente de:

- `MesaRepository`;
- `ResolutionStore`;
- `MesaEventTransport`;
- `mode: "supabase" | "local"`.

A factory não guarda identidade, autorização, sessão ou dados de request.
Somente recursos compartilháveis de infraestrutura podem ser reutilizados.

## Seleção

`MESA_HOSTING_MODE` aceita exclusivamente `supabase` e `local`.

- `supabase`: importa tardiamente e instancia apenas os três adapters Supabase,
  usando um cliente injetado ou `getSupabaseAdmin()`.
- `local`: instancia `LocalPostgresMesaRepository` e
  `LocalPostgresResolutionStore` sobre um pool compartilhado e usa o
  `LocalMesaEventTransport` em memória, salvo transporte explicitamente
  injetado pelo bootstrap.

O modo local ainda falha explicitamente quando o banco ou outra configuração
obrigatória estiver ausente. Não existe fallback para Supabase.

Modo ausente, inválido, sem `MESA_LOCAL_DATABASE_URL` ou incompleto também falha
explicitamente.

## Lifecycle e isolamento

Um pool local é memoizado por URL em `globalThis` e reutilizado pelo processo;
não é criado por operação. O encerramento coordenado do pool permanece uma
responsabilidade do bootstrap futuro, pois esta etapa não implementa o
lifecycle completo do servidor local. Testes e bootstrap podem injetar um pool
já gerenciado.

O cliente Supabase só é importado/obtido no ramo `supabase`. Selecionar `local`
não exige credenciais Supabase nem chama `getSupabaseAdmin()`.

## Validação preparada

`tests/mesa-hosting-factory.test.ts` cobre seleção dos adapters, configuração
ausente/inválida, ausência de credenciais Supabase no modo local e dependências
locais incompletas.

**Nenhum teste, TypeScript, build ou lint foi executado.**
