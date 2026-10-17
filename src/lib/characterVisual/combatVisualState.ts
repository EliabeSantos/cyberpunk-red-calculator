/**
 * Controlador de estado VISUAL de combate (SOMENTE apresentação, módulo puro).
 *
 * Recebe os SINAIS REAIS que o sistema de Mesa já entrega ao cliente e
 * decide qual imagem de corpo inteiro cada combatente exibe:
 *
 * - snapshot autenticado (`MesaState.combatants`): `isDead` registrado pelas
 *   regras → DEFEATED (terminal); queda de `hpCurrent` → HIT; recarga de
 *   munição (`ammoByWeapon` subiu) → RELOAD. Nada é deduzido da aparência da
 *   interface: os campos vêm do banco após o commit do servidor;
 * - resultado confirmado de ação (resposta autenticada de `/combat/attack`,
 *   após `committed`): ataque à distância → SHOOT; corpo a corpo →
 *   MELEE_ATTACK; defesa `evasion` sem acerto → DODGE no alvo; dano
 *   confirmado no alvo → HIT.
 *
 * O que este módulo NÃO faz, de propósito:
 * - não é fonte de verdade mecânica: nunca altera PV, munição, condições ou
 *   permissões — o estado visual é descartável e não alimenta o Combat Engine;
 * - não infere morte: DEATH é `ruleGated` no catálogo e o snapshot do cliente
 *   não distingue "derrotado" de "morto" (`is_dead` é um único flag); a
 *   ativação de DEATH fica para uma etapa futura com sinal estruturado;
 * - não usa `AIM`: o sistema atual não tem ação/evento de mira (documentado
 *   como limitação; o estado permanece no catálogo para uso futuro).
 *
 * Política de prioridade e duração:
 * - terminal (DEFEATED) é persistente: nenhuma ação temporária o sobrescreve;
 * - temporários vencem por janela de exibição (duração por estado) e voltam
 *   ao IDLE quando expiram — timers aqui são SOMENTE de apresentação e nunca
 *   alteram o estado mecânico;
 * - efeito de prioridade menor é descartado enquanto uma janela de prioridade
 *   maior estiver ativa (HIT/DODGE > familiares de ataque > RELOAD);
 * - efeitos idênticos repetidos em sequência imediata são deduplicados;
 * - a ordem de registro é monotônica: um efeito nunca substitui outro mais
 *   recente por valor antigo (cada `report` recebe seq crescente).
 */

import {
  DEFAULT_COMBAT_VISUAL_STATE,
  type CombatVisualState,
} from "@/lib/characterVisual/visualStates";

/** Efeitos confirmados que o fluxo real consegue reportar hoje. */
export type CombatVisualEffect =
  | "attack_ranged"
  | "attack_melee"
  | "dodge"
  | "hit"
  | "reload"
  | "defeated";

/** Mapa efeito real → estado do catálogo (fonte única: o catálogo da Etapa 1). */
export const COMBAT_VISUAL_EFFECT_STATE: Readonly<Record<CombatVisualEffect, CombatVisualState>> = {
  attack_ranged: "SHOOT",
  attack_melee: "MELEE_ATTACK",
  dodge: "DODGE",
  hit: "HIT",
  reload: "RELOAD",
  defeated: "DEFEATED",
};

/** Prioridade de exibição: maior vence enquanto a janela estiver ativa. */
export const COMBAT_VISUAL_PRIORITY: Readonly<Record<CombatVisualState, number>> = {
  DEATH: 100,
  DEFEATED: 90,
  HIT: 70,
  DODGE: 60,
  SHOOT: 50,
  MELEE_ATTACK: 50,
  ATTACK: 45,
  AIM: 20,
  RELOAD: 30,
  IDLE: 0,
};

/**
 * Duração de exibição (APRESENTAÇÃO apenas). Estados terminais não expiram;
 * IDLE não é um estado "ativo" — é a ausência de estado temporário.
 */
export const COMBAT_VISUAL_DURATION_MS: Readonly<Record<CombatVisualState, number>> = {
  DEATH: Number.POSITIVE_INFINITY,
  DEFEATED: Number.POSITIVE_INFINITY,
  HIT: 1400,
  DODGE: 1300,
  SHOOT: 1600,
  MELEE_ATTACK: 1600,
  ATTACK: 1600,
  RELOAD: 1700,
  AIM: 0,
  IDLE: 0,
};

/** Janela de deduplicação: mesmo efeito para o mesmo combatente. */
export const COMBAT_VISUAL_DEDUPE_MS = 400;

export function isTerminalVisualState(state: CombatVisualState): boolean {
  return COMBAT_VISUAL_PRIORITY[state] >= COMBAT_VISUAL_PRIORITY.DEFEATED;
}

/** Combatente conforme entregue pelo snapshot de Mesa (só os campos lidos aqui). */
export interface CombatVisualSnapshotCombatant {
  id: string;
  isDead: boolean;
  hpCurrent: number;
  ammoByWeapon?: Record<string, number> | null;
}

interface ActiveVisual {
  state: CombatVisualState;
  seq: number;
  startedAt: number;
  expiresAt: number;
}

interface CombatantVisualRecord {
  terminal: ActiveVisual | null;
  latest: ActiveVisual | null;
  wasDead: boolean;
  previousHp: number | null;
  previousAmmo: Record<string, number> | null;
}

function newRecord(): CombatantVisualRecord {
  return { terminal: null, latest: null, wasDead: false, previousHp: null, previousAmmo: null };
}

export class CombatVisualStateController {
  private readonly now: () => number;
  private combatId: string | null = null;
  private seq = 0;
  private readonly records = new Map<string, CombatantVisualRecord>();

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  /** Troca de combate (ou fim do combate) zera os estados visuais. */
  reset(): void {
    this.combatId = null;
    this.records.clear();
  }

  /**
   * Consome um snapshot autenticado e deriva os efeitos estruturados:
   * derrota registrada (`isDead`), dano recebido (queda de HP) e recarga
   * (munição recarregada). É a fonte que funciona em TODOS os clientes,
   * inclusive os que não viram a ação acontecer.
   */
  recordSnapshot(combatId: string | null, combatants: readonly CombatVisualSnapshotCombatant[]): void {
    if (combatId !== this.combatId) {
      this.records.clear();
      this.combatId = combatId;
      if (combatId === null) return;
    }
    if (combatId === null) return;
    for (const combatant of combatants) {
      const record = this.record(combatant.id);
      if (combatant.isDead && !record.wasDead) this.report({ combatantId: combatant.id, effect: "defeated" });
      if (record.previousHp !== null && combatant.hpCurrent < record.previousHp) {
        this.report({ combatantId: combatant.id, effect: "hit" });
      }
      if (record.previousAmmo && combatant.ammoByWeapon) {
        const refilled = Object.entries(combatant.ammoByWeapon).some(
          ([weaponId, ammo]) => (record.previousAmmo?.[weaponId] ?? 0) < ammo,
        );
        if (refilled) this.report({ combatantId: combatant.id, effect: "reload" });
      }
      record.wasDead = combatant.isDead;
      record.previousHp = combatant.hpCurrent;
      record.previousAmmo = combatant.ammoByWeapon ? { ...combatant.ammoByWeapon } : null;
    }
  }

  /**
   * Registra um efeito confirmado. Devolve `true` quando o estado visual
   * exibido do combatente mudou — o chamador usa isso para evitar
   * re-renderizações redundantes.
   */
  report(input: { combatantId: string; effect: CombatVisualEffect }): boolean {
    const state = COMBAT_VISUAL_EFFECT_STATE[input.effect];
    const record = this.record(input.combatantId);
    const now = this.now();
    const terminal = isTerminalVisualState(state);

    if (record.terminal) {
      // Terminal só é substituído por outro terminal de prioridade maior
      // (ex.: DEATH sobre DEFEATED quando o sinal existir).
      if (!terminal || COMBAT_VISUAL_PRIORITY[state] <= COMBAT_VISUAL_PRIORITY[record.terminal.state]) {
        return false;
      }
      record.terminal = { state, seq: ++this.seq, startedAt: now, expiresAt: Number.POSITIVE_INFINITY };
      record.latest = null;
      return true;
    }

    const active = record.latest && now < record.latest.expiresAt ? record.latest : null;
    // Deduplicação de transições repetidas em sequência imediata.
    if (record.latest && record.latest.state === state && now - record.latest.startedAt < COMBAT_VISUAL_DEDUPE_MS) {
      return false;
    }
    // Prioridade: descarta efeito menor durante a janela de um maior.
    if (active && COMBAT_VISUAL_PRIORITY[state] < COMBAT_VISUAL_PRIORITY[active.state]) {
      return false;
    }

    const duration = COMBAT_VISUAL_DURATION_MS[state];
    const next: ActiveVisual = {
      state,
      seq: ++this.seq,
      startedAt: now,
      expiresAt: Number.isFinite(duration) ? now + duration : Number.POSITIVE_INFINITY,
    };
    if (terminal) {
      record.terminal = next;
      record.latest = null;
    } else {
      record.latest = next;
    }
    return true;
  }

  /** Estado visual ativo do combatente; `null` = IDLE (nenhum temporário). */
  activeStateFor(combatantId: string): CombatVisualState | null {
    const record = this.records.get(combatantId);
    if (!record) return null;
    if (record.terminal) return record.terminal.state;
    if (record.latest && this.now() < record.latest.expiresAt) return record.latest.state;
    return null;
  }

  /** Estado padrão do renderizador quando não há temporário ativo. */
  static get defaultState(): CombatVisualState {
    return DEFAULT_COMBAT_VISUAL_STATE;
  }

  /**
   * Próximo instante em que algum temporário expira — o consumidor agenda UM
   * timeout nesse ponto em vez de polular a cada frame.
   */
  nextExpiryAt(): number | null {
    const now = this.now();
    let next: number | null = null;
    for (const record of this.records.values()) {
      if (record.terminal) continue;
      if (!record.latest) continue;
      if (record.latest.expiresAt === Number.POSITIVE_INFINITY) continue;
      // Temporário já vencido não agenda novo timeout (evita laço de re-render).
      if (record.latest.expiresAt <= now) continue;
      if (next === null || record.latest.expiresAt < next) next = record.latest.expiresAt;
    }
    return next;
  }

  private record(combatantId: string): CombatantVisualRecord {
    let record = this.records.get(combatantId);
    if (!record) {
      record = newRecord();
      this.records.set(combatantId, record);
    }
    return record;
  }
}

/**
 * Cadeia de fallback por estado (sem paralelo ao catálogo: deriva dele).
 * SHOOT/MELEE_ATTACK caem em ATTACK antes de IDLE; DEATH cai em DEFEATED.
 */
export const COMBAT_STATE_FALLBACK_CHAIN: Readonly<Record<CombatVisualState, readonly CombatVisualState[]>> = {
  IDLE: ["IDLE"],
  AIM: ["AIM", "IDLE"],
  ATTACK: ["ATTACK", "IDLE"],
  SHOOT: ["SHOOT", "ATTACK", "IDLE"],
  MELEE_ATTACK: ["MELEE_ATTACK", "ATTACK", "IDLE"],
  DODGE: ["DODGE", "IDLE"],
  HIT: ["HIT", "IDLE"],
  RELOAD: ["RELOAD", "IDLE"],
  DEFEATED: ["DEFEATED", "IDLE"],
  DEATH: ["DEATH", "DEFEATED", "IDLE"],
};

/** Resultado de ataque já confirmado pelo servidor (chega com a resposta). */
export interface ConfirmedAttackVisualOutcome {
  attackerId: string;
  targetId: string | null;
  kind: "ranged" | "melee";
  hit: boolean;
  damage: number | null;
  /** Defesa aplicada pelo engine ao alvo (`AttackResult.defenseType`). */
  defenseType?: "dv" | "evasion";
}

/**
 * Mapeia um ataque CONFIRMADO para os efeitos visuais reais que ele sustenta:
 * - atacante: SHOOT (distância) ou MELEE_ATTACK (corpo a corpo);
 * - alvo: DODGE somente quando o engine registrou defesa `evasion` E o ataque
 *   não acertou (esquiva efetivamente executada — nunca deduzida);
 * - alvo: HIT quando houve dano efetivamente aplicado.
 *
 * Defesa `dv` sem acerto (errou o DV) NÃO gera DODGE: o sistema não
 * distingue desviar de cobertura/bloqueio — limitação documentada.
 */
export function attackVisualEffects(
  outcome: ConfirmedAttackVisualOutcome,
): Array<{ combatantId: string; effect: CombatVisualEffect }> {
  const effects: Array<{ combatantId: string; effect: CombatVisualEffect }> = [
    { combatantId: outcome.attackerId, effect: outcome.kind === "melee" ? "attack_melee" : "attack_ranged" },
  ];
  if (outcome.targetId) {
    if (!outcome.hit && outcome.defenseType === "evasion") {
      effects.push({ combatantId: outcome.targetId, effect: "dodge" });
    } else if (outcome.hit && (outcome.damage ?? 0) > 0) {
      effects.push({ combatantId: outcome.targetId, effect: "hit" });
    }
  }
  return effects;
}

export interface ResolvedCombatStateImage {
  url: string;
  assetId: string | null;
  /** Estado do catálogo que forneceu a imagem (pode diferir do pedido). */
  state: CombatVisualState;
}

/**
 * Resolve a imagem para um estado usando o manifesto da Etapa 1: aceita a
 * imagem específica do estado (`source: "state"`) ou a imagem final da
 * cadeia (IDLE configurada); sem nada → `null` (o renderizador usa o boneco
 * genérico). URLs marcadas como falhas são puladas para o próximo fallback.
 */
export function resolveCombatStateImage(
  identity: { states: ReadonlyArray<{ state: CombatVisualState; url: string | null; assetId: string | null; source: string }> } | null | undefined,
  state: CombatVisualState,
  isUrlFailed: (url: string) => boolean = () => false,
): ResolvedCombatStateImage | null {
  if (!identity) return null;
  const chain = COMBAT_STATE_FALLBACK_CHAIN[state] ?? [DEFAULT_COMBAT_VISUAL_STATE];
  for (const candidate of chain) {
    const entry = identity.states.find((visual) => visual.state === candidate);
    if (!entry?.url || isUrlFailed(entry.url)) continue;
    // Antes do fim da cadeia só vale imagem ESPECÍFICAMENTE configurada;
    // o manifest já resolve IDLE como fallback, então "IDLE" fecha a cadeia
    // aceitando qualquer origem (inclusive a própria cadeia do manifesto).
    if (candidate === "IDLE" || entry.source === "state") {
      return { url: entry.url, assetId: entry.assetId, state: candidate };
    }
  }
  return null;
}
