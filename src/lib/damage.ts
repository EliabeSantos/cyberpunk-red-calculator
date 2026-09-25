import { armorSlotForLocation, type HitLocation } from "@/types/combat";
import { rollDice } from "@/lib/dice";
import { calculateWoundThreshold, getSkillBase, getCriticalInjuryModifiers, getWoundPenalty } from "@/lib/calculations";
import { getCyberwareBodySP } from "@/lib/cyberwareEffects";
import { rollCriticalInjury, checkCriticalInjuryFromDamage } from "@/data/criticalInjuries";
import type { AttackRollResult, DamageRollResult } from "@/types/attack";
import type { Character, RollHistoryEntry, CriticalInjury } from "@/types/character";
import { hitLocationLabels } from "@/types/combat";

/** SP de um local de impacto e o SP da armadura realmente usada.
 * Cyberware de proteção (Subdermal Armor, Skin Weave) não acumula com armadura: vale o maior.
 * Só a armadura equipada abate; o SP do cyberware é constante. */
function resolveArmorSP(character: Character, slot: "head" | "body"): { effectiveSP: number; wornArmorSP: number; cyberwareSP: number } {
  const wornArmorSP = character.combat.armor[slot] ?? 0;
  const cyberwareSP = slot === "body" ? getCyberwareBodySP(character) : 0;
  return { effectiveSP: Math.max(wornArmorSP, cyberwareSP), wornArmorSP, cyberwareSP };
}

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
  /** true quando Artes Marciais cortou o SP da armadura pela metade (arredondado para cima). */
  spHalvedByMartialArts?: boolean;
  armorSPAfter: number;
  damageAbsorbed: number;
  damageToHP: number;
}

export type DamageResolution = { character: Character; result: DamageRollResult } | { error: string };

export function rollDamage(attack: AttackRollResult): DamageRollResult | { error: string } {
  if (!attack.damageDice) return { error: `${attack.label} não possui uma rolagem de dano definida.` };
  const roll = rollDice(attack.damageDice);
  return { attackId: attack.attackId, attackName: attack.label, weaponId: attack.weaponId, attackType: attack.attackType, damageDice: attack.damageDice, roll, total: roll.total };
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
  const { effectiveSP, wornArmorSP, cyberwareSP } = resolveArmorSP(character, slot);
  const armorSPBefore = effectiveSP;
  const damageAbsorbed = Math.min(amount, armorSPBefore);
  const damageToHP = Math.max(0, amount - damageAbsorbed);
  const wornArmorSPAfter = damageToHP > 0 ? Math.max(0, wornArmorSP - 1) : wornArmorSP;
  const armorSPAfter = Math.max(wornArmorSPAfter, cyberwareSP);

  const hpBefore = character.combat.hp.current;
  const hpAfter = hpBefore - damageToHP; // Permite valores negativos

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

  // Inicializa Death Save DC quando HP chega a 0 ou abaixo
  let newDeathSaveDC = character.combat.deathSaveDC;
  let newDeathSaveFailures = character.combat.deathSaveFailures;
  let newIsDead = character.combat.isDead;
  if (hpAfter <= 0 && hpBefore > 0 && !newIsDead) {
    // Primeira vez que chega a 0 ou abaixo: DC = BODY
    newDeathSaveDC = character.stats.BODY;
    newDeathSaveFailures = 0;
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
      armor: { ...character.combat.armor, [slot]: wornArmorSPAfter },
      hp: { ...character.combat.hp, current: hpAfter },
      criticalInjuries: criticalInjuryTriggered && criticalInjury
        ? [...character.combat.criticalInjuries, criticalInjury]
        : character.combat.criticalInjuries,
      deathSaveDC: newDeathSaveDC,
      deathSaveFailures: newDeathSaveFailures,
      isDead: newIsDead,
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
  const { effectiveSP: baseSP, wornArmorSP, cyberwareSP } = resolveArmorSP(character, slot);
  // Artes Marciais ignoram metade do SP da armadura, arredondando para cima (SP 11 → 6).
  const spHalvedByMartialArts = damageRoll.attackType === "martial_arts" && baseSP > 0;
  const effectiveSP = spHalvedByMartialArts ? Math.ceil(baseSP / 2) : baseSP;
  const armorSPBefore = effectiveSP;
  const damageAbsorbed = Math.min(totalDamage, armorSPBefore);
  const damageToHP = Math.max(0, totalDamage - damageAbsorbed);
  const wornArmorSPAfter = damageToHP > 0 ? Math.max(0, wornArmorSP - 1) : wornArmorSP;
  const armorSPAfter = Math.max(wornArmorSPAfter, cyberwareSP);

  const hpBefore = character.combat.hp.current;
  const hpAfter = hpBefore - damageToHP; // Permite valores negativos

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

  // Inicializa Death Save DC quando HP chega a 0 ou abaixo
  let newDeathSaveDC = character.combat.deathSaveDC;
  let newDeathSaveFailures = character.combat.deathSaveFailures;
  let newIsDead = character.combat.isDead;
  if (hpAfter <= 0 && hpBefore > 0 && !newIsDead) {
    newDeathSaveDC = character.stats.BODY;
    newDeathSaveFailures = 0;
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
      armor: { ...character.combat.armor, [slot]: wornArmorSPAfter },
      hp: { ...character.combat.hp, current: hpAfter },
      criticalInjuries: newInjuries.length > 0
        ? [...character.combat.criticalInjuries, ...newInjuries]
        : character.combat.criticalInjuries,
      deathSaveDC: newDeathSaveDC,
      deathSaveFailures: newDeathSaveFailures,
      isDead: newIsDead,
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
    spHalvedByMartialArts,
    armorSPAfter,
    damageAbsorbed,
    damageToHP,
  };

  return { character: updatedCharacter, result };
}

/** Resultado de um Death Save roll. */
export interface DeathSaveResult {
  diceRoll: number;
  dc: number;
  success: boolean;
  failuresAfter: number;
  characterDied: boolean;
}

/** Rola um Death Save para um personagem Mortally Wounded.
 * Regra: 1d10 vs DC (inicial = BODY). Cada falha reduz DC em 1.
 * Se o resultado > DC, o personagem morre.
 */
export function rollDeathSave(character: Character): { character: Character; result: DeathSaveResult } {
  const dc = character.combat.deathSaveDC;
  const roll = rollDice("1d10");
  const diceRoll = roll.rolls[0];
  const success = diceRoll <= dc;
  let newFailures = character.combat.deathSaveFailures;
  let newDC = dc;
  let characterDied = false;

  if (!success) {
    newFailures += 1;
    newDC = Math.max(0, dc - 1); // Cada falha reduz DC em1
    // Verifica se o resultado do d10 é maior que o DC atual
    if (diceRoll > newDC) {
      characterDied = true;
    }
  }

  const entry: RollHistoryEntry = {
    id: crypto.randomUUID(),
    type: "free_roll",
    label: success ? "Death Save (sucesso)" : "Death Save (falha)",
    characterId: character.id,
    expression: `1d10 [${diceRoll}] vs DC ${dc}`,
    rolls: [diceRoll],
    total: diceRoll,
    timestamp: new Date().toISOString(),
  };

  const updatedCharacter: Character = {
    ...character,
    combat: {
      ...character.combat,
      deathSaveDC: newDC,
      deathSaveFailures: newFailures,
      isDead: characterDied,
    },
    rollHistory: [entry, ...character.rollHistory],
  };

  return {
    character: updatedCharacter,
    result: {
      diceRoll,
      dc,
      success,
      failuresAfter: newFailures,
      characterDied,
    },
  };
}

/** Aplica First Aid em um personagem Mortally Wounded.
 * Regra: First Aid bem-sucedido permite retornar para 1 HP.
 * Reseta o estado de Death Save.
 */
export function applyFirstAid(character: Character): { character: Character; restored: boolean } {
  if (character.combat.hp.current > 0 || character.combat.isDead) {
    return { character, restored: false };
  }

  const updatedCharacter: Character = {
    ...character,
    combat: {
      ...character.combat,
      hp: { ...character.combat.hp, current:1 },
      deathSaveDC: 0,
      deathSaveFailures: 0,
      isDead: false,
    },
  };

  return { character: updatedCharacter, restored: true };
}

/** Resultado de um roll de First Aid. */
export interface FirstAidRollResult {
  diceRoll: number;
  techValue: number;
  firstAidLevel: number;
  medkitBonus: number;
  injuryModifier: number;
  total: number;
  dv: number;
  success: boolean;
}

/** Rola First Aid (1d10 + TECH + First Aid + bônus de medkit) vs DV 15.
 * Se sucesso, restaura o personagem para 1 HP e reseta Death Save.
 */
export function rollFirstAid(
  character: Character,
  medkitBonus: number = 0,
): { character: Character; result: FirstAidRollResult } | { error: string } {
  if (character.combat.hp.current > 0) {
    return { error: "First Aid só pode ser usado em personagens com HP ≤ 0." };
  }
  if (character.combat.isDead) {
    return { error: "Não é possível usar First Aid em um personagem morto." };
  }

  const techValue = character.stats.TECH;
  const firstAidLevel = character.skills.first_aid?.level ?? 0;
  const dv = 15;

  // Modificadores de Critical Injuries
  const injuryModifiers = getCriticalInjuryModifiers(character);
  const criticalInjuryModifier = injuryModifiers.allActionsModifier + injuryModifiers.fineManipulationModifier;

  // Seriously/Mortally Wounded: -2 em todas as ações (baseado no HP, não na lista de injuries).
  // Pain Editor ativo ignora essa penalidade — mesma fonte usada por perícia, ataque e Evasão.
  const seriouslyWoundedModifier = getWoundPenalty(character);

  const injuryModifier = criticalInjuryModifier + seriouslyWoundedModifier;

  const roll = rollDice("1d10");
  const diceRoll = roll.rolls[0];
  const total = diceRoll + techValue + firstAidLevel + medkitBonus + injuryModifier;
  const success = total >= dv;

  let updatedCharacter = character;
  if (success) {
    updatedCharacter = {
      ...character,
      combat: {
        ...character.combat,
        hp: { ...character.combat.hp, current: 1 },
        deathSaveDC: 0,
        deathSaveFailures: 0,
        isDead: false,
      },
    };
  }

  const entry: RollHistoryEntry = {
    id: crypto.randomUUID(),
    type: "skill_check",
    label: success ? "First Aid (sucesso)" : "First Aid (falha)",
    characterId: character.id,
    expression: `1d10 [${diceRoll}] + TECH ${techValue} + First Aid ${firstAidLevel}${medkitBonus > 0 ? ` + Medkit ${medkitBonus}` : ""}${injuryModifier !== 0 ? ` + Lesão ${injuryModifier}` : ""} = ${total} vs DV ${dv}`,
    rolls: [diceRoll],
    total,
    timestamp: new Date().toISOString(),
    stat: { id: "TECH", value: techValue },
    skill: { id: "first_aid", value: firstAidLevel },
    modifiers: [
      ...(medkitBonus > 0 ? [{ source: "Medkit", value: medkitBonus }] : []),
      ...(injuryModifier !== 0 ? [{ source: "Lesão", value: injuryModifier }] : []),
    ],
  };

  updatedCharacter = {
    ...updatedCharacter,
    rollHistory: [entry, ...updatedCharacter.rollHistory],
  };

  return {
    character: updatedCharacter,
    result: {
      diceRoll,
      techValue,
      firstAidLevel,
      medkitBonus,
      injuryModifier,
      total,
      dv,
      success,
    },
  };
}

