/**
 * Cliente Supabase com service role, usado exclusivamente pelas rotas /api.
 *
 * Mesmo padrão de `src/lib/discord/sessionStore.ts` (client memoizado no
 * globalThis, env validada a cada chamada). Mantido separado para não alterar o
 * módulo do Discord já coberto por testes; a consolidação dos dois clients é
 * uma pendência registrada no README.
 *
 * Sem `import "server-only"` de propósito: os testes importam módulos fora do
 * bundler do Next. Só é alcançado por rotas API, que nunca vão ao navegador.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

const globalForMesa = globalThis as unknown as { supabaseMesaAdmin?: CachedClient };

export function getSupabaseAdmin(): SupabaseClient {
  const { url, key } = dbEnv();
  const cached = globalForMesa.supabaseMesaAdmin;
  if (cached && cached.url === url && cached.key === key) return cached.client;

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      // Resolve o fetch a cada chamada (permite trocar globalThis.fetch nos testes).
      fetch: (input, init) => globalThis.fetch(input, init),
    },
  });
  globalForMesa.supabaseMesaAdmin = { url, key, client };
  return client;
}

/** Lança `DatabaseQueryError` quando o Supabase devolve erro. */
export function expectNoError(error: { message: string } | null, context: string): void {
  if (error) throw new DatabaseQueryError(`${context}: ${error.message}`);
}
