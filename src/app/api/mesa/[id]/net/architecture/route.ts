import { errorResponse, ok, readJson, tokenFrom } from "@/lib/mesa/http";
import { MesaError, updateNetArchitectures } from "@/lib/mesa/store";
import { publishMesaState } from "@/lib/mesa/realtimeServer";

export const runtime = "nodejs";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const body = await readJson(request);
    const extra = Object.keys(body).filter((key) => key !== "architectures");
    if (extra.length) throw new MesaError("Arquitetura NET é server-authoritative.", 400, "client_authority_forbidden");
    const architectures = await updateNetArchitectures({ sessionId: id, token: tokenFrom(request), architectures: body.architectures });
    await publishMesaState(id);
    return ok({ architectures });
  } catch (error) {
    return errorResponse(error);
  }
}
