import { errorResponse, ok, readJson, tokenFrom } from "@/lib/mesa/http";
import { jackInCombatant, MesaError, safeJackOutCombatant } from "@/lib/mesa/store";
import { publishMesaState } from "@/lib/mesa/realtimeServer";

export const runtime = "nodejs";

interface Context { params: Promise<{ id: string }> }

/** F1.51: somente intenção; conexão e economia são resolvidas no servidor. */
export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    const body = await readJson(request);
    const extra = Object.keys(body).filter((key) => !["action", "combatantId", "accessPointId", "connectionType"].includes(key));
    if (extra.length) throw new MesaError("Estado de conexão é server-authoritative.", 400, "client_authority_forbidden");
    if (body.action === "jack_in") {
      const result = await jackInCombatant({
        sessionId: id,
        token: tokenFrom(request),
        combatantId: body.combatantId,
        accessPointId: body.accessPointId,
        connectionType: body.connectionType,
      });
      await publishMesaState(id);
      return ok(result);
    }
    if (body.action === "safe_jack_out") {
      const result = await safeJackOutCombatant({ sessionId: id, token: tokenFrom(request), combatantId: body.combatantId });
      if (result.changed) await publishMesaState(id);
      return ok(result);
    }
    if (body.action === "unsafe_jack_out") {
      throw new MesaError("Unsafe Jack Out só pode ser iniciado por uma resolução server-side.", 403, "server_only_transition");
    }
    throw new MesaError("Ação de conexão inválida.", 400, "invalid_connection_action");
  } catch (error) {
    return errorResponse(error);
  }
}
