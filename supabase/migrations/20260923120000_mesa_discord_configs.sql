-- Configuração do Discord por mesa: APENAS sessionCode → guildId → channelId.
-- Nada de rolagens, fichas, personagens ou histórico.
--
-- Como aplicar: cole no SQL Editor do Supabase (Dashboard → SQL Editor → New query → Run)
-- ou rode via CLI: supabase db push

create table if not exists public.mesa_discord_configs (
  session_code text primary key
    check (session_code ~ '^[a-z0-9][a-z0-9-]{2,47}$'),
  guild_id text not null
    check (guild_id ~ '^[0-9]{10,25}$'),
  channel_id text not null
    check (channel_id ~ '^[0-9]{10,25}$'),
  updated_at timestamptz not null default now()
);

-- RLS habilitado SEM policies: nenhum papel (nem anon) tem acesso direto.
-- Quem lê/grava é só o servidor da aplicação, via service role key.
alter table public.mesa_discord_configs enable row level security;
