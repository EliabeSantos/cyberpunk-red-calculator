/**
 * Persistência da configuração Discord das mesas no Supabase (Postgres).
 *
 * Guarda APENAS: sessionCode (mesa) → guildId → channelId. Nada de rolagens,
 * fichas, personagens ou histórico. Todas as chaves ficam server-side —
 * nenhum valor aqui pode aparecer em variáveis NEXT_PUBLIC_*.
 *
 * Sem `import "server-only"` para permanecer testável (o teste importa o
 * módulo fora do bundler do Next); o módulo é usado exclusivamente pelas
 * rotas /api, que nunca são empacotadas para o navegador.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { normalizeSessionCode } from "@/lib/discord/sessionCode";
import { isSnowflake } from "@/lib/discord/types";

export interface DiscordSessionConfig {
  guildId: string;
  channelId: string;
  updatedAt: string;
}

export interface DiscordSessionTarget {
  guildId: string;
  channelId: string;
}

/** Falha esperada quando as variáveis de ambiente do Supabase não estão definidas. */
export class DatabaseNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseNotConfiguredError";
  }
}

/** Falha de consulta/gravação no banco (rede, permissão, SQL). */
export class DatabaseQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseQueryError";
  }
}

const TABLE = "mesa_discord_configs";
const ROW_COLUMNS = "session_code, guild_id, channel_id, updated_at";

function dbEnv(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new DatabaseNotConfiguredError(
      "Variáveis SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configuradas. Preencha o .env.local (veja .env.example) e as env vars do projeto na Vercel.",
    );
  }
  return { url, key };
}

interface CachedClient {
  url: string;
  key: string;
  client: SupabaseClient;
}

/** Preserva o client entre requests/hot reloads; invalidado se o env mudar. */
const globalForSupabase = globalThis as unknown as { supabaseAdmin?: CachedClient };

function db(): SupabaseClient {
  const { url, key } = dbEnv();
  const cached = globalForSupabase.supabaseAdmin;
  if (cached && cached.url === url && cached.key === key) return cached.client;

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      // Resolve o fetch a cada chamada (permite trocar globalThis.fetch nos testes).
      fetch: (input, init) => globalThis.fetch(input, init),
    },
  });
  globalForSupabase.supabaseAdmin = { url, key, client };
  return client;
}

interface Row {
  session_code: string;
  guild_id: string;
  channel_id: string;
  updated_at: string;
}

function toConfig(row: Row): DiscordSessionConfig {
  return { guildId: row.guild_id, channelId: row.channel_id, updatedAt: row.updated_at };
}

function isValidTarget(value: unknown): value is DiscordSessionTarget {
  if (typeof value !== "object" || value === null) return false;
  const target = value as Record<string, unknown>;
  return isSnowflake(target.guildId) && isSnowflake(target.channelId);
}

/** Configuração da mesa, ou `null` se o código for inválido ou desconhecido. */
export async function getSessionConfig(sessionCode: unknown): Promise<DiscordSessionConfig | null> {
  const code = normalizeSessionCode(sessionCode);
  if (!code) return null;

  const { data, error } = await db()
    .from(TABLE)
    .select(ROW_COLUMNS)
    .eq("session_code", code)
    .limit(1);

  if (error) {
    throw new DatabaseQueryError(`Falha ao consultar a mesa no Supabase: ${error.message}`);
  }
  const row = data?.[0] as Row | undefined;
  return row ? toConfig(row) : null;
}

/** Salva/atualiza a vinculação mesa → guild → canal. Retorna `null` se inválida. */
export async function saveSessionConfig(
  sessionCode: unknown,
  target: DiscordSessionTarget,
): Promise<DiscordSessionConfig | null> {
  const code = normalizeSessionCode(sessionCode);
  if (!code || !isValidTarget(target)) return null;

  const { data, error } = await db()
    .from(TABLE)
    .upsert(
      {
        session_code: code,
        guild_id: target.guildId,
        channel_id: target.channelId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "session_code" },
    )
    .select(ROW_COLUMNS);

  if (error) {
    throw new DatabaseQueryError(`Falha ao salvar a mesa no Supabase: ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as Row | undefined;
  return row ? toConfig(row) : null;
}
