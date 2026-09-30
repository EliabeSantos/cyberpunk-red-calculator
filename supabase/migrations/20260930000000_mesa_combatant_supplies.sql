-- ---------------------------------------------------------------------------
-- Mochila do inimigo na linha da mesa (`mesa_combatants.supplies`)
--
-- Dono da mochila é a tela de Encontros: é lá que o ataque gasta bala, que o
-- recarregamento consome a reserva e que o item de cura restaura HP. A mesa
-- só recebe o estado espelhado (mesmo caminho do HP) para a linha do inimigo
-- mostrar `pente 3/8 · reserva 13` e os itens que restam.
--
-- Coluna opcional: o servidor detecta a ausência e regrava sem ela
-- (`suppliesSupport` em src/lib/mesa/store.ts), então aplicar depois não
-- quebra nada — só passa a exibir a mochila.
-- ---------------------------------------------------------------------------
alter table public.mesa_combatants
  add column if not exists supplies jsonb;
