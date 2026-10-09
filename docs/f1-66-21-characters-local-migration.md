# F1.66.21 — Migração de personagens e `linkCharacter` para PostgreSQL local

## Operações migradas

O inventário confirmou que `linkCharacter` depende somente de:

1. localizar o combate da sessão para bloquear jogador durante combate;
2. consultar `mesa_characters` por id;
3. fazer upsert do snapshot validado da ficha;
4. atualizar `mesa_participants.character_id` dentro da mesma sessão.

Foram migradas pelo repository selecionado:

- `findCharacterById`;
- `upsertCharacter`;
- a atualização já existente de participante;
- a leitura de combate por sessão já existente, usada apenas para a trava de
  edição durante combate.

`linkCharacter` continua responsável por validação de ficha, propriedade pelo
`owner_token`, autorização, status da sessão e bloqueio de jogador em combate.
Nenhuma regra de combate foi movida para o adapter.

## Equivalência dos adapters

`SupabaseMesaRepository` usa `mesa_characters.upsert(... onConflict: id)` e
`LocalPostgresMesaRepository` usa SQL parametrizado com `ON CONFLICT (id)` e
`sheet::jsonb`. Ambos retornam a linha persistida e filtram a atualização do
participante por `id` e `session_id`.

O schema existente de `20260926000000_mesa_sessions.sql` já contém
`mesa_characters` com `owner_token`, `display_name`, `sheet` e `updated_at`; não
foi necessária migration nova.

## Hosting e isolamento

`linkCharacter` obtém o repository por `createMesaHostingInfrastructure()`.
Com `MESA_HOSTING_MODE=local`, a consulta de combate, leitura/upsert da ficha e
atualização do participante não inicializam nem consultam Supabase. A rota
publica a invalidação pelo `MesaEventTransport` selecionado.

Com `supabase`, o comportamento anterior permanece no adapter Supabase. Não há
fallback entre os modos.

O evento continua contendo somente invalidação; a ficha e a projeção GM/player
seguem no GET autenticado. A propriedade da ficha é conferida no domínio antes
do upsert, comparando o `owner_token` persistido ao token da request.

## Limitações e riscos restantes

- `mesa_characters` e participantes ainda são atualizados em duas operações,
  como no fluxo anterior; uma transação agregada de vínculo permanece uma
  melhoria futura se for necessária para evitar ficha salva sem associação.
- Combate, materialização, inventário, mapa, NET, stealth, detecção, ICE e
  resoluções continuam fora da migração.
- Funções de combate que leem personagens diretamente ainda dependem do
  Supabase e não são chamadas pelo fluxo migrado de `linkCharacter`.
- O transporte local é em memória por processo e não substitui broker para
  múltiplas instâncias.
- A presença das migrations no banco de runtime ainda precisa ser verificada;
  o lifecycle/health check não comprova todas as tabelas e colunas.

## Arquivos alterados

- `src/lib/mesa/infrastructure.ts`
- `src/lib/mesa/localPostgresInfrastructure.ts`
- `src/lib/mesa/supabaseInfrastructure.ts`
- `src/lib/mesa/store.ts`
- este documento

Nenhuma migration foi alterada e nenhum commit foi criado.

**Nenhum teste, TypeScript, build ou lint foi executado.**
