import { rollDice, type DiceResult } from "@/lib/dice";
import type { Enemy, EnemyAttributeName, EnemySkill } from "@/types/enemy";

/** Context for an enemy attack or skill check */
export interface EnemyRollContext {
  type: "attack" | "skill_check";
  enemyId: string;
  weaponId?: string;
  skillId?: string;
  targetNumber?: number; // For skill checks
  modifiers?: AttackModifier[];
}

export interface AttackModifier {
  source: string;
  value: number;
}

export interface RollDetail {
  value: number;
  type: "normal" | "crit" | "fumble" | "crit_add" | "fumble_sub";
}

export interface EnemyAttackRollResult {
  enemyId: string;
  enemyName: string;
  attackType: "melee" | "ranged" | "thrown";
  label: string;
  roll: DiceResult;
  stat: { id: EnemyAttributeName; value: number };
  skill: { id: string; value: number; name: string };
  modifiers: AttackModifier[];
  total: number;
  weaponId?: string;
  damageDice?: string;
  naturalRoll: number;
  critical: boolean;
  fumble: boolean;
  diceRolls: RollDetail[];
  diceTotal: number;
}

export interface EnemySkillCheckResult {
  enemyId: string;
  enemyName: string;
  skillId: string;
  skillName: string;
  statId: EnemyAttributeName;
  statBase: number;
  skillLevel: number;
  roll: DiceResult;
  total: number;
  targetNumber?: number;
  success?: boolean;
  critical: boolean;
  fumble: boolean;
  diceRolls: RollDetail[];
  diceTotal: number;
  totalModifier: number;
}

export interface EnemyDamageRollResult {
  enemyId: string;
  enemyName: string;
  attackName: string;
  weaponId?: string;
  damageDice: string;
  roll: DiceResult;
  total: number;
}

/** Get available attacks for an enemy (weapons + unarmed) */
export function getAvailableEnemyAttacks(enemy: Enemy): {
  id: string;
  label: string;
  detail: string;
  context: EnemyRollContext;
}[] {
  const attacks: {
    id: string;
    label: string;
    detail: string;
    context: EnemyRollContext;
  }[] = [];

  // Weapon attacks
  for (const weapon of enemy.weapons) {
    const skill = enemy.skills[weapon.skill];
    const skillValue = skill ? enemy.stats[skill.stat] + skill.level : 0;
    const skillName = skill?.name ?? weapon.skill;

    attacks.push({
      id: weapon.id,
      label: weapon.name,
      detail: `${weapon.damage} · ${weapon.attackType} · Perícia: ${skillName} (${skillValue})`,
      context: {
        type: "attack",
        enemyId: enemy.id,
        weaponId: weapon.id,
        skillId: weapon.skill,
      },
    });
  }

  // Unarmed attack (always available)
  const brawlSkill = enemy.skills["brawling"];
  const brawlValue = brawlSkill ? enemy.stats[brawlSkill.stat] + brawlSkill.level : enemy.stats.REF;
  
  attacks.push({
    id: "unarmed",
    label: "Desarmado",
    detail: `1d6+${Math.floor(enemy.stats.BODY / 2)} · Corpo a corpo · Perícia: Brawling (${brawlValue})`,
    context: {
      type: "attack",
      enemyId: enemy.id,
      skillId: "brawling",
    },
  });

  return attacks;
}

/** Roll an enemy attack */
export function rollEnemyAttack(enemy: Enemy, context: EnemyRollContext): { result: EnemyAttackRollResult } | { error: string } {
  // Find weapon if specified
  const weapon = context.weaponId ? enemy.weapons.find((w) => w.id === context.weaponId) : null;
  
  // Determine skill
  const skillId = context.skillId ?? weapon?.skill ?? "brawling";
  const skill = enemy.skills[skillId];
  
  if (!skill) {
    return { error: `Perícia "${skillId}" não encontrada no inimigo` };
  }

  const statValue = enemy.stats[skill.stat];
  const skillValue = statValue + skill.level;

  // Roll 1d10
  const rollResult = rollDice("1d10");
  const naturalRoll = rollResult.rolls[0];
  
  // Determine critical/fumble
  const critical = naturalRoll === 10;
  const fumble = naturalRoll === 1;
  
  // Build dice rolls detail
  const diceRolls: RollDetail[] = [
    { value: naturalRoll, type: critical ? "crit" : fumble ? "fumble" : "normal" },
  ];
  
  // Handle exploding dice on critical
  let diceTotal = naturalRoll;
  if (critical) {
    let currentRoll = naturalRoll;
    while (currentRoll === 10) {
      const extraRoll = rollDice("1d10");
      currentRoll = extraRoll.rolls[0];
      diceRolls.push({ 
        value: currentRoll, 
        type: currentRoll === 10 ? "crit_add" : "normal" 
      });
      diceTotal += currentRoll;
    }
  }
  
  // Handle fumble subtraction
  if (fumble) {
    const subRoll = rollDice("1d10");
    const subValue = subRoll.rolls[0];
    diceRolls.push({ value: subValue, type: "fumble_sub" });
    diceTotal -= subValue;
  }

  // Calculate modifiers
  const modifiers = context.modifiers ?? [];
  const totalModifier = modifiers.reduce((sum, m) => sum + m.value, 0);
  
  const total = statValue + skill.level + diceTotal + totalModifier;

  // Determine damage dice
  let damageDice: string | undefined;
  if (weapon) {
    damageDice = weapon.damage;
  } else {
    // Unarmed damage: 1d6 + BODY/2
    const bodyBonus = Math.floor(enemy.stats.BODY / 2);
    damageDice = `1d6${bodyBonus > 0 ? `+${bodyBonus}` : ""}`;
  }

  const result: EnemyAttackRollResult = {
    enemyId: enemy.id,
    enemyName: enemy.identity.name,
    attackType: weapon?.attackType ?? "melee",
    label: weapon?.name ?? "Desarmado",
    roll: rollResult,
    stat: { id: skill.stat, value: statValue },
    skill: { id: skillId, value: skillValue, name: skill.name },
    modifiers,
    total,
    weaponId: weapon?.id,
    damageDice,
    naturalRoll,
    critical,
    fumble,
    diceRolls,
    diceTotal,
  };

  return { result };
}

/** Roll an enemy skill check */
export function rollEnemySkillCheck(enemy: Enemy, context: EnemyRollContext): { result: EnemySkillCheckResult } | { error: string } {
  const skillId = context.skillId;
  if (!skillId) {
    return { error: "Skill ID é obrigatório para teste de perícia" };
  }

  const skill = enemy.skills[skillId];
  if (!skill) {
    return { error: `Perícia "${skillId}" não encontrada no inimigo` };
  }

  const statValue = enemy.stats[skill.stat];
  const skillValue = statValue + skill.level;

  // Roll 1d10
  const rollResult = rollDice("1d10");
  const naturalRoll = rollResult.rolls[0];
  
  const critical = naturalRoll === 10;
  const fumble = naturalRoll === 1;
  
  const diceRolls: RollDetail[] = [
    { value: naturalRoll, type: critical ? "crit" : fumble ? "fumble" : "normal" },
  ];
  
  let diceTotal = naturalRoll;
  if (critical) {
    let currentRoll = naturalRoll;
    while (currentRoll === 10) {
      const extraRoll = rollDice("1d10");
      currentRoll = extraRoll.rolls[0];
      diceRolls.push({ 
        value: currentRoll, 
        type: currentRoll === 10 ? "crit_add" : "normal" 
      });
      diceTotal += currentRoll;
    }
  }
  
  if (fumble) {
    const subRoll = rollDice("1d10");
    const subValue = subRoll.rolls[0];
    diceRolls.push({ value: subValue, type: "fumble_sub" });
    diceTotal -= subValue;
  }

  const modifiers = context.modifiers ?? [];
  const totalModifier = modifiers.reduce((sum, m) => sum + m.value, 0);
  
  const total = skillValue + diceTotal + totalModifier;
  const success = context.targetNumber !== undefined ? total >= context.targetNumber : undefined;

  const result: EnemySkillCheckResult = {
    enemyId: enemy.id,
    enemyName: enemy.identity.name,
    skillId,
    skillName: skill.name,
    statId: skill.stat,
    statBase: statValue,
    skillLevel: skill.level,
    roll: rollResult,
    total,
    targetNumber: context.targetNumber,
    success,
    critical,
    fumble,
    diceRolls,
    diceTotal,
    totalModifier,
  };

  return { result };
}

/** Roll enemy damage */
export function rollEnemyDamage(enemy: Enemy, damageDice: string, attackName: string, weaponId?: string): { result: EnemyDamageRollResult } | { error: string } {
  try {
    const rollResult = rollDice(damageDice);
    const result: EnemyDamageRollResult = {
      enemyId: enemy.id,
      enemyName: enemy.identity.name,
      attackName,
      weaponId,
      damageDice,
      roll: rollResult,
      total: rollResult.total,
    };
    return { result };
  } catch (error) {
    return { error: `Expressão de dano inválida: ${damageDice}` };
  }
}