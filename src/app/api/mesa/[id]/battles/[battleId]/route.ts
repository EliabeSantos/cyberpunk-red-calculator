import { errorResponse, ok, tokenFrom } from "@/lib/mesa/http";
import { getBattle } from "@/lib/mesa/store";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string; battleId: string }> }): Promise<Response> {
  try {
    const { id, battleId } = await context.params;
    return ok({ battle: await getBattle({ sessionId: id, battleId, token: tokenFrom(request) }) });
  } catch (error) {
    return errorResponse(error);
  }
}
