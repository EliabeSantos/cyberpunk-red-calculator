import { rollDice } from "@/lib/dice";
import type { AttackContext, AttackRollResult, AvailableAttack } from "@/types/attack";
import type { Character, RollHistoryEntry } from "@/types/character";


/** Descobre ataques a partir de armas E de perícias, sem depender da UI. */
export function getAvailableAttacks(character: Character): AvailableAttack[] {
  const weaponAttacks: AvailableAttack[] = character.weapons
    .filter((weapon) => weapon.attackType && weapon.skill)
    .map((weapon) => ({ id: `weapon:${weapon.id}`, label: weapon.name, detail: `${weapon.skill} + 1d10`, source: "weapon", context: { type: "weapon", weaponId: weapon.id } }));
  const martialArts = character.skills.martial_arts;
  const skillAttacks: AvailableAttack[] = martialArts && martialArts.level > 0
    ? [{ id: "skill:martial_arts", label: martialArts.name, detail: `${martialArts.stat} + ${martialArts.name} + 1d10`, source: "skill", context: { type: "martial_arts", skillId: "martial_arts" } }]
    : [];
  return [...weaponAttacks, ...skillAttacks];
}

function getAttackLabel(type: AttackContext["type"]): string {
  return type === "martial_arts" ? "Artes Marciais" : type === "unarmed" ? "Ataque Desarmado" : "Ataque";
}
export type AttackResolution = { character: Character; result: AttackRollResult } | { error: string };

/** Resolve apenas a rolagem para acertar, sem calcular dano ou DV. */
export function rollAttack(character: Character, context: AttackContext): AttackResolution {
  const modifiers = context.modifiers ?? [];
  let skillId = context.skillId; let label = getAttackLabel(context.type); let weaponId = context.weaponId; let attackType = context.type; let damageDice: string | undefined;
  if (context.weaponId) {
    const weapon = character.weapons.find((item) => item.id === context.weaponId);
    if (!weapon) return { error: "Arma não encontrada." };
    if (!weapon.attackType || !weapon.skill) return { error: `${weapon.name} não possui perfil de ataque configurado.` };
    skillId = weapon.skill; label = weapon.name; weaponId = weapon.id; attackType = weapon.attackType; damageDice = weapon.damage || undefined;
  }
  if (!skillId) return { error: "Nenhuma perícia de ataque foi definida." };
  const skill = character.skills[skillId];
  if (!skill) return { error: `A perícia de ataque "${skillId}" não existe na ficha.` };
  const roll = rollDice("1d10"); const modifierTotal = modifiers.reduce((total, modifier) => total + modifier.value, 0);
  const naturalRoll = roll.rolls[0]; const result: AttackRollResult = { attackId: crypto.randomUUID(), attackType, label, roll, stat: { id: skill.stat, value: character.attributes[skill.stat] }, skill: { id: skillId, value: skill.level }, modifiers, total: roll.total + character.attributes[skill.stat] + skill.level + modifierTotal, weaponId, damageDice, naturalRoll, critical: naturalRoll === 10 ? "critical_success" : naturalRoll === 1 ? "critical_failure" : null };
  const entry: RollHistoryEntry = { id: crypto.randomUUID(), type: "attack", label, characterId: character.id, expression: roll.expression, rolls: roll.rolls, total: result.total, timestamp: new Date().toISOString(), attackId: result.attackId, attackType: result.attackType, weaponId, damageDice, stat: result.stat, skill: result.skill, modifiers };
  return { character: { ...character, lastAttack: result, rollHistory: [entry, ...character.rollHistory] }, result };
}