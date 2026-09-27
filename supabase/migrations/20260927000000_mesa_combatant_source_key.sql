-- Vida (HP) espelhada na mesa (27/09/2026).
--
-- Cada linha de INIMIGO passa a guardar a chave estável do participante do
-- encontro que a originou. Sem isso não há como saber "qual inimigo do encontro
-- é esta linha da mesa": nomes se repetem (clones do bestiário) e sort_order
-- muda quando a iniciativa é rolada.
--
-- Uso:
--   • GM aplica dano/cura em /gm/encounters → POST /api/mesa/[id]/combat/hp
--     com { key, hp } → o servidor acha a linha pelo source_key;
--   • jogador muda o HP na ficha → mesmo endpoint, sem `key` (combatente do
--     próprio participante; essa parte não usa esta coluna).
--
-- Retrocompatível e opcional para o RESTO do app: a coluna é nullable.
-- Linhas antigas ficam com NULL (só não espelham HP de inimigo). Se a migração
-- não for aplicada, o servidor detecta na primeira escrita, segue sem a coluna
-- (o combate continua começando normalmente) e recusa o HP de inimigo com
-- `503 migration_pending`.
--
-- Mesmo padrão das migrações anteriores: RLS habilitado sem policies —
-- só o servidor (service role) escreve, pelas rotas /api/mesa.

alter table public.mesa_combatants
  add column if not exists source_key text;
