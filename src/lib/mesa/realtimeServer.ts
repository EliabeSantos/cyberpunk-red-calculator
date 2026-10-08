/**
 * Publicação do estado da mesa no Supabase Realtime (SOMENTE SERVIDOR).
 *
 * Depois de cada mutação validada, a rota publica o snapshot novo no canal
 * `mesa:<sessionId>`. Os navegadores assinam esse canal (src/lib/mesa/realtime.ts)
 * e atualizam a tela — é o "Combat started" / "HP atualizado" de todos.
 *
 * O Realtime é um OTIMISMO: se falhar, nada quebra. O cliente sempre busca o
 * estado por GET ao montar e mantém um polling de segurança.
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export function mesaChannelName(sessionId: string): string {
  return `mesa:${sessionId}`;
}

/**
 * Publica somente uma invalidação. O estado não viaja no canal compartilhado:
 * cada navegador faz um GET autenticado e recebe sua própria projeção.
 */
export async function publishMesaState(sessionId: string): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    const channel = admin.channel(mesaChannelName(sessionId));
    await channel.send({
      type: "broadcast",
      event: "state",
      payload: { invalidate: true, sessionId, at: Date.now() },
    });
    await admin.removeChannel(channel);
  } catch {
    // Sem Supabase Realtime configurado ou rede fora: o cliente cai no polling.
  }
}
