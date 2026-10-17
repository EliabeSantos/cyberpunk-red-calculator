-- Identidade visual dos personagens (retrato de perfil + estados de combate).
--
-- Esta migration NÃO duplica a ficha: as linhas referenciam o id persistente
-- do personagem (o UUID gerado no cliente, mesmo de `mesa_characters.id` e de
-- `mesa_toolkit_records.id` para kind='character'). Personagens antigos não
-- têm linhas aqui e continuam funcionando com o fallback genérico do
-- renderizador.
--
-- Os binários ficam FORA do banco:
--   * modo supabase → bucket PRIVADO `mesa-character-visuals` do Supabase
--     Storage, criado sob demanda pelo serviço via service role (bucket novo
--     não precisa de migration; não há política de leitura pública e nenhum
--     cliente do navegador fala com o storage diretamente);
--   * modo local    → arquivos sob MESA_ASSETS_DIR (ou %ProgramData% no
--     Electron), resolvidos por src/lib/characterVisual/localAssetStorage.ts.
--
-- No máximo UM asset ativo por slot: um retrato e uma imagem por estado,
-- garantido pelo índice único abaixo (sem variantes nesta etapa).
--
-- RLS habilitado sem policies, igual às demais tabelas da Mesa: o acesso
-- acontece somente pelo servidor (service role / PostgreSQL local), que
-- autoriza cada operação pelo player_token do participante.

create table if not exists public.mesa_character_visual_profiles (
  character_id text primary key,
  owner_token text not null,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mesa_character_visual_profiles_owner_idx
  on public.mesa_character_visual_profiles (owner_token);

create table if not exists public.mesa_character_visual_assets (
  id text primary key,
  character_id text not null,
  owner_token text not null,
  kind text not null check (kind in ('portrait', 'combat_state')),
  -- Identificador estável do catálogo (src/lib/characterVisual/visualStates.ts).
  state text check (state is null or state ~ '^[A-Z][A-Z0-9_]*$'),
  storage_mode text not null check (storage_mode in ('supabase', 'local')),
  storage_ref text not null,
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  byte_size integer not null check (byte_size > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mesa_character_visual_assets_kind_state_check check (
    (kind = 'portrait' and state is null) or (kind = 'combat_state' and state is not null)
  )
);

-- Slot único: retrato único por personagem e uma imagem por estado. O estado
-- é indexado como string vazia para que o retrato (state nulo) também seja
-- único dentro do kind 'portrait'.
create unique index if not exists mesa_character_visual_assets_slot_uniq
  on public.mesa_character_visual_assets (character_id, kind, coalesce(state, ''));

create index if not exists mesa_character_visual_assets_owner_idx
  on public.mesa_character_visual_assets (owner_token);

create or replace function public.mesa_character_visual_assets_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists mesa_character_visual_assets_touch on public.mesa_character_visual_assets;
create trigger mesa_character_visual_assets_touch
before update on public.mesa_character_visual_assets
for each row execute function public.mesa_character_visual_assets_touch_updated_at();

alter table public.mesa_character_visual_profiles enable row level security;
alter table public.mesa_character_visual_assets enable row level security;
