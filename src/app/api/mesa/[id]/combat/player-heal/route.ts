/**
 * POST /api/mesa/[id]/combat/player-heal — F1.12.2: **Player Healing Gateway**.
 *
 * O caminho dedicado de CURA de um PERSONAGEM durante uma Mesa com combate
 * ativo. Antes desta etapa o único jeito de subir o HP de um Player era o antigo
 * `+` do Mestre (`PATCH /combatants { hpCurrent }`) — client-authoritative, e
 * fechado pela F1.12.1 junto com o caminho de dano.
 *
 *     intenção do cliente (targetCombatantId + amount)
 *       → applyPlayerHealing (validação server-side + min(atual + amount, máx))
 *       → commit transacional em mesa_combatants (APENAS hp_current + evento)
 *       → publishMesaState → Realtime → characterSync → ficha
 *
 * Body (SOMENTE intenção — `hpAfter`/`finalHp` são proibidos):
 *   {
 *     resolutionId,          // idempotência durável (obrigatório)
 *     targetCombatantId,     // linha de mesa_combatants, kind = "character"
 *     amount,                // inteiro > 0 — o servidor calcula o HP final
 *     sourceType?,           // rótulo curto (vira texto de evento)
 *     sourceContext?         // texto curto de cena (só vira evento)
 *   }
 *
 * Recusas: 410 sessão encerrada · 409 combate inativo · 403 não-GM ·
 * 404 alvo inexistente · 400 alvo não-Player / amount inválido / contexto
 * inválido / autoridade de resultado do cliente.
 */
import { errorResponse, ok, readJson, tokenFrom } from "@/lib/mesa/http";
import { applyPlayerHealing } from "@/lib/mesa/store";
import { publishMesaState } from "@/lib/mesa/realtimeServer";

export const runtime = "nodejs";

interface Context {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    const body = await readJson(request);
    const outcome = await applyPlayerHealing({ sessionId: id, token: tokenFrom(request), body });
    // HP no máximo → `updated: false`: nada mudou, então nada é publicado.
    if (outcome.updated) await publishMesaState(id);
    return ok({ ...outcome });
  } catch (error) {
    return errorResponse(error);
  }
}
