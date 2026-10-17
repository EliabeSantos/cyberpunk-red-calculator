/**
 * Entrega do binário de um asset da identidade visual (SOMENTE servidor).
 *
 * A URL é assinada (HMAC + expiração) porque tags `<img>` não enviam o
 * header `x-mesa-token`; a assinatura é derivada do `owner_token` e verificada
 * aqui em tempo constante. Sem assinatura válida não há bytes — e o bucket /
 * diretório de arquivos nunca é exposto diretamente.
 */
import { errorResponse } from "@/lib/mesa/http";
import { createCharacterVisualService } from "@/lib/characterVisual/visualInfrastructure";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ assetId: string }> }): Promise<Response> {
  try {
    const { assetId } = await context.params;
    const url = new URL(request.url);
    const service = await createCharacterVisualService();
    const asset = await service.readAsset(assetId, url.searchParams.get("e"), url.searchParams.get("s"));
    return new Response(new Uint8Array(asset.bytes), {
      headers: {
        "content-type": asset.mimeType,
        // Privado: cada URL tem vida limitada; o navegador não deve arquivar.
        "cache-control": "private, max-age=3600",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
