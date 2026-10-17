/**
 * Identidade visual do personagem (SOMENTE servidor).
 *
 * GET    /api/character-visual?characterId=…[&sessionId=…&name=…]  → manifesto
 * PUT    /api/character-visual                                      → nome ou imagem
 * DELETE /api/character-visual                                      → remove imagem
 *
 * A autorização é sempre decidida aqui pelo `x-mesa-token` (o id da
 * requisição nunca muda o dono): o chamador precisa ser o proprietário da
 * identidade visual, ou participante de uma Mesa onde o personagem está
 * vinculado (leitura via `sessionId`, caminho do futuro renderizador).
 */
import { errorResponse, ok, readJson, tokenFrom } from "@/lib/mesa/http";
import { createCharacterVisualService } from "@/lib/characterVisual/visualInfrastructure";
import type { VisualSlot } from "@/lib/characterVisual/characterVisualServer";

export const runtime = "nodejs";

function parseSlotBody(body: Record<string, unknown>): VisualSlot {
  if (body.slot === "combat_state") return { kind: "combat_state", state: body.state } as VisualSlot;
  return { kind: "portrait" };
}

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const service = await createCharacterVisualService();
    const identity = await service.loadIdentity(
      url.searchParams.get("characterId"),
      tokenFrom(request),
      url.searchParams.get("sessionId") ?? undefined,
      url.searchParams.get("name") ?? undefined,
    );
    return ok({ identity });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const body = await readJson(request);
    const service = await createCharacterVisualService();
    if ("displayName" in body) {
      const identity = await service.saveDisplayName({
        characterId: body.characterId,
        token: tokenFrom(request),
        displayName: body.displayName,
      });
      return ok({ identity });
    }
    const identity = await service.saveImage({
      characterId: body.characterId,
      token: tokenFrom(request),
      slot: parseSlotBody(body),
      imageDataUrl: body.imageDataUrl,
    });
    return ok({ identity });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const body = await readJson(request);
    const service = await createCharacterVisualService();
    const identity = await service.removeImage({
      characterId: body.characterId,
      token: tokenFrom(request),
      slot: parseSlotBody(body),
    });
    return ok({ identity });
  } catch (error) {
    return errorResponse(error);
  }
}
