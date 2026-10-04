/**
 * POST /api/mesa/[id]/combat/damage — F1.7.1: dano de INIMIGO resolvido pelo
 * Combat Engine (o caminho B da Decisão 2).
 *
 * Este é o primeiro ponto de produção que executa `engine.execute` de ponta a
 * ponta; o espelho caminho A (`POST /combat/hp`, sincronização da ORIGEM)
 * continua existindo e intacto para cura/mochila/ficha — a separação das duas
 * escritas É o mecanismo que diferencia origem de resolução.
 *
 * Body (entradas da ORIGEM — o encontro é dono de armor/mochila):
 *   { key, amount, hpBefore, hitLocation?, ignoreArmor?, armor: {head,body}, bodySP? }
 *
 * O RESULTADO nunca vem do cliente: o servidor monta o snapshot da linha da
 * mesa (hp/is_dead autoridade), roda o motor com `serverRandom` e persiste o
 * patch VERBATIM do adapter. Respostas:
 *   • `200 {updated:true, hp, isDead}`  → resolução aplicada (ou nada a mudar);
 *   • `200 {updated:false, ...}`        → sem combate ativo / linha não achada;
 *   • `409 stale_hp|hp_conflict`        → retry de resolução já aplicada ou
 *                                          corrida perdida (nunca escrita dupla);
 *   • `400`                             → motor recusou / entrada inválida.
 */
import { errorResponse, ok, readJson, tokenFrom } from "@/lib/mesa/http";
import { resolveEnemyDamage } from "@/lib/mesa/store";
import { publishMesaState } from "@/lib/mesa/realtimeServer";

export const runtime = "nodejs";

interface Context {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    const body = await readJson(request);
    const result = await resolveEnemyDamage({
      sessionId: id,
      token: tokenFrom(request),
      key: body.key,
      amount: body.amount,
      hpBefore: body.hpBefore,
      hitLocation: body.hitLocation,
      ignoreArmor: body.ignoreArmor,
      armor: body.armor,
      bodySP: body.bodySP,
    });
    if (result.updated) await publishMesaState(id);
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
