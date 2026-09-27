/**
 * GET /api/mesa/[id]/battles — histórico de PARTIDAS da mesa (somente GM).
 *
 * Devolve as linhas de `mesa_battles` (mais recente primeiro), que sustentam
 * duas coisas da tela de ⚔️ Encontros:
 *   • o card "Histórico de partidas" (quem entrou com que vida, quem morreu);
 *   • a reconciliação do vínculo de cada encontro — concluído, em andamento ou
 *     lançado noutro separador.
 *
 * Sem a migração 20260927000001 o servidor responde `503 migration_pending`
 * (a luta em si continua funcionando normalmente).
 */
import { errorResponse, ok, tokenFrom } from "@/lib/mesa/http";
import { listBattles } from "@/lib/mesa/store";

export const runtime = "nodejs";

interface Context {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    const battles = await listBattles({ sessionId: id, token: tokenFrom(request) });
    return ok({ battles });
  } catch (error) {
    return errorResponse(error);
  }
}
