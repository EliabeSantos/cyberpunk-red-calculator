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
 * vinculado (leitura via `sessionId`, caminho do renderizador).
 *
 * Quando o corpo traz `sessionId`, PUT/DELETE são o PUSH de sincronização do
 * dono para o host de uma Mesa em outra origem: além da posse, o gate de
 * ESCRITA exige o vínculo do participante com este personagem.
 *
 * CORS: o host da Mesa é outra origem para os clientes remotos e o
 * `x-mesa-token` força preflight. As cabeçalhas vivem AQUI (e não no
 * `src/proxy.ts`) porque o proxy do Next bufferiza o corpo até
 * `proxyClientMaxBodySize` (10 MB) — uploads de imagem em base64 passariam desse
 * teto e seriam truncados silenciosamente. Imagens não passam pelo proxy.
 */
import { errorResponse, ok, readJson, tokenFrom } from "@/lib/mesa/http";
import { createCharacterVisualService } from "@/lib/characterVisual/visualInfrastructure";
import type { VisualSlot } from "@/lib/characterVisual/characterVisualServer";

export const runtime = "nodejs";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-mesa-token",
  "Access-Control-Max-Age": "600",
};

function withCors(response: Response): Response {
  for (const [key, value] of Object.entries(CORS_HEADERS)) response.headers.set(key, value);
  return response;
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

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
    return withCors(ok({ identity }));
  } catch (error) {
    return withCors(errorResponse(error));
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
        sessionId: body.sessionId,
      });
      return withCors(ok({ identity }));
    }
    const identity = await service.saveImage({
      characterId: body.characterId,
      token: tokenFrom(request),
      slot: parseSlotBody(body),
      imageDataUrl: body.imageDataUrl,
      sessionId: body.sessionId,
    });
    return withCors(ok({ identity }));
  } catch (error) {
    return withCors(errorResponse(error));
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
      sessionId: body.sessionId,
    });
    return withCors(ok({ identity }));
  } catch (error) {
    return withCors(errorResponse(error));
  }
}
