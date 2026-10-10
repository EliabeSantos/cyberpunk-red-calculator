-- Snapshot visual do combate: permite reabrir uma partida sem depender do
-- combate vivo da sessão.
alter table public.mesa_battles
  add column if not exists tactical_map jsonb;
