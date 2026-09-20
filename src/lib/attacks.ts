import { getSkillBase, getCriticalInjuryModifiers } from "@/lib/calculations";
import { rollDice } from "@/lib/dice";
import type {
  AttackContext,
  AttackRollResult,
  AvailableAttack,
  AttackModifier,
} from "@/types/attack";
import type { Character, RollHistoryEntry } from "@/types/character";

/** Descobre ataques a partir de armas E de perícias, sem depender da UI. */
export function getAvailableAttacks(character: Character): AvailableAttack[] {
  const weaponAttacks: AvailableAttack[] = character.weapons
    .filter((weapon) => weapon.attackType && weapon.skill)
    .map((weapon) => ({
      id: `weapon:${weapon.id}`,
      label: weapon.name,
      detail: `${weapon.skill} + 1d10`,
      source: "weapon",
      context: { type: "weapon", weaponId: weapon.id },
    }));
  const martialArts = character.skills.martial_arts;
  const brawling = character.skills.brawling;
  const skillAttacks: AvailableAttack[] =
    martialArts && martialArts.level > 0
      ? [
          {
            id: "skill:martial_arts",
            label: martialArts.name,
            detail: `${martialArts.stat} + ${martialArts.name} + 1d10`,
            source: "skill",
            context: { type: "martial_arts", skillId: "martial_arts" },
          },
        ]
      : [];
  const brawlingAttack: AvailableAttack[] = brawling && brawling.level > 0 ? [{ id: "skill:brawling", label: brawling.name, detail: `${brawling.stat} + ${brawling.name} + 1d10`, source: "skill", context: { type: "brawling", skillId: "brawling" } }] : [];
  return [...weaponAttacks, ...skillAttacks, ...brawlingAttack];
}

function getAttackLabel(type: AttackContext["type"]): string {
  return type === "martial_arts"
    ? "Artes Marciais"
    : type === "brawling" ? "Brawling"
    : type === "unarmed"
      ? "Ataque Desarmado"
      : "Ataque";
}
export type AttackResolution =
  | { character: Character; result: AttackRollResult }
  | { error: string };

/** Resolve apenas a rolagem para acertar, sem calcular dano ou DV. */
export function rollAttack(
  character: Character,
  context: AttackContext,
): AttackResolution {
  const modifiers = context.modifiers ?? [];
  let skillId = context.skillId;
  let label = getAttackLabel(context.type);
  let weaponId = context.weaponId;
  let attackType = context.type;
  let damageDice: string | undefined;
  if (context.type === "brawling") damageDice = "1d6";
  if (context.type === "martial_arts") damageDice = "2d6";
  if (context.weaponId) {
    const weapon = character.weapons.find(
      (item) => item.id === context.weaponId,
    );
    if (!weapon) return { error: "Arma não encontrada." };
    if (!weapon.attackType || !weapon.skill)
      return {
        error: `${weapon.name} não possui perfil de ataque configurado.`,
      };
    skillId = weapon.skill;
    label = weapon.name;
    weaponId = weapon.id;
    attackType = weapon.attackType;
    damageDice = weapon.damage || undefined;
  }
  if (!skillId) return { error: "Nenhuma perícia de ataque foi definida." };
  const skill = character.skills[skillId];
  if (!skill)
    return { error: `A perícia de ataque "${skillId}" não existe na ficha.` };

  // Calcula modificadores de Critical Injuries
  const injuryModifiers = getCriticalInjuryModifiers(character);
  
  // Determina se é ataque à distância ou corpo a corpo
  const isRanged = ["archery", "autofire", "handgun", "heavy_weapons", "shoulder_arms", "rifle", "sniper", "shotgun", "thrown_weapon", "grenade"].includes(context.type as string);
  const isMelee = ["melee", "martial_arts", "brawling", "unarmed"].includes(context.type as string);
  
  // Calcula modificadores de Critical Injury aplicáveis ao ataque
  const attackModifiers: AttackModifier[] = [...context.modifiers ?? []];
  
  if (injuryModifiers.rangedModifier !== 0 && isRanged) {
    attackModifiers.push({ source: "Distância (lesão)", value: injuryModifiers.rangedModifier });
  }
  if (injuryModifiers.meleeModifier !== 0 && isMelee) {
    attackModifiers.push({ source: "Corpo a corpo (lesão)", value: injuryModifiers.meleeModifier });
  }
  if (injuryModifiers.allPhysicalModifier !== 0) {
    attackModifiers.push({ source: "Físico (lesão)", value: injuryModifiers.allPhysicalModifier });
  }
  if (injuryModifiers.allActionsModifier !== 0) {
    attackModifiers.push({ source: "Todas ações (lesão)", value: injuryModifiers.allActionsModifier });
  }
  if (injuryModifiers.twoHandedModifier !== 0) {
    attackModifiers.push({ source: "Duas mãos (lesão)", value: injuryModifiers.twoHandedModifier });
  }
  if (injuryModifiers.statModifiers[skill.stat]) {
    attackModifiers.push({ source: "STAT (lesão)", value: injuryModifiers.statModifiers[skill.stat] });
  }
  
  const injuryModifierTotal = attackModifiers
    .filter(m => m.source !== undefined)
    .reduce((total, modifier) => total + (modifier.value || 0), 0);

  const attackRoll = rollDice("1d10");
  const naturalRoll = attackRoll.rolls[0];
  
  // Calcula o total do STAT com modificadores de lesão
  const statValue = character.stats[skill.stat];
  const statModifier = injuryModifiers.statModifiers[skill.stat] || 0;
  const modifiedStatValue = statValue + statModifier;
  
  const modifierTotal = modifiers.reduce(
    (total, modifier) => total + modifier.value,
    0,
  );

  const result: AttackRollResult = {
    attackId: crypto.randomUUID(),
    attackType,
    label,
    roll: rollDice("1d10"),
    stat: { id: skill.stat, value: character.stats[skill.stat] + (injuryModifiers.statModifiers[skill.stat] || 0) },
    skill: { id: skillId, value: skill.level },
    modifiers: attackModifiers,
    total: rollDice("1d10").total + getSkillBase(character, skillId) + modifierTotal + injuryModifiers.allPhysicalModifier + injuryModifiers.allActionsModifier + statModifier + (injuryModifiers.rangedModifier || 0) + (injuryModifiers.meleeModifier || 0) + injuryModifiers.twoHandedModifier,
    weaponId,
    damageDice,
    naturalRoll: rollDice("1d10").rolls[0],
    critical:
      rollDice("1d10").rolls[0] === 10
        ? "critical_success"
        : rollDice("1d10").rolls[0] === 1
          ? "critical_failure"
          : null,
  };
  const entry: RollHistoryEntry = {
    id: crypto.randomUUID(),
    type: "attack",
    label,
    characterId: character.id,
    expression: rollDice("1d10").expression,
    rolls: rollDice("1d10").rolls,
    total: result.total,
    timestamp: new Date().toISOString(),
    attackId: result.attackId,
    attackType: result.attackType,
    weaponId,
    damageDice,
    stat: result.stat,
    skill: result.skill,
    modifiers: attackModifiers,
  };
  return {
    character: {
      ...character,
      lastAttack: result,
      rollHistory: [entry, ...character.rollHistory],
    },
    result,
  };
}

/** Defensive skill test. It shares Skill Base and dice rules, but is never an attack. */
export function rollEvasion(character: Character, modifiers: import("@/types/attack").AttackModifier[] = []): { character: Character; result: import("@/types/attack").EvasionRollResult } | { error: string } {
  const skill = character.skills.evasion;
  if (!skill) return { error: "A perícia Evasion não existe na ficha." };
  const roll = rollDice("1d10");
  
  // Aplica modificadores de Critical Injury
  const injuryModifiers = getCriticalInjuryModifiers(character);
  const injuryModifierTotal = injuryModifiers.allPhysicalModifier + injuryModifiers.allActionsModifier + (injuryModifiers.statModifiers[skill.stat] || 0);
  
  const total = roll.total + getSkillBase(character, "evasion") + modifiers.reduce((sum, item) => sum + item.value, 0) + injuryModifierTotal;
  const result = { evasionId: crypto.randomUUID(), roll, stat: { id: skill.stat, value: character.stats[skill.stat] }, skill: { id: "evasion" as const, value: skill.level }, skillBase: getSkillBase(character, "evasion"), modifiers, total, naturalRoll: roll.rolls[0] };
  const entry: RollHistoryEntry = { id: crypto.randomUUID(), type: "evasion", label: "Evasion", characterId: character.id, expression: roll.expression, rolls: roll.rolls, total, timestamp: new Date().toISOString(), stat: { id: skill.stat, value: character.stats[skill.stat] }, skill: { id: "evasion", value: skill.level }, modifiers };
  return { character: { ...character, rollHistory: [entry, ...character.rollHistory] }, result };
}