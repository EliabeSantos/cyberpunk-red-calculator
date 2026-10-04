/**
 * F1.2 — DANO do inimigo no encontro: expressão, SP, rolagem, aplicação e HP.
 *
 * Extraído de `src/lib/gmStorage.ts` sem mudança de assinatura, corpo ou
 * regra (ver re-exports de compatibilidade no próprio `gmStorage`).
 *
 * Módulo puro: nada de `client-only`, `gmStorage`, React, Next, `window`,
 * `localStorage` ou Supabase.
 *
 * Mantido exatamente como estava — inclusive as divergências já conhecidas
 * (F1.0 §13: `ignoreArmor` ≠ meia-SP de Artes Marciais, inimigo clampeado em
 * 0 sem death save, nenhuma penalidade de ferimento). Corrigir isso é
 * assunto das etapas próprias do roadmap.
 *
 * F1.3: `applyDamageToParticipant` **delega** a cadeia SP → absorção →
 * degradação → clamp de HP para a regra canônica de
 * `src/lib/combat/damage.ts` (a mesma que a ficha usa) e devolve o
 * participante novo — assinatura e resultado idênticos aos de antes.
 */
import { rollDice } from "@/lib/dice";
import { getEnemyBodySP, getEnemyUnarmedDamageDice } from "@/lib/enemyCyberware";
import { applyDamage, effectiveArmorSP, ENEMY_DAMAGE_POLICY } from "@/lib/combat/damage";
import type { RandomSource } from "@/lib/combat/contract";
import type { EncounterData, EncounterParticipant, ImplantBearer } from "@/types/encounter";

/**
 * `true` quando o participante está de mãos livias — é a condição do bônus de
 * dano desarmado (Gorilla Arms: +1d6), a mesma que a ficha do jogador usa.
 */
export function isUnarmedParticipant(participant: Pick<EncounterParticipant, "weaponName">): boolean {
  const name = participant.weaponName.trim();
  return name === "" || name === "Desarmado";
}

/** Dados extras de dano desarmado vindos dos implantes (0 quando armado). */
function getParticipantUnarmedDamageDice(participant: ImplantBearer & Pick<EncounterParticipant, "weaponName">): number {
  return isUnarmedParticipant(participant) ? getEnemyUnarmedDamageDice(participant.implants) : 0;
}

/**
 * Expressão de dano efetiva, já com os dados extras do implante.
 * `rollDice` só aceita `NdM`, então os dados a mais entram como rolagem
 * separada em `rollDamage` — aqui fica só o rótulo mostrado ao Mestre.
 */
export function getParticipantDamageExpression(
  participant: ImplantBearer & Pick<EncounterParticipant, "weaponName" | "damageExpression">,
): string {
  const extra = getParticipantUnarmedDamageDice(participant);
  return extra > 0 ? `${participant.damageExpression}+${extra}d6` : participant.damageExpression;
}

/**
 * SP efetivo de um local de impacto: armadura do bestiário e cyberware não
 * acumulam, vale o maior — mesmo predicado de `getEffectiveArmorSP` da ficha.
 * Só o corpo tem SP de cyberware (Subdermal Armor / Skin Weave).
 */
export function getParticipantArmorSP(
  participant: Pick<EncounterParticipant, "armor" | "implants">,
  slot: "head" | "body",
): number {
  const worn = slot === "head" ? participant.armor.head : participant.armor.body;
  const cyberwareSP = slot === "body" ? getEnemyBodySP(participant.implants) : 0;
  return effectiveArmorSP(worn, cyberwareSP);
}

export function rollDamage(
  encounter: EncounterData,
  participantIndex: number,
  rng?: RandomSource
): EncounterData {
  const participants = [...encounter.participants];
  const p = participants[participantIndex];
  const result = rollDice(p.damageExpression, rng);
  const rolls = [...result.rolls];
  let total = result.total;

  // Gorilla Arms & cia.: dado extra do ataque desarmado, rolado à parte porque
  // `rollDice` só entende `NdM` (a expressão mostrada é a de
  // `getParticipantDamageExpression`, ex.: `1d6+1d6`).
  const extraDice = getParticipantUnarmedDamageDice(p);
  if (extraDice > 0) {
    const bonus = rollDice(`${extraDice}d6`, rng);
    rolls.push(...bonus.rolls);
    total += bonus.total;
  }

  participants[participantIndex] = {
    ...p,
    lastDamageRoll: { rolls, total, expression: getParticipantDamageExpression(p) },
  };
  return { ...encounter, participants };
}

export function applyDamageToParticipant(
  encounter: EncounterData,
  participantIndex: number,
  rawDamage: number,
  ignoreArmor: boolean,
  hitLocation: "head" | "body"
): EncounterData {
  const participants = [...encounter.participants];
  const p = participants[participantIndex];

  // F1.3: a cadeia SP → absorção → degradação → clamp de HP mora na regra
  // canônica; aqui ficam só os dois campos que o participante tem.
  // `ignoreArmor` é a variante "ignore" (meia-SP arredondada para baixo,
  // degradação pelo SP cheio) — divergência registrada no F1.0 §13 e mantida.
  const outcome = applyDamage(
    {
      hp: p.hp.current,
      wornArmorSP: hitLocation === "head" ? p.armor.head : p.armor.body,
      // Só o corpo tem SP de cyberware (Subdermal Armor / Skin Weave).
      cyberwareSP: hitLocation === "body" ? getEnemyBodySP(p.implants) : 0,
    },
    rawDamage,
    ENEMY_DAMAGE_POLICY,
    ignoreArmor ? "ignore" : "full",
  );

  const armor =
    hitLocation === "head"
      ? { ...p.armor, head: outcome.wornArmorSPAfter }
      : { ...p.armor, body: outcome.wornArmorSPAfter };
  participants[participantIndex] = {
    ...p,
    hp: { ...p.hp, current: outcome.hpAfter },
    armor,
  };
  return { ...encounter, participants };
}

export function updateParticipantHP(
  encounter: EncounterData,
  participantIndex: number,
  newHP: number
): EncounterData {
  const participants = [...encounter.participants];
  participants[participantIndex] = {
    ...participants[participantIndex],
    hp: { ...participants[participantIndex].hp, current: Math.max(0, newHP) },
  };
  return { ...encounter, participants };
}
