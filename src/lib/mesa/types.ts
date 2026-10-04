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

/**
 * Suprimentos de combate espelhados na mesa (`mesa_combatants.supplies`).
 *
 * Para inimigos, a tela de Encontros continua sendo a dona da mochila. Para
 * personagens, o conteúdo é materializado ao iniciar o combate e a Mesa passa
 * a ser a autoridade durante aquela batalha.
 */
export interface MesaSupplies {
  /** Arma cujo pente está representado por ammo/magazine. */
  weaponId?: string;
  /** Balas no pente agora; ausente quando a arma não tem pente. */
  ammo?: number;
  /** Capacidade do pente. */
  magazine?: number;
  /** Reserva na mochila: munição para recarregar e itens de cura. */
  inventory?: Array<{ item: string; quantity: number }>;
}

export interface MesaCombatant {
  id: string;
  combatId: string;
  sessionId: string;
  kind: CombatantKind;
  characterId: string | null;
  participantId: string | null;
  name: string;
  /**
   * Chave do participante do encontro que originou este INIMIGO
   * (`mesa_combatants.source_key`). É por aqui que o HP aplicado na tela de
   * Encontros chega à linha certa; `null` em personagens e em inimigos
   * criados sem chave.
   */
  sourceKey: string | null;
  /** `null` em personagens e em inimigos sem mochila (`mesa_combatants.supplies`). */
  supplies: MesaSupplies | null;
  /** Munição atual por `weaponId`, mantida pelo servidor. */
  ammoByWeapon?: Record<string, number> | null;
  initiative: number | null;
  /**
   * Como a iniciativa foi calculada. `bonus` é o bônus de implantes do inimigo
   * (`1d10 + refBonus + bonus`) — presente só quando ≠ 0.
   */
  initiativeDetail: { expression?: string; refBonus?: number; total?: number; bonus?: number } | null;
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

export type BattleStatus = "active" | "completed";

/**
 * Linha do HISTÓRICO de uma partida (`mesa_battles.combatants`).
 *
 * Nasce no início do combate com a vida de ENTRADA e é enriquecida quando a
 * partida é fechada com a vida FINAL — por isso `hpEnd` é `null` enquanto a
 * luta roda.
 */
export interface MesaBattleCombatant {
  id: string;
  kind: CombatantKind;
  name: string;
  hpStart: number;
  hpMax: number;
  /** `null` enquanto o combate está ativo ou quando saiu antes do fim. */
  hpEnd: number | null;
  isDead: boolean;
  /** Saiu da luta (removido pelo Mestre) antes de a partida ser fechada. */
  removed: boolean;
  initiative: number | null;
  sourceKey: string | null;
}

/**
 * Uma partida já registrada — é o que sustenta o "histórico de partidas" da
 * tela de Encontros e o bloqueio de encontro repetido (`encounterId`).
 */
export interface MesaBattle {
  id: string;
  sessionId: string;
  joinCode: string;
  /** `null` quando o combate foi lançado sem encontro (avulso). */
  encounterId: string | null;
  encounterName: string;
  status: BattleStatus;
  startedAt: string;
  endedAt: string | null;
  finalRound: number | null;
  combatants: MesaBattleCombatant[];
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
