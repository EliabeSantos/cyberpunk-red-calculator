/**
 * POST /api/mesa/[id]/combat/player-damage — F1.12.1: **Player Damage Gateway**.
 *
 * O caminho dedicado de dano EXTERNO (ambiental, de cena, ajuste de Mestre)
 * sobre um PERSONAGEM durante uma Mesa com combate ativo. Antes desta etapa
 * não existia endpoint server-side para essa fonte e o único jeito de mexer no
 * HP de um Player era `PATCH /combatants { hpCurrent }` — client-authoritative.
 *
 *     intenção do cliente
 *       → applyPlayerDamage (validação + Damage Engine existente)
 *       → commit transacional em mesa_combatants (HP/Armor/CI/is_dead + evento)
 *       → publishMesaState → Realtime → characterSync → ficha
 *
 * Body (SOMENTE intenção — resultado é proibido, Fase 9):
 *   {
 *     resolutionId,          // idempotência durável (obrigatório)
 *     targetCombatantId,     // linha de mesa_combatants, kind = "character"
 *     hpBefore,              // pré-condição/CAS verificada no servidor
 *     amount,                // dano bruto a resolver no motor
 *     hitLocation?,          // head | body | leg | ...
 *     damageRolls?,          // dados individuais (gatilho de Critical Injury)
 *     ignoreArmor?,          // variante legada "ignore"
 *     sourceType?,           // ex.: "explosion" | "fall" | "chooh2" | "trap"
 *     sourceContext?         // texto curto de cena (só vira evento)
 *   }
 *
 * Recusado em 400 `client_authority_forbidden`: `finalHp`, `hp`, `hpCurrent`,
 * `finalArmor`, `armor`, `criticalInjuries`, `isDead`, `deathSave`, ...
 * (o servidor nunca lê nenhum deles como autoridade).
 */
import { errorResponse, ok, readJson, tokenFrom } from "@/lib/mesa/http";
import { applyPlayerDamage } from "@/lib/mesa/store";
import { publishMesaState } from "@/lib/mesa/realtimeServer";

export const runtime = "nodejs";

interface Context {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    const body = await readJson(request);
    const outcome = await applyPlayerDamage({ sessionId: id, token: tokenFrom(request), body });
    if (outcome.updated) await publishMesaState(id);
    return ok({ ...outcome });
  } catch (error) {
    return errorResponse(error);
  }
}
