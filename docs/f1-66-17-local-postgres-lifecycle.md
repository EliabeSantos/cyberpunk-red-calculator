# F1.66.17 — Lifecycle seguro do PostgreSQL local

## Estados

O recurso local compartilhado possui os estados:

- `starting`: pool criado, health check ainda não concluído;
- `ready`: `select 1` respondeu;
- `degraded`: falha de disponibilidade/conexão; o pool não é destruído;
- `closing`: novas queries são recusadas e operações ativas podem terminar;
- `closed`: pool encerrado e indisponível.

Falhas de configuração (`MESA_LOCAL_DATABASE_URL` ausente), disponibilidade,
conexão e timeout de shutdown possuem erros distintos. Mensagens não incluem a
URL, usuário ou senha.

## Pool e recuperação

O pool é memoizado em `globalThis` por URL, o que evita duplicação durante hot
reload do Next.js e reutiliza o recurso entre requests na mesma instância. Em
produção, cada instância mantém seu próprio pool; não há estado de autorização
no singleton.

Um erro do pool marca o lifecycle como `degraded`, mas não destrói conexões
ativas. Um novo health check pode recuperar o estado para `ready`. Depois de
`closed`, uma nova solicitação cria um lifecycle novo.

## Encerramento

`closeLocalPostgresLifecycles()` marca todos os lifecycles como `closing`,
impede novas operações, espera as operações ativas e chama `pool.end()`. Se o
timeout expirar, lança erro e mantém o pool em `closing`; não força descarte de
conexões ativas. O bootstrap futuro deve chamar esse método no shutdown do
processo.

Nenhum serviço PostgreSQL do sistema operacional é iniciado automaticamente.
O lifecycle gerencia somente um servidor já disponível na URL configurada.

## Validação preparada

`tests/mesa-hosting-lifecycle.test.ts` cobre pool compartilhado, health check,
falha e recuperação, bloqueio durante encerramento, encerramento controlado e
timeout sem descarte arbitrário.

**Nenhum teste, TypeScript, build ou lint foi executado.**
