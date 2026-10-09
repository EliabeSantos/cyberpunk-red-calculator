# F1.66.17 — Saída do Mestre e fechamento histórico da mesa

## Comportamento

O botão **Sair da mesa** do Mestre agora encerra a sessão antes de fechar a
tela. A ordem é:

1. chamar `DELETE /api/mesa/[id]`;
2. autenticar o Mestre;
3. finalizar o combate ativo;
4. fechar a partida histórica ativa em `mesa_battles`, preservando snapshot,
   combatentes, rodada final e log;
5. marcar `mesa_sessions.status = 'finished'` e atualizar `updated_at`;
6. publicar a invalidação;
7. somente depois remover o vínculo local do navegador e fechar a tela.

Os participantes não são apagados quando o Mestre encerra a mesa. Assim, a
sessão e os registros de histórico permanecem disponíveis para consultas
posteriores. O fechamento também registra o encerramento do combate no log.

## Hosting

O caminho atualmente integrado ao `store.ts` continua sendo Supabase. Se
`MESA_HOSTING_MODE=local` estiver selecionado, o fechamento falha explicitamente
com `local_hosting_not_integrated`, sem consultar ou alterar Supabase. A
integração completa do `store.ts` com o adapter local permanece pendente e não
foi mascarada por fallback.

## Arquivos alterados

- `src/lib/mesa/client.ts`
- `src/components/mesa/MesaRoom.tsx`
- `src/components/mesa/MesaEntry.tsx`
- `src/components/mesa/player/PlayerMesaScreen.tsx`
- `src/app/api/mesa/[id]/route.ts`
- `src/lib/mesa/store.ts`

Nenhuma migration foi alterada.
