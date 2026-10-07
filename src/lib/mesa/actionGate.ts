/**
 * F1.12.3 — ponte entre `MesaState`/`MesaCombatant` e o `resolveAction` do
 * Combat Engine.
 *
 * O painel de combate da Mesa (dock) e a tela do Player (`/mesa/[id]`) precisam
 * responder a MESMA pergunta: "este botão pode ser clicado?". Sem este módulo
 * cada tela reescreveria o mapeamento → duplicação de lógica de autorização.
 *
 * Importante: isto só DESABILITA botões. Quem valida de verdade é a rota
 * `/api/mesa/[id]/combat/action` no servidor — nenhuma regra mora aqui.
 */
import { resolveAction, type CombatActionType } from "@/lib/combatEngine";
import { denialMessage } from "@/lib/mesa/messages";
import type { MesaCombatant, MesaState } from "@/lib/mesa/types";

export interface MesaActionGate {
  ok: boolean;
  /** Código de recusa do Engine (`not_your_turn`, `insufficient_actions`, ...). */
  reason: string | null;
  /** Texto pronto para o `title`/`hint` do botão. Vazio quando `ok`. */
  message: string;
}

/**
 * Avalia UMA ação de um combatente contra o estado atual da Mesa.
 * Reproduz exatamente o que o servidor vai decidir, usando a MESMA função pura.
 */
export function evaluateMesaAction(input: {
  state: MesaState;
  combatant: MesaCombatant;
  actionType: CombatActionType;
  /** Só relevante para `move`; ausente/0 = mesma recusa (`invalid_action`). */
  meters?: number;
}): MesaActionGate {
  const { state, combatant, actionType } = input;
  const result = resolveAction({
    combatStatus: state.combat?.status ?? null,
    initiativeStarted: state.combat?.initiativeStarted ?? false,
    activeCombatantId: state.combat?.activeCombatantId ?? null,
    actorRole: state.viewer.role ?? "player",
    actorOwnsCombatant: combatant.participantId === state.viewer.participantId,
    combatant: {
      id: combatant.id,
      isDead: combatant.isDead,
      actionsMax: combatant.actionsMax,
      actionsRemaining: combatant.actionsRemaining,
      movementMax: combatant.movementMax,
      movementRemaining: combatant.movementRemaining,
      unconsciousUntilRound: Math.max(
        0,
        ...combatant.criticalInjuries
          .map((injury) => injury.unconsciousUntilRound ?? 0),
      ) || undefined,
    },
    actionType,
    meters: input.meters ?? 0,
    currentRound: state.combat?.round,
  });

  return result.ok
    ? { ok: true, reason: null, message: "" }
    : { ok: false, reason: result.reason, message: denialMessage(result.reason) };
}
