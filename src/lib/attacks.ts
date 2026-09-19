import { rollDice } from "@/lib/dice";
import type { AttackContext, AttackRollResult } from "@/types/attack";
import type { Character, RollHistoryEntry } from "@/types/character";

export type AttackResolution = { character: Character; result: AttackRollResult } | { error: string };

/** Resolve apenas a rolagem para acertar, sem calcular dano ou DV. */
export function rollAttack(character: Character, context: AttackContext): AttackResolution {
  const modifiers = context.modifiers ?? [];
  let skillId = context.skillId; let label = "Ataque"; let weaponId = context.weaponId; let attackType = context.type;
  if (context.weaponId) {
    const weapon = character.weapons.find((item) => item.id === context.weaponId);
    if (!weapon) return { error: "Arma não encontrada." };
    if (!weapon.attackType || !weapon.skill) return { error: `${weapon.name} não possui perfil de ataque configurado.` };
    skillId = weapon.skill; label = weapon.name; weaponId = weapon.id; attackType = weapon.attackType;
  }
  if (!skillId) return { error: "Nenhuma perícia de ataque foi definida." };
  const skill = character.skills[skillId];
  if (!skill) return { error: `A perícia de ataque "${skillId}" não existe na ficha.` };
  const roll = rollDice("1d10"); const modifierTotal = modifiers.reduce((total, modifier) => total + modifier.value, 0);
  const naturalRoll = roll.rolls[0]; const result: AttackRollResult = { attackType, label, roll, stat: { id: skill.stat, value: character.attributes[skill.stat] }, skill: { id: skillId, value: skill.level }, modifiers, total: roll.total + character.attributes[skill.stat] + skill.level + modifierTotal, weaponId, naturalRoll, critical: naturalRoll === 10 ? "critical_success" : naturalRoll === 1 ? "critical_failure" : null };
  const entry: RollHistoryEntry = { id: crypto.randomUUID(), type: "attack", label, characterId: character.id, expression: roll.expression, rolls: roll.rolls, total: result.total, timestamp: new Date().toISOString(), attackType: result.attackType, weaponId, stat: result.stat, skill: result.skill, modifiers };
  return { character: { ...character, rollHistory: [entry, ...character.rollHistory] }, result };
}