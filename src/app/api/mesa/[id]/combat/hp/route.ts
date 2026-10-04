/**
 * POST /api/mesa/[id]/combat/hp — espelho de VIDA (HP) da ORIGEM para a mesa.
 *
 * Body:
 *   { hp, hpMax?, isDead? }    → o combatente de QUEM pediu (ficha do jogador);
 *   { key, hp, supplies? }     → inimigo pelo `source_key` do encontro (só Mestre).
 *                                `supplies` espelha a mochila (pente + reserva).
 *   hpBefore? (F1.7.1)         → HP que a origem acreditava antes desta mudança:
 *                                quando presente, `hp_current`/`is_dead` só entram
 *                                se a linha ainda estiver nesse valor — um push
 *                                atrasado não sobrescreve um resultado mais novo
 *                                do Combat Engine (caminho B em /combat/damage).
 *
 * Um sentindo só: a ficha do jogador e o encontro do Mestre mandam; a mesa só
 * exibe (decisão de 27/09/2026). Quem chama é fire-and-forget, igual ao espelho
 * de rolagens — sem combate ativo ou sem linha correspondente a rota devolve
 * `updated: false` e nada muda.
 */
import { errorResponse, ok, readJson, tokenFrom } from "@/lib/mesa/http";
import { syncCombatHp } from "@/lib/mesa/store";
import { publishMesaState } from "@/lib/mesa/realtimeServer";

export const runtime = "nodejs";

interface Context {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    const body = await readJson(request);
    const result = await syncCombatHp({
      sessionId: id,
      token: tokenFrom(request),
      hp: body.hp,
      hpMax: body.hpMax,
      isDead: body.isDead,
      key: body.key,
      supplies: body.supplies,
      hpBefore: body.hpBefore,
    });
    if (result.updated) await publishMesaState(id);
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
