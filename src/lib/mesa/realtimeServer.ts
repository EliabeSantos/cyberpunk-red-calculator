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
// A extensão mantém o módulo importável também pelo loader Node usado na suíte
// de testes, sem mudar o runtime suportado pelo Next.
import { after } from "next/server.js";

import {
  captureMesaTelemetry,
  markMesaPublishStage,
  type MesaTelemetryRef,
} from "@/lib/mesa/telemetryServer";
import { mesaChannelName } from "@/lib/mesa/realtimeChannel";

/**
 * Publica somente uma invalidação. O estado não viaja no canal compartilhado:
 * cada navegador faz um GET autenticado e recebe sua própria projeção.
 */
/**
 * Agenda a invalidação para o hook `after()` do Next.
 *
 * As rotas continuam chamando esta função depois do commit, mas o `await` agora
 * espera somente o agendamento. O Next mantém o runtime vivo para a tarefa
 * `after`, ao contrário de um `void promise` solto após o retorno da rota.
 */
export async function publishMesaState(sessionId: string): Promise<void> {
  // O transporte é parte do modo de hospedagem. No modo local não inicialize
  // nem tente alcançar Supabase: a reconciliação do navegador continua sendo
  // feita por GET autenticado + polling.
  if (process.env.MESA_HOSTING_MODE?.trim().toLowerCase() === "local") {
    const { createMesaHostingInfrastructure } = await import("@/lib/mesa/hostingInfrastructure");
    const infrastructure = await createMesaHostingInfrastructure("local");
    await infrastructure.eventTransport.publishInvalidation(sessionId);
    return;
  }
  const telemetry = captureMesaTelemetry();
  try {
    after(() => publishMesaStateNow(sessionId, telemetry));
  } catch (error) {
    // Fora de um request scope (por exemplo, testes ou um adapter que não
    // implementa `after`), não há garantia de execução pós-resposta. O fallback
    // aguarda a publicação para não perder a invalidação nem mascarar o erro.
    console.warn("[mesa-telemetry] realtime_after_unavailable", {
      sessionId: sessionId.slice(0, 8),
      error: error instanceof Error ? error.name : "unknown",
    });
    await publishMesaStateNow(sessionId, telemetry);
  }
}

export async function publishMesaStateNow(
  sessionId: string,
  telemetry?: MesaTelemetryRef,
): Promise<boolean> {
  const startedAt = performance.now();
  markMesaPublishStage(telemetry, "T5");
  try {
    const admin = getSupabaseAdmin();
    const channel = admin.channel(mesaChannelName(sessionId));
    await channel.send({
      type: "broadcast",
      event: "state",
      payload: { invalidate: true, sessionId, at: Date.now() },
    });
    await admin.removeChannel(channel);
    markMesaPublishStage(telemetry, "T6", performance.now() - startedAt, true);
    return true;
  } catch (error) {
    markMesaPublishStage(telemetry, "T6", performance.now() - startedAt, false);
    console.error("[mesa-telemetry] realtime_publish_failed", {
      traceId: telemetry?.traceId,
      action: telemetry?.action,
      sessionId: sessionId.slice(0, 8),
      error: error instanceof Error ? error.name : "unknown",
    });
    // O commit já foi confirmado. O cliente permanece consistente via GET e
    // polling; a falha não pode virar um erro HTTP que incentive retry.
    return false;
  }
}
