/**
 * POST /api/mesa/join — entra numa mesa pelo código (ex.: 8F4K2).
 *
 * Body: { joinCode, displayName }
 * Header: x-mesa-token
 */
import { errorResponse, ok, readJson, tokenFrom } from "@/lib/mesa/http";
import { joinMesa } from "@/lib/mesa/store";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJson(request);
    const result = await joinMesa({
      joinCode: body.joinCode,
      displayName: body.displayName,
      playerToken: tokenFrom(request),
    });
    return ok({ session: result.session, participant: result.participant });
  } catch (error) {
    return errorResponse(error);
  }
}
