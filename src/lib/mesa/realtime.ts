/**
 * Assinatura do estado da mesa no Supabase Realtime (NAVEGADOR).
 *
 * É só transporte: quem VALIDA continua sendo o servidor. O payload recebido é
 * um snapshot já autorizado — o mesmo que o GET devolveria.
 *
 * Se a env pública não existir ou a conexão falhar, `subscribeMesaState` devolve
 * `null` e o chamador usa polling (ver `useMesaState`).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { mesaChannelName } from "@/lib/mesa/realtimeServer";
import type { MesaState } from "@/lib/mesa/types";

export type MesaSnapshot = Omit<MesaState, "viewer">;

export interface MesaSubscription {
  close: () => void;
}

interface CachedPublicClient {
  url: string;
  key: string;
  client: SupabaseClient;
}

const globalForPublic = globalThis as unknown as { supabaseMesaPublic?: CachedPublicClient };

/** Lido em forma literal para o Next embutir o valor no bundle de produção. */
function publicEnv(): { url: string; key: string } | null {
  const url = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_SUPABASE_URL : undefined;
  const key = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY : undefined;
  if (!url || !key) return null;
  return { url, key };
}

function publicClient(url: string, key: string): SupabaseClient {
  const cached = globalForPublic.supabaseMesaPublic;
  if (cached && cached.url === url && cached.key === key) return cached.client;

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 10 } },
  });
  globalForPublic.supabaseMesaPublic = { url, key, client };
  return client;
}

/**
 * Assina o canal da mesa. `onState` recebe o snapshot completo.
 * Devolve `null` quando o Realtime não está disponível neste ambiente.
 */
export function subscribeMesaState(
  sessionId: string,
  onState: (state: MesaSnapshot) => void,
  onStatus?: (status: string) => void,
): MesaSubscription | null {
  const env = publicEnv();
  if (!env) return null;

  try {
    const client = publicClient(env.url, env.key);
    const channel = client
      .channel(mesaChannelName(sessionId))
      .on("broadcast", { event: "state" }, (message) => {
        const payload = (message ?? {}) as { state?: MesaSnapshot };
        if (payload.state) onState(payload.state);
      })
      .subscribe((status) => {
        onStatus?.(String(status));
      });

    return {
      close: () => {
        void client.removeChannel(channel);
      },
    };
  } catch {
    return null;
  }
}
