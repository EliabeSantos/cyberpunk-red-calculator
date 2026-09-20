import { armorSlotForLocation, type HitLocation } from "@/types/combat";
import { rollDice } from "@/lib/dice";
import { calculateWoundThreshold } from "@/lib/calculations";
import { rollCriticalInjury, checkCriticalInjuryFromDamage } from "@/data/criticalInjuries";
import type { AttackRollResult, DamageRollResult } from "@/types/attack";
import type { Character, RollHistoryEntry, CriticalInjury } from "@/types/character";
import { hitLocationLabels } from "@/types/combat";

/** Resultado completo da aplicação de dano, incluindo detecção de Seriously Wounded e Critical Injury. */
export interface DamageApplicationResult {
  damage: number;
  hpBefore: number;
  hpAfter: number;
  woundThreshold: number;
  crossedWoundThreshold: boolean;
  location: HitLocation;
  criticalInjuryTriggered: boolean;
  criticalInjuryFromDice: boolean;
  criticalInjury?: CriticalInjury;
  /** Critical Injury causada por dois ou mais 6 nos dados de dano (separada da do Wound Threshold). */
  criticalInjuryFromDiceResult?: CriticalInjury;
  armorSPBefore: number;
  armorSPAfter: number;
  damageAbsorbed: number;
  damageToHP: number;
}

export type DamageResolution = { character: Character; result: DamageRollResult } | { error: string };

export function rollDamage(attack: AttackRollResult): DamageRollResult | { error: string } {
  if (!attack.damageDice) return { error: `${attack.label} não possui uma rolagem de dano definida.` };
  const roll = rollDice(attack.damageDice);
  return { attackId: attack.attackId, attackName: attack.label, weaponId: attack.weaponId, damageDice: attack.damageDice, roll, total: roll.total };
}

export function rollDamageForLastAttack(character: Character): DamageResolution {
  if (!character.lastAttack) return { error: "Nenhum ataque válido foi realizado." };
  const result = rollDamage(character.lastAttack);
  if ("error" in result) return result;
  const entry: RollHistoryEntry = { id: crypto.randomUUID(), type: "damage", label: result.attackName, characterId: character.id, expression: result.damageDice, rolls: result.roll.rolls, total: result.total, timestamp: new Date().toISOString(), attackId: result.attackId, weaponId: result.weaponId };
  return { character: { ...character, lastDamage: result, rollHistory: [entry, ...character.rollHistory] }, result };
}

/** Aplica dano recebido manualmente, detectando Seriously Wounded e Critical Injury. */
export function applyReceivedDamage(
  character: Character,
  amount: number,
  hitLocation: HitLocation = "body"
): { character: Character; result: DamageApplicationResult } | { error: string } {
  if (!Number.isInteger(amount) || amount <= 0) return { error: "Dano inválido." };

  const slot = armorSlotForLocation(hitLocation);
  const armorSPBefore = character.combat.armor[slot] ?? 0;
  const damageAbsorbed = Math.min(amount, armorSPBefore);
  const damageToHP = Math.max(0, amount - damageAbsorbed);
  const armorSPAfter = damageToHP > 0 ? Math.max(0, armorSPBefore - 1) : armorSPBefore;

  const hpBefore = character.combat.hp.current;
  const hpAfter = Math.max(0, hpBefore - damageToHP);

  // Wound Threshold e detecção de Seriously Wounded
  const woundThreshold = calculateWoundThreshold(character.combat.hp.max);
  const wasSeriouslyWounded = hpBefore <= woundThreshold;
  const isNowSeriouslyWounded = hpAfter <= woundThreshold;
  const crossedWoundThreshold = !wasSeriouslyWounded && isNowSeriouslyWounded;

  // Verifica Critical Injury pelos dados de dano (dois ou mais 6)
  // Para dano manual, não temos rolagem de dados, então usamos false
  // O ataque com rolagem de dano deve usar applyAttackDamage abaixo
  const criticalInjuryFromDice = false;

  // Critical Injury por cruzamento de Wound Threshold
  let criticalInjury: DamageApplicationResult["criticalInjury"] | undefined;
  let criticalInjuryTriggered = false;

  if (crossedWoundThreshold) {
    const injury = rollCriticalInjury(hitLocation);
    criticalInjury = injury;
    criticalInjuryTriggered = true;
  }

  const entry: RollHistoryEntry = {
    id: crypto.randomUUID(),
    type: "received_damage",
    label: "Dano recebido",
    characterId: character.id,
    expression: String(amount),
    rolls: [],
    total: amount,
    timestamp: new Date().toISOString(),
    amount,
    hitLocation,
    armorSPBefore,
    armorSPAfter,
    damageAbsorbed,
    damageToHP,
    hpBefore,
    hpAfter,
  };

  const updatedCharacter: Character = {
    ...character,
    combat: {
      ...character.combat,
      armor: { ...character.combat.armor, [slot]: armorSPAfter },
      hp: { ...character.combat.hp, current: hpAfter },
      criticalInjuries: criticalInjuryTriggered && criticalInjury
        ? [...character.combat.criticalInjuries, criticalInjury]
        : character.combat.criticalInjuries,
    },
    rollHistory: [entry, ...character.rollHistory],
  };

  const result: DamageApplicationResult = {
    damage: amount,
    hpBefore,
    hpAfter,
    woundThreshold,
    crossedWoundThreshold,
    location: hitLocation,
    criticalInjuryTriggered,
    criticalInjuryFromDice,
    criticalInjury,
    armorSPBefore,
    armorSPAfter,
    damageAbsorbed,
    damageToHP,
  };

  return { character: updatedCharacter, result };
}

/** Aplica dano de um ataque rolado (com rolagem de dados de dano), verificando Critical Injury pelos dados. */
export function applyAttackDamage(
  character: Character,
  damageRoll: DamageRollResult,
  hitLocation: HitLocation = "body"
): { character: Character; result: DamageApplicationResult } | { error: string } {
  const totalDamage = damageRoll.total;
  const slot = armorSlotForLocation(hitLocation);
  const armorSPBefore = character.combat.armor[slot] ?? 0;
  const damageAbsorbed = Math.min(totalDamage, armorSPBefore);
  const damageToHP = Math.max(0, totalDamage - damageAbsorbed);
  const armorSPAfter = damageToHP > 0 ? Math.max(0, armorSPBefore - 1) : armorSPBefore;

  const hpBefore = character.combat.hp.current;
  const hpAfter = Math.max(0, hpBefore - damageToHP);

  const woundThreshold = calculateWoundThreshold(character.combat.hp.max);
  const wasSeriouslyWounded = hpBefore <= woundThreshold;
  const isNowSeriouslyWounded = hpAfter <= woundThreshold;
  const crossedWoundThreshold = !wasSeriouslyWounded && isNowSeriouslyWounded;

  // Verifica Critical Injury pelos dados de dano (dois ou mais 6)
  const criticalInjuryFromDice = checkCriticalInjuryFromDamage(damageRoll.roll.rolls);

  let criticalInjury: DamageApplicationResult["criticalInjury"] | undefined;
  let criticalInjuryTriggered = false;

  // Critical Injury por cruzamento de Wound Threshold
  if (crossedWoundThreshold) {
    const injury = rollCriticalInjury(hitLocation);
    criticalInjury = injury;
    criticalInjuryTriggered = true;
  }

  // Se também houve Critical Injury pelos dados, rola uma segunda injury
  // (regra: cada Critical Injury separada)
  let criticalInjuryFromDiceResult: DamageApplicationResult["criticalInjuryFromDiceResult"] | undefined;
  if (criticalInjuryFromDice) {
    const injury = rollCriticalInjury(hitLocation);
    criticalInjuryFromDiceResult = injury;
    criticalInjuryTriggered = true;
  }

  // Combina as injuries para o histórico
  const newInjuries: CriticalInjury[] = [];
  if (criticalInjury) {
    newInjuries.push(criticalInjury);
  }
  if (criticalInjuryFromDiceResult) {
    newInjuries.push(criticalInjuryFromDiceResult);
  }

  const entry: RollHistoryEntry = {
    id: crypto.randomUUID(),
    type: "received_damage",
    label: `Dano de ${damageRoll.attackName}`,
    characterId: character.id,
    expression: damageRoll.damageDice,
    rolls: damageRoll.roll.rolls,
    total: damageRoll.total,
    timestamp: new Date().toISOString(),
    amount: totalDamage,
    hitLocation,
    armorSPBefore,
    armorSPAfter,
    damageAbsorbed,
    damageToHP,
    hpBefore,
    hpAfter,
  };

  const updatedCharacter: Character = {
    ...character,
    combat: {
      ...character.combat,
      armor: { ...character.combat.armor, [slot]: armorSPAfter },
      hp: { ...character.combat.hp, current: hpAfter },
      criticalInjuries: newInjuries.length > 0
        ? [...character.combat.criticalInjuries, ...newInjuries]
        : character.combat.criticalInjuries,
    },
    rollHistory: [entry, ...character.rollHistory],
  };

  const result: DamageApplicationResult = {
    damage: totalDamage,
    hpBefore,
    hpAfter,
    woundThreshold,
    crossedWoundThreshold,
    location: hitLocation,
    criticalInjuryTriggered,
    criticalInjuryFromDice,
    criticalInjury,
    criticalInjuryFromDiceResult,
    armorSPBefore,
    armorSPAfter,
    damageAbsorbed,
    damageToHP,
  };

  return { character: updatedCharacter, result };
}

