/**
 * Ficha do jogador — CAMADA DE PLAYER sobre a regra canônica de aplicação de
 * dano (`src/lib/combat/damage.ts`, F1.3).
 *
 * `applyReceivedDamage`/`applyAttackDamage` agora delegam a cadeia
 * SP → absorção → degradação → HP para `applyDamage(..., PLAYER_DAMAGE_POLICY)`
 * e montam em cima do resultado o que é específico da ficha: validação da UI,
 * Wound Threshold, Critical Injury (rola dado), Death Save DC e histórico.
 * Assinaturas e resultados não mudaram.
 */
import { armorSlotForLocation, type HitLocation } from "@/types/combat";
import { rollDice } from "@/lib/dice";
import { createId } from "@/lib/id";
import { calculateWoundThreshold, getSkillBase, getCriticalInjuryModifiers, getWoundPenalty } from "@/lib/calculations";
import { getCyberwareBodySP } from "@/lib/cyberwareEffects";
import { rollCriticalInjury, checkCriticalInjuryFromDamage } from "@/data/criticalInjuries";
import { applyDamage, PLAYER_DAMAGE_POLICY, woundThresholdCrossed } from "@/lib/combat/damage";
import type { RandomSource } from "@/lib/combat/contract";
import type { AttackRollResult, DamageRollResult } from "@/types/attack";
import type { Character, RollHistoryEntry, CriticalInjury } from "@/types/character";
import { hitLocationLabels } from "@/types/combat";

/** SP vestido e SP de cyberware de um local de impacto.
 * Cyberware de proteção (Subdermal Armor, Skin Weave) não acumula com armadura: vale o maior
 * (`effectiveArmorSP`, na regra canônica de `@/lib/combat/damage`).
 * Só a armadura equipada abate; o SP do cyberware é constante. */
function resolveArmorSP(character: Character, slot: "head" | "body"): { wornArmorSP: number; cyberwareSP: number } {
  const wornArmorSP = character.combat.armor[slot] ?? 0;
  const cyberwareSP = slot === "body" ? getCyberwareBodySP(character) : 0;
  return { wornArmorSP, cyberwareSP };
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
  /** Critical Injury causada por dois ou mais 6 nos dados de dano. */
  criticalInjuryFromDiceResult?: CriticalInjury;
  armorSPBefore: number;
  /** true quando Artes Marciais cortou o SP da armadura pela metade (arredondado para cima). */
  spHalvedByMartialArts?: boolean;
  armorSPAfter: number;
  damageAbsorbed: number;
  damageToHP: number;
}

export type DamageResolution = { character: Character; result: DamageRollResult } | { error: string };

/** Rola os dados de dano do ataque. `rng` opcional (F1.4) — só injeta a fonte,
 * a expressão e a soma continuam do `rollDice` canônico. */
export function rollDamage(attack: AttackRollResult, rng?: RandomSource): DamageRollResult | { error: string } {
  if (!attack.damageDice) return { error: `${attack.label} não possui uma rolagem de dano definida.` };
  const roll = rollDice(attack.damageDice, rng);
  return { attackId: attack.attackId, attackName: attack.label, weaponId: attack.weaponId, attackType: attack.attackType, damageDice: attack.damageDice, roll, total: roll.total };
}

export function rollDamageForLastAttack(character: Character, rng?: RandomSource): DamageResolution {
  if (!character.lastAttack) return { error: "Nenhum ataque válido foi realizado." };
  const result = rollDamage(character.lastAttack, rng);
  if ("error" in result) return result;
  const entry: RollHistoryEntry = { id: createId(), type: "damage", label: result.attackName, characterId: character.id, expression: result.damageDice, rolls: result.roll.rolls, total: result.total, timestamp: new Date().toISOString(), attackId: result.attackId, weaponId: result.weaponId };
  return { character: { ...character, lastDamage: result, rollHistory: [entry, ...character.rollHistory] }, result };
}

/** Aplica dano recebido manualmente, detectando Seriously Wounded e Critical Injury.
 * `rng` opcional (F1.4): só injeta a fonte nas rolagens de Critical Injury. */
export function applyReceivedDamage(
  character: Character,
  amount: number,
  hitLocation: HitLocation = "body",
  rng?: RandomSource
): { character: Character; result: DamageApplicationResult } | { error: string } {
  if (!Number.isInteger(amount) || amount <= 0) return { error: "Dano inválido." };

  const slot = armorSlotForLocation(hitLocation);
  const { wornArmorSP, cyberwareSP } = resolveArmorSP(character, slot);
  // F1.3: SP, absorção, degradação e clamp de HP saem da regra canônica
  // (política `player`: HP pode ficar negativo, derrota não vem do dano).
  const outcome = applyDamage(
    { hp: character.combat.hp.current, wornArmorSP, cyberwareSP, isDead: character.combat.isDead },
    amount,
    PLAYER_DAMAGE_POLICY,
  );
  const { hpBefore, hpAfter, armorSPBefore, armorSPAfter, damageAbsorbed, damageToHP, wornArmorSPAfter } = outcome;

  // Wound Threshold e detecção de Seriously Wounded (predicado canônico, F1.5)
  const woundThreshold = calculateWoundThreshold(character.combat.hp.max);
  const crossedWoundThreshold = woundThresholdCrossed(hpBefore, hpAfter, woundThreshold);

  // Verifica Critical Injury pelos dados de dano (dois ou mais 6)
  // Para dano manual, não temos rolagem de dados, então usamos false
  // O ataque com rolagem de dano deve usar applyAttackDamage abaixo
  const criticalInjuryFromDice = false;

  // Dano manual não possui dados de dano; portanto não pode gerar Critical
  // Injury. Wound Threshold determina somente o estado de ferimento.
  const criticalInjury: DamageApplicationResult["criticalInjury"] = undefined;
  const criticalInjuryTriggered = false;
  const hpAfterCriticalInjury = hpAfter;

  // Inicializa Death Save DC quando HP chega a 0 ou abaixo
  let newDeathSaveDC = character.combat.deathSaveDC;
  let newDeathSaveFailures = character.combat.deathSaveFailures;
  // Política `player`: o dano nunca muda `isDead` (o Death Save é quem mata).
  const newIsDead = outcome.isDeadAfter;
  if (hpAfterCriticalInjury <= 0 && hpBefore > 0 && !newIsDead) {
    // Primeira vez que chega a 0 ou abaixo: DC = BODY
    newDeathSaveDC = character.stats.BODY;
    newDeathSaveFailures = 0;
  }

  const entry: RollHistoryEntry = {
    id: createId(),
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
     hpAfter: hpAfterCriticalInjury,
  };

  const updatedCharacter: Character = {
    ...character,
    combat: {
      ...character.combat,
      armor: { ...character.combat.armor, [slot]: wornArmorSPAfter },
       hp: { ...character.combat.hp, current: hpAfterCriticalInjury },
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
    hpAfter: hpAfterCriticalInjury,
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

/** Aplica dano de um ataque rolado (com rolagem de dados de dano), verificando Critical Injury pelos dados.
 * `rng` opcional (F1.4): só injeta a fonte nas rolagens de Critical Injury. */
export function applyAttackDamage(
  character: Character,
  damageRoll: DamageRollResult,
  hitLocation: HitLocation = "body",
  rng?: RandomSource
): { character: Character; result: DamageApplicationResult } | { error: string } {
  const totalDamage = damageRoll.total;
  const slot = armorSlotForLocation(hitLocation);
  const { wornArmorSP, cyberwareSP } = resolveArmorSP(character, slot);
  // Artes Marciais ignoram metade do SP da armadura, arredondando para cima (SP 11 → 6).
  const isMartialArtsAttack = damageRoll.attackType === "martial_arts";
  // F1.3: SP (inclusive a meia-SP de Artes Marciais), absorção, degradação e
  // clamp de HP saem da regra canônica — política `player`.
  const outcome = applyDamage(
    { hp: character.combat.hp.current, wornArmorSP, cyberwareSP, isDead: character.combat.isDead },
    totalDamage,
    PLAYER_DAMAGE_POLICY,
    isMartialArtsAttack ? "martial_arts_half" : "full",
  );
  const spHalvedByMartialArts = outcome.spHalvedByMartialArts;
  const { hpBefore, hpAfter, armorSPBefore, armorSPAfter, damageAbsorbed, damageToHP, wornArmorSPAfter } = outcome;

  const woundThreshold = calculateWoundThreshold(character.combat.hp.max);
  // Verifica Critical Injury pelos dados de dano (dois ou mais 6)
  const criticalInjuryFromDice = checkCriticalInjuryFromDamage(damageRoll.roll.rolls);

  const criticalInjury: DamageApplicationResult["criticalInjury"] = undefined;
  let criticalInjuryTriggered = false;

  let criticalInjuryFromDiceResult: DamageApplicationResult["criticalInjuryFromDiceResult"] | undefined;
  if (criticalInjuryFromDice) {
    const injury = rollCriticalInjury(
      hitLocation,
      new Set(character.combat.criticalInjuries.map((existing) => existing.name)),
      rng,
    );
    criticalInjuryFromDiceResult = injury;
    criticalInjuryTriggered = true;
  }

  // Combina as injuries para o histórico
  const newInjuries: CriticalInjury[] = [];
  if (criticalInjuryFromDiceResult) {
    newInjuries.push(criticalInjuryFromDiceResult);
  }

  const criticalInjuryBonusDamage = criticalInjuryFromDiceResult?.bonusDamage ?? 0;
  const hpAfterCriticalInjury = hpAfter - criticalInjuryBonusDamage;
  const crossedWoundThreshold = woundThresholdCrossed(hpBefore, hpAfterCriticalInjury, woundThreshold);

  // Inicializa Death Save DC quando HP chega a 0 ou abaixo
  let newDeathSaveDC = character.combat.deathSaveDC;
  let newDeathSaveFailures = character.combat.deathSaveFailures;
  // Política `player`: o dano nunca muda `isDead` (o Death Save é quem mata).
  const newIsDead = outcome.isDeadAfter;
  if (hpAfterCriticalInjury <= 0 && hpBefore > 0 && !newIsDead) {
    newDeathSaveDC = character.stats.BODY;
    newDeathSaveFailures = 0;
  }

  const entry: RollHistoryEntry = {
    id: createId(),
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
     hpAfter: hpAfterCriticalInjury,
  };

  const updatedCharacter: Character = {
    ...character,
    combat: {
      ...character.combat,
      armor: { ...character.combat.armor, [slot]: wornArmorSPAfter },
      hp: { ...character.combat.hp, current: hpAfterCriticalInjury },
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
    hpAfter: hpAfterCriticalInjury,
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
    damageToHP: damageToHP + criticalInjuryBonusDamage,
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

export interface DeathSaveState {
  dc: number;
  failures: number;
  /** Penalidade persistente das Critical Injuries, aplicada sem alterar a DC base armazenada. */
  deathSavePenalty?: number;
}

/**
 * Resolve somente a regra de Death Save, sem depender de Character ou de
 * persistência. A ficha e o gateway da Mesa usam esta mesma função.
 */
export function resolveDeathSave(state: DeathSaveState, rng?: RandomSource): DeathSaveResult & { state: DeathSaveState } {
  const dc = Math.max(0, state.dc + (state.deathSavePenalty ?? 0));
  const roll = rollDice("1d10", rng);
  const diceRoll = roll.rolls[0];
  const success = diceRoll <= dc;
  const failuresAfter = success ? state.failures : state.failures + 1;
  const nextBaseDc = success ? state.dc : Math.max(0, state.dc - 1);
  const nextEffectiveDc = Math.max(0, nextBaseDc + (state.deathSavePenalty ?? 0));
  const characterDied = !success && diceRoll > nextEffectiveDc;
  return {
    diceRoll,
    dc,
    success,
    failuresAfter,
    characterDied,
    state: state.deathSavePenalty === undefined
      ? { dc: nextBaseDc, failures: failuresAfter }
      : { dc: nextBaseDc, failures: failuresAfter, deathSavePenalty: state.deathSavePenalty },
  };
}

/** Rola um Death Save para um personagem Mortally Wounded.
 * Regra: 1d10 vs DC (inicial = BODY). Cada falha reduz DC em 1.
 * Se o resultado > DC, o personagem morre.
 */
export function rollDeathSave(character: Character, rng?: RandomSource): { character: Character; result: DeathSaveResult } {
  const injuryModifiers = getCriticalInjuryModifiers(character);
  const resolved = resolveDeathSave(
    { dc: character.combat.deathSaveDC, failures: character.combat.deathSaveFailures, deathSavePenalty: injuryModifiers.deathSaveModifier },
    rng,
  );
  const { diceRoll, dc, success, failuresAfter: newFailures, characterDied } = resolved;
  const newDC = resolved.state.dc;

  const entry: RollHistoryEntry = {
    id: createId(),
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
  rng?: RandomSource,
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

  const roll = rollDice("1d10", rng);
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
    id: createId(),
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
