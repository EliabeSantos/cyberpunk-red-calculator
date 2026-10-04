/**
 * F1.7.1 — ADAPTER de persistência: `CombatResult` do motor → patch de
 * `mesa_combatants`. O lado servidor do primeiro vertical slice:
 *
 *     engine.execute(state, DamageAction, serverRandom)   src/lib/combat/engine.ts (puro)
 *               ↓
 *     engineDamagePatch(result, targetId)                 ← este módulo (tradução VERBATIM)
 *               ↓
 *     UPDATE condicional (CAS) em mesa_combatants         src/lib/mesa/store.ts (decisão 3)
 *
 * ## O que ele é (e o que proibidamente NÃO é)
 *
 * Tradução PURA dos `CombatStateChange` que o motor já emitiu — sem Supabase,
 * sem store, sem regra. As duas únicas colunas deste escopo saem de `changes`:
 *
 *   • `hp_current`  ← `hp_changed.after`
 *   • `is_dead`     ← `is_dead_changed.after`
 *   • `combat_armor` ← estado do alvo quando armor mudou
 *   • `critical_injuries` ← estado do alvo quando uma lesão entrou
 *
 * NUNCA recalcula: não existe `if (hp <= 0) isDead = true` aqui, não existe
 * `isDefeatedBy`, não existe leitura de `damageResult.hpAfter` para derivar
 * morte — quem decidiu foi `applyDamage` dentro do motor (fonte única). Se o
 * motor não emitiu a mudança, a coluna não entra no patch (ausência = "nada
 * mudou", não "derive você mesmo").
 *
 */
import type { CombatResult } from "@/lib/combat/contract";

/** Colunas de `mesa_combatants` que este vertical slice persiste. */
export interface EngineDamagePatch {
  hp_current?: number;
  is_dead?: boolean;
  combat_armor?: { head: number; body: number };
  critical_injuries?: CombatResult["state"]["participants"][number]["combat"]["criticalInjuries"];
}

/**
 * Projeta do `CombatResult` o patch das colunas em escopo para `targetId`.
 *
 * Somente resultados `ok` (o chamador recusa `ok: false` ANTES de chamar —
 * `events`/`errors` de recusa nunca viram escrita). Um resultado válido pode
 * devolver patch vazio (dano todo absorvido pela SP, por exemplo): aí não há
 * nada a persistir e o chamador não escreve.
 */
export function engineDamagePatch(result: CombatResult, targetId: string): EngineDamagePatch {
  const patch: EngineDamagePatch = {};

  for (const change of result.changes) {
    if (change.type === "hp_changed" && change.participantId === targetId) {
      patch.hp_current = change.after;
    } else if (change.type === "is_dead_changed" && change.participantId === targetId) {
      patch.is_dead = change.after;
    }
  }

  const target = result.state?.participants.find((participant) => participant.id === targetId);
  if (target) {
    if (result.changes.some((change) => change.type === "armor_changed" && change.participantId === targetId)) {
      patch.combat_armor = { ...target.combat.armor };
    }
    if (result.changes.some((change) => change.type === "critical_injury_added" && change.participantId === targetId)) {
      patch.critical_injuries = [...target.combat.criticalInjuries];
    }
  }

  return patch;
}
