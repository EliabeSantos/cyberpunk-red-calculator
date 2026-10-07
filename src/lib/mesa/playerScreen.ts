/**
 * F1.12.3 — lógica PURA da tela do Player (`/mesa/[id]`).
 *
 * Nada aqui fala com rede ou banco: só deriva APRESENTAÇÃO a partir do estado
 * autoritativo da Mesa que `useMesaState` entrega. Manter isto fora dos
 * componentes (a) torna a lógica testável sem DOM e (b) garante que a tela
 * NUNCA comece a manter estado paralelo de HP/turno/ação — tudo é derivado do
 * snapshot do servidor, igual ao Realtime/polling/Character Sync.
 *
 * As faixas de "ferido/grave" daqui são SOMENTE VISUAIS: nenhuma regra de
 * Cyberpunk RED (Death Save, Mortal Wound, cura) é decidida por elas.
 */
import { sortByInitiative } from "@/lib/combatEngine";
import type { MesaCombatant, MesaState } from "@/lib/mesa/types";

/** `live` = ação disponível · `wait` = na fila · `alert` = bloqueio/novidade grave. */
export type PlayerTurnTone = "live" | "wait" | "alert";

export type PlayerTurnKind =
  | "session_finished"
  | "combat_idle"
  | "combat_finished"
  | "initiative_pending"
  | "your_turn"
  | "your_turn_no_actions"
  | "defeated"
  | "waiting";

export interface PlayerTurnStatus {
  kind: PlayerTurnKind;
  /** Rótulo grande — é o que responde "é meu turno?". */
  label: string;
  /** Texto de apoio: quem está ativo e o que fazer agora. */
  detail: string;
  tone: PlayerTurnTone;
  myTurn: boolean;
}

/** Combatente por id, sem efeito colateral. */
export function findCombatant(state: MesaState, combatantId: string | null): MesaCombatant | null {
  if (!combatantId) return null;
  return state.combatants.find((combatant) => combatant.id === combatantId) ?? null;
}

/**
 * Elenco na ORDEM de iniciativa — a mesma `sortByInitiative` do Combat Engine
 * (maior primeiro, `sortOrder` como desempate). Nenhuma regra nova de
 * ordenação é inventada aqui.
 */
export function rosterInInitiativeOrder(state: MesaState): MesaCombatant[] {
  return sortByInitiative(state.combatants);
}

/**
 * Combatente que este Player COMANDA: o primeiro ligado ao `participantId` do
 * navegador. Personagens são o único `kind` que pode ser de um jogador.
 */
export function myCombatant(state: MesaState): MesaCombatant | null {
  if (!state.viewer.participantId) return null;
  return (
    state.combatants.find(
      (combatant) =>
        combatant.kind === "character" && combatant.participantId === state.viewer.participantId,
    ) ?? null
  );
}

/** Alvo válido para ataque: inimigo vivo. (O servidor revalida — isto é só UI.) */
export function attackTargets(state: MesaState): MesaCombatant[] {
  return state.combatants.filter((combatant) => combatant.kind === "enemy" && !combatant.isDead);
}

/** Elegibilidade visual do clique no mapa; o gateway sempre revalida o alvo. */
export function tacticalTargetSelectable(
  state: MesaState,
  combatant: MesaCombatant,
  controlledCombatantId: string | null = null,
): boolean {
  if (combatant.isDead) return false;
  if (state.viewer.role === "gm") return combatant.kind === "character" && combatant.id !== controlledCombatantId;
  return combatant.kind === "enemy" && combatant.participantId !== state.viewer.participantId;
}

/**
 * Faixa de status que a tela desenha no topo. A ordem das verificações é
 * proposital: sessão encerrada > combate parado > iniciativa pendente >
 * derrotado > meu turno > turno de outro.
 */
export function deriveTurnStatus(state: MesaState, me: MesaCombatant | null): PlayerTurnStatus {
  if (state.session.status === "finished") {
    return {
      kind: "session_finished",
      label: "MESA ENCERRADA",
      detail: "O Mestre encerrou a sessão. O registro abaixo continua disponível.",
      tone: "alert",
      myTurn: false,
    };
  }

  const combat = state.combat;
  if (!combat || combat.status !== "active") {
    return combat?.status === "finished"
      ? {
          kind: "combat_finished",
          label: "COMBATE ENCERRADO",
          detail: "Aguardando o Mestre montar o próximo encontro.",
          tone: "wait",
          myTurn: false,
        }
      : {
          kind: "combat_idle",
          label: "AGUARDANDO O COMBATE",
          detail: "O Mestre ainda não iniciou o combate nesta Mesa.",
          tone: "wait",
          myTurn: false,
        };
  }

  if (!combat.initiativeStarted) {
    return {
      kind: "initiative_pending",
      label: "AGUARDANDO INICIATIVA",
      detail: "O Mestre ainda não rolou a iniciativa. O combate começa em seguida.",
      tone: "wait",
      myTurn: false,
    };
  }

  if (!me) {
    return {
      kind: "waiting",
      label: "SEM PERSONAGEM",
      detail: "Vincule uma ficha abaixo para entrar na ordem de iniciativa.",
      tone: "wait",
      myTurn: false,
    };
  }

  if (me.isDead) {
    return {
      kind: "defeated",
      label: "SEU PERSONAGEM ESTÁ DERROTADO",
      detail: "Ele não age mais nesta luta — acompanhe o turno dos outros na lista.",
      tone: "alert",
      myTurn: false,
    };
  }

  const active = findCombatant(state, combat.activeCombatantId);
  const myTurn = Boolean(active && active.id === me.id);

  if (myTurn && me.actionsRemaining <= 0) {
    return {
      kind: "your_turn_no_actions",
      label: "SEM ACTIONS RESTANTES",
      detail: "Finalize o turno para passar a vez ao próximo combatente.",
      tone: "wait",
      myTurn: true,
    };
  }

  if (myTurn) {
    return {
      kind: "your_turn",
      label: "É O SEU TURNO",
      detail: `${me.actionsRemaining}/${me.actionsMax} Actions · ${me.movementRemaining} m de movimento disponíveis.`,
      tone: "live",
      myTurn: true,
    };
  }

  return {
    kind: "waiting",
    label: "AGUARDANDO O TURNO",
    detail: active ? `Turno de ${active.name}.` : "Aguardando o Mestre definir o combatente ativo.",
    tone: "wait",
    myTurn: false,
  };
}

/**
 * Faixa visual do HP — SOMENTE apresentação (cor/rotulo). Nenhuma regra do
 * jogo lê isto: HP ≤ 0, morte e Death Save continuam sendo do servidor.
 */
export type HpCondition = "dead" | "critical" | "wounded" | "ok";

export function hpCondition(combatant: MesaCombatant | null): HpCondition {
  if (!combatant) return "ok";
  if (combatant.isDead) return "dead";
  if (combatant.hpCurrent <= 0) return "critical";
  if (combatant.hpMax > 0) {
    const ratio = combatant.hpCurrent / combatant.hpMax;
    if (ratio <= 0.25) return "critical";
    if (ratio <= 0.5) return "wounded";
  }
  return "ok";
}

/** Percentual inteiro de HP para a barra (0–100), sem nunca sair do intervalo. */
export function hpPercent(combatant: MesaCombatant | null): number {
  if (!combatant || combatant.hpMax <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((combatant.hpCurrent / combatant.hpMax) * 100)));
}
