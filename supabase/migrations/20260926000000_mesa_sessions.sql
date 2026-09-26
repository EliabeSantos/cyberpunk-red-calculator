-- Mesa / Sessão online (Entregas 1 e 2 do modo multiplayer).
--
-- Hierarquia: USER (playerToken) → SESSION → PARTICIPANTS → CHARACTERS → COMBAT STATE.
--
-- Segurança: mesmo padrão da migração anterior (20260923120000_mesa_discord_configs.sql).
-- RLS habilitado SEM policies: nenhum papel (nem anon) lê/escreve direto.
-- Todo acesso acontece pelas rotas /api/mesa do Next.js, que validam o playerToken
-- e o papel (gm/player) antes de qualquer escrita. O Realtime público usa broadcast
-- (canal por id de sessão), não postgres_changes — por isso não há SELECT policy.
--
-- Não apaga nada: são tabelas novas, as chaves de localStorage continuam intactas.

-- ---------------------------------------------------------------------------
-- 1. Mesa / Sessão
-- ---------------------------------------------------------------------------
create table if not exists public.mesa_sessions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 60),
  -- Participante que criou a mesa (role 'gm'). Sem FK: a linha do participante só
  -- passa a existir depois da sessão, então o vínculo é garantido pela aplicação.
  gm_id       uuid,
  status      text not null default 'lobby'
                check (status in ('lobby', 'active', 'finished')),
  -- Código curto exibido na tela (ex.: 8F4K2). Único.
  join_code   text not null unique check (join_code ~ '^[A-Z0-9]{5}$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Participantes (separados do personagem)
-- ---------------------------------------------------------------------------
create table if not exists public.mesa_participants (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.mesa_sessions(id) on delete cascade,
  -- Bearer token emitido pelo servidor para o navegador. É a identidade efetiva
  -- (não há sistema de contas nesta primeira versão).
  player_token  text not null check (char_length(player_token) >= 16),
  display_name  text not null check (char_length(display_name) between 1 and 40),
  -- Uma ficha pode existir sem mesa; aqui guardamos apenas a REFERÊNCIA.
  character_id  text,
  role          text not null default 'player' check (role in ('gm', 'player')),
  created_at    timestamptz not null default now(),
  connected_at  timestamptz not null default now(),
  unique (session_id, player_token)
);

create index if not exists mesa_participants_session_idx
  on public.mesa_participants (session_id);

-- ---------------------------------------------------------------------------
-- 3. Personagens (snapshot da ficha usado para validar no servidor)
-- ---------------------------------------------------------------------------
-- A ficha de verdade continua no localStorage do jogador (modo local intacto).
-- Esta linha guarda uma CÓPIA do sheet para o backend poder calcular ataque,
-- dano, iniciativa e ações sem confiar no navegador. Uma ficha é de um dono só
-- e existe uma única vez, independentemente de em quantas mesas estiver.
create table if not exists public.mesa_characters (
  id           text primary key,
  owner_token  text not null,
  display_name text not null,
  sheet        jsonb not null,
  updated_at   timestamptz not null default now()
);

create index if not exists mesa_characters_owner_idx
  on public.mesa_characters (owner_token);

-- ---------------------------------------------------------------------------
-- 4. Combate compartilhado
-- ---------------------------------------------------------------------------
create table if not exists public.mesa_combats (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null unique references public.mesa_sessions(id) on delete cascade,
  status              text not null default 'active'
                        check (status in ('active', 'finished')),
  round               integer not null default 1 check (round >= 1),
  active_combatant_id uuid,
  turn_started_at     timestamptz,
  initiative_started  boolean not null default false,
  -- Log curto de eventos (ações, viradas de turno). Recortado para 50 entradas.
  event_log           jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists public.mesa_combatants (
  id                  uuid primary key default gen_random_uuid(),
  combat_id           uuid not null references public.mesa_combats(id) on delete cascade,
  session_id          uuid not null references public.mesa_sessions(id) on delete cascade,
  kind                text not null check (kind in ('character', 'enemy')),
  character_id        text references public.mesa_characters(id) on delete set null,
  participant_id      uuid references public.mesa_participants(id) on delete set null,
  name                text not null check (char_length(name) between 1 and 60),
  initiative          integer,
  initiative_detail   jsonb,
  -- Economia de ações (Cyberpunk RED: 2 por turno nesta aplicação).
  actions_max         integer not null default 2 check (actions_max >= 0),
  actions_remaining   integer not null default 2 check (actions_remaining >= 0),
  movement_max        integer not null default 6,
  movement_remaining  integer not null default 6,
  hp_current          integer not null default 0,
  hp_max              integer not null default 0,
  is_dead             boolean not null default false,
  conditions          jsonb not null default '[]'::jsonb,
  -- Posição na ordem de iniciativa (desempate estável).
  sort_order          integer not null default 0,
  created_at          timestamptz not null default now()
);

create index if not exists mesa_combatants_combat_idx
  on public.mesa_combatants (combat_id, sort_order);

-- ---------------------------------------------------------------------------
-- RLS: habilitado sem policies (acesso só pelo servidor, via service role)
-- ---------------------------------------------------------------------------
alter table public.mesa_sessions     enable row level security;
alter table public.mesa_participants enable row level security;
alter table public.mesa_characters   enable row level security;
alter table public.mesa_combats      enable row level security;
alter table public.mesa_combatants   enable row level security;
