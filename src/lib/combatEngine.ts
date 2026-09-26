/**
 * Combat Engine — regras de combate compartilhadas entre MODO LOCAL e MODO ONLINE.
 *
 * Este módulo é a fonte única de:
 *   • economia de ações (2 por turno)  • ordem de iniciativa
 *   • virada de turno / rodada         • condições para agir
 *
 * A MESMA função roda nos dois lugares:
 *   - FRONTEND: desabilita botões quando não há ações suficientes (feedback).
 *   - BACKEND:  valida de verdade e só então grava. O servidor nunca confia no
 *               estado enviado pelo navegador — ele busca o estado atual e chama
 *               `resolveAction` com o que está no banco.
 *
 * Nada aqui depende de React, DOM, localStorage ou rede: é puro, como
 * `src/lib/attacks.ts`, `src/lib/damage.ts` e `src/lib/initiative.ts`.
 * O resultado do ataque/dano/lesão continua saindo desses módulos já existentes
 * (Entrega 3 os acopla aqui); este arquivo não duplica nenhuma regra deles.
 */

import { rollDice } from "@/lib/dice";

/** Cyberpunk RED nesta aplicação: 2 Actions por turno. */
export const ACTIONS_PER_TURN = 2;
/**
 * Orçamento de movimento de FALLBACK, em metros — usado só quando o
 * combatente não tem STAT MOVE conhecido (inimigo importado sem ficha).
 * É exatamente `movementMetersPerTurn(3)`, para o default do banco (6)
 * continuar coerente com o cálculo.
 */
export const MOVEMENT_PER_TURN = 6;
/** Metros por ponto de MOVE: MOVE 10 → 20 metros por turno. */
export const METERS_PER_MOVE = 2;

/**
 * Orçamento de movimento de um turno para um combatente com STAT MOVE.
 *
 * A regra da mesa online: você se movimenta **MOVE × 2 metros** por turno
 * (ex.: MOVE 10 → 20 m) e gasta desse orçamento quanto quiser — mover não
 * custa Action, tem orçamento próprio. MOVE 0 (paralisia/lesão grave) →
 * 0 metros: não pode se mover.
 *
 * Pura, sem DOM/rede: roda igual no navegador (feedback) e no servidor
 * (validação real), como todo o resto deste motor.
 */
export function movementMetersPerTurn(moveStat: number): number {
  const move = Number.isFinite(moveStat) ? Math.floor(moveStat) : 0;
  return Math.max(0, move) * METERS_PER_MOVE;
}

/** Ações aceitas pelo motor. */
export type CombatActionType = "attack" | "move" | "item" | "other";

/**
 * Custo de cada ação em "actionsRemaining".
 *
 * `move` custa 0 ações: o movimento tem orçamento próprio (**MOVE × 2 metros**
 * por turno, `movementMetersPerTurn`), como mostra o painel
 * (Ações 2/2 · Movimento 14/20 m). Ataque e item custam 1,
 * então dois ataques esgotam o turno (2 → 1 → 0).
 */
export const ACTION_COSTS: Record<CombatActionType, number> = {
  attack: 1,
  item: 1,
  other: 1,
  move: 0,
};

export function isCombatActionType(value: unknown): value is CombatActionType {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ACTION_COSTS, value);
}

export function getActionCost(type: CombatActionType): number {
  return ACTION_COSTS[type];
}

/** Motivos de recusa — o mesmo texto chega ao cliente para desabilitar a UI. */
export type ActionDenialReason =
  | "combat_not_active"
  | "combat_not_started"
  | "combat_finished"
  | "initiative_not_started"
  | "not_your_turn"
  | "not_allowed"
  | "insufficient_actions"
  | "invalid_action"
  | "movement_exhausted"
  | "combatant_defeated";

export type ActionResult =
  | { ok: true; cost: number }
  | { ok: false; reason: ActionDenialReason };

/** Orçamento de turno de um combatente. */
export interface ActionEconomy {
  actionsMax: number;
  actionsRemaining: number;
  movementMax: number;
  movementRemaining: number;
}

export interface CombatantView extends ActionEconomy {
  id: string;
  isDead: boolean;
}

/** Tudo que a validação precisa saber — o servidor monta isto a partir do banco. */
export interface ActionRequest {
  combatStatus: "active" | "finished" | null;
  initiativeStarted: boolean;
  activeCombatantId: string | null;
  /** Quem fez a requisição, conforme o participante autenticado. */
  actorRole: "gm" | "player";
  /** O combatente pertence ao participante que pediu? (GM pode comandar qualquer um.) */
  actorOwnsCombatant: boolean;
  combatant: CombatantView;
  actionType: unknown;
  /** Metros desejados, usado apenas quando `actionType === "move"`. */
  meters?: number;
}

/**
 * Valida UMA ação. Não altera nada: devolve se pode e qual o custo.
 * É a checagem real — roda no servidor; o cliente usa a mesma função só para
 * desabilitar botões antes do clique.
 */
export function resolveAction(request: ActionRequest): ActionResult {
  const { combatant } = request;

  if (request.combatStatus === null) return { ok: false, reason: "combat_not_started" };
  if (request.combatStatus === "finished") return { ok: false, reason: "combat_finished" };
  if (!request.initiativeStarted) return { ok: false, reason: "initiative_not_started" };

  if (!isCombatActionType(request.actionType)) return { ok: false, reason: "invalid_action" };

  // GM comanda qualquer combatente; jogador só o próprio.
  if (request.actorRole !== "gm" && !request.actorOwnsCombatant) {
    return { ok: false, reason: "not_allowed" };
  }

  if (combatant.isDead) return { ok: false, reason: "combatant_defeated" };

  // Só age no próprio turno (o GM pode agir por qualquer combatente, inclusive fora de turno).
  if (
    request.actorRole !== "gm" &&
    request.combatant.id !== request.activeCombatantId
  ) {
    return { ok: false, reason: "not_your_turn" };
  }

  const actionType = request.actionType;

  if (actionType === "move") {
    const meters = Math.max(0, Math.floor(request.meters ?? 0));
    if (meters <= 0) return { ok: false, reason: "invalid_action" };
    if (combatant.movementRemaining < meters) {
      return { ok: false, reason: "movement_exhausted" };
    }
    return { ok: true, cost: 0 };
  }

  const cost = getActionCost(actionType);
  if (combatant.actionsRemaining < cost) {
    return { ok: false, reason: "insufficient_actions" };
  }
  return { ok: true, cost };
}

/**
 * Aplica o resultado de `resolveAction` sobre o orçamento.
 * Devolve o NOVO orçamento (nunca muta o recebido).
 */
export function applyAction(
  economy: ActionEconomy,
  actionType: CombatActionType,
  meters = 0,
): ActionEconomy {
  const cost = getActionCost(actionType);
  if (actionType === "move") {
    return { ...economy, movementRemaining: Math.max(0, economy.movementRemaining - Math.max(0, Math.floor(meters))) };
  }
  return { ...economy, actionsRemaining: Math.max(0, economy.actionsRemaining - cost) };
}

/** Início de turno: 2 ações e movimento cheios de volta. */
export function beginTurn(economy: ActionEconomy): ActionEconomy {
  return {
    ...economy,
    actionsRemaining: economy.actionsMax,
    movementRemaining: economy.movementMax,
  };
}

// ---------------------------------------------------------------------------
// Iniciativa / ordem de turno
// ---------------------------------------------------------------------------

/** Combatente com o que a ordenação precisa. `initiative` null = ainda não rolou. */
export interface OrderedCombatant {
  id: string;
  initiative: number | null;
  isDead: boolean;
  sortOrder: number;
}

/**
 * Ordena por iniciativa decrescente. Empates caem por `sortOrder` (posição de
 * criação) para a ordem ser estável entre clientes — nada de "ordem diferente
 * em cada navegador".
 */
export function sortByInitiative<T extends OrderedCombatant>(combatants: readonly T[]): T[] {
  return [...combatants].sort((a, b) => {
    const initiativeA = a.initiative ?? Number.NEGATIVE_INFINITY;
    const initiativeB = b.initiative ?? Number.NEGATIVE_INFINITY;
    if (initiativeA !== initiativeB) return initiativeB - initiativeA;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export type TurnAdvance =
  | { kind: "turn"; activeCombatantId: string; round: number }
  | { kind: "round"; activeCombatantId: string; round: number }
  | { kind: "finished" };

/**
 * Avança para o próximo combatente vivo. Ao fim da lista, sobe a rodada e
 * recomeça do maior iniciativa. Sem ninguém vivo, o combate termina.
 */
export function advanceTurn(
  order: readonly string[],
  activeCombatantId: string | null,
  round: number,
  isAlive: (id: string) => boolean,
): TurnAdvance {
  const livingOrder = order.filter(isAlive);
  if (livingOrder.length === 0) return { kind: "finished" };

  const currentIndex = activeCombatantId ? livingOrder.indexOf(activeCombatantId) : -1;
  const nextIndex = currentIndex + 1;

  if (nextIndex < livingOrder.length) {
    if (currentIndex === -1) {
      return { kind: "turn", activeCombatantId: livingOrder[0], round };
    }
    return { kind: "turn", activeCombatantId: livingOrder[nextIndex], round };
  }

  // Fim da lista → nova rodada, volta ao topo.
  return { kind: "round", activeCombatantId: livingOrder[0], round: round + 1 };
}

/** `true` quando este combatente é o que está de turno agora. */
export function isTurnOf(combatantId: string, activeCombatantId: string | null): boolean {
  return combatantId !== null && combatantId === activeCombatantId;
}

/**
 * Iniciativa de inimigo/NPC: REF + 1d10 explodindo.
 * Mantém a mesma fórmula da ficha (base REF) sem depender de uma ficha de jogador.
 */
export function rollEnemyInitiative(ref: number): number {
  const dice = rollDice("1d10");
  let total = ref + dice.rolls[0];
  if (dice.rolls[0] === 10) total += rollDice("1d10").rolls[0];
  if (dice.rolls[0] === 1) total -= rollDice("1d10").rolls[0];
  return total;
}
