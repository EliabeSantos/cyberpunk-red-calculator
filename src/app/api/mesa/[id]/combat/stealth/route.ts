import { errorResponse, ok, readJson, tokenFrom } from "@/lib/mesa/http";
import { publishMesaState } from "@/lib/mesa/realtimeServer";
import { MesaError, setCombatantStealth } from "@/lib/mesa/store";

export const runtime = "nodejs";
interface Context { params: Promise<{ id: string }> }

/** O cliente envia intenção de estado; a autorização pertence ao servidor. */
export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    const body = await readJson(request);
    const extra = Object.keys(body).filter((key) => !["combatantId", "stealthed"].includes(key));
    if (extra.length) throw new MesaError("Estado de Stealth é server-authoritative.", 400, "client_authority_forbidden");
    const result = await setCombatantStealth({ sessionId: id, token: tokenFrom(request), combatantId: body.combatantId, stealthed: body.stealthed });
    if (result.changed) await publishMesaState(id);
    return ok(result);
  } catch (error) { return errorResponse(error); }
}
