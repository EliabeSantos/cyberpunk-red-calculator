/**
 * Tipos da Mesa/Sessão online — compartilhados entre rotas API e componentes.
 *
 * Hierarquia: USUÁRIO → SESSÃO → PARTICIPANTES → PERSONAGENS → ESTADO DE COMBATE.
 */

export type SessionStatus = "lobby" | "active" | "finished";
export type ParticipantRole = "gm" | "player";
export type CombatStatus = "active" | "finished";
export type CombatantKind = "character" | "enemy";

export interface MesaSession {
  id: string;
  name: string;
  gmId: string | null;
  status: SessionStatus;
  joinCode: string;
  createdAt: string;
}

export interface MesaParticipant {
  id: string;
  sessionId: string;
  displayName: string;
  /** Referência à ficha — a ficha em si continua existindo fora da mesa. */
  characterId: string | null;
  role: ParticipantRole;
  connectedAt: string;
}

export interface MesaCombatant {
  id: string;
  combatId: string;
  sessionId: string;
  kind: CombatantKind;
  characterId: string | null;
  participantId: string | null;
  name: string;
  initiative: number | null;
  initiativeDetail: { expression?: string; refBonus?: number; total?: number } | null;
  actionsMax: number;
  actionsRemaining: number;
  movementMax: number;
  movementRemaining: number;
  hpCurrent: number;
  hpMax: number;
  isDead: boolean;
  conditions: string[];
  sortOrder: number;
}

export interface MesaEvent {
  at: string;
  /**
   * `roll` = dado rolado na ficha de um participante (entra também na lista de
   * rolagens visível no painel, sem precisar abrir o registro completo).
   */
  kind:
    | "combat_started"
    | "combat_finished"
    | "initiative"
    | "action"
    | "turn"
    | "round"
    | "enemy"
    | "join"
    | "roll";
  text: string;
}

export interface MesaCombat {
  id: string;
  sessionId: string;
  status: CombatStatus;
  round: number;
  activeCombatantId: string | null;
  turnStartedAt: string | null;
  initiativeStarted: boolean;
  eventLog: MesaEvent[];
  createdAt: string;
}

/** Estado completo devolvido ao cliente (é o que o Realtime publica). */
export interface MesaState {
  session: MesaSession;
  participants: MesaParticipant[];
  combat: MesaCombat | null;
  combatants: MesaCombatant[];
  /** Quem está perguntando — identificado pelo playerToken enviado na requisição. */
  viewer: {
    participantId: string | null;
    role: ParticipantRole | null;
    displayName: string | null;
  };
}

export function isSessionStatus(value: unknown): value is SessionStatus {
  return value === "lobby" || value === "active" || value === "finished";
}
