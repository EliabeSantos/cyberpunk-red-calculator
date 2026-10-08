import { errorResponse, ok, readJson, tokenFrom } from "@/lib/mesa/http";
import { MesaError, setNetrunnerQuickhackLoadout } from "@/lib/mesa/store";
import { publishMesaState } from "@/lib/mesa/realtimeServer";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const body = await readJson(request);
    const extra = Object.keys(body).filter((key) => !["combatantId", "quickhackIds"].includes(key));
    if (extra.length) throw new MesaError("Loadout é server-authoritative.", 400, "client_authority_forbidden");
    const result = await setNetrunnerQuickhackLoadout({ sessionId: id, token: tokenFrom(request), combatantId: body.combatantId, quickhackIds: body.quickhackIds });
    await publishMesaState(id);
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
