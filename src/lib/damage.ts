import { rollDice } from "@/lib/dice";
import type { AttackRollResult, DamageRollResult } from "@/types/attack";
import type { Character, RollHistoryEntry } from "@/types/character";

export type DamageResolution = { character: Character; result: DamageRollResult } | { error: string };

/** Rola dano a partir de um ataque válido; nunca decide acerto nem aplica HP. */
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