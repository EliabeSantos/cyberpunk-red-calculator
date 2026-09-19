import { armorSlotForLocation, type HitLocation } from "@/types/combat";
import { rollDice } from "@/lib/dice";
import type { AttackRollResult, DamageRollResult } from "@/types/attack";
import type { Character, RollHistoryEntry } from "@/types/character";
export type DamageResolution = { character: Character; result: DamageRollResult } | { error: string };
export function rollDamage(attack: AttackRollResult): DamageRollResult | { error: string } { if (!attack.damageDice) return { error: `${attack.label} não possui uma rolagem de dano definida.` }; const roll = rollDice(attack.damageDice); return { attackId: attack.attackId, attackName: attack.label, weaponId: attack.weaponId, damageDice: attack.damageDice, roll, total: roll.total }; }
export function rollDamageForLastAttack(character: Character): DamageResolution { if (!character.lastAttack) return { error: "Nenhum ataque válido foi realizado." }; const result = rollDamage(character.lastAttack); if ("error" in result) return result; const entry: RollHistoryEntry = { id: crypto.randomUUID(), type: "damage", label: result.attackName, characterId: character.id, expression: result.damageDice, rolls: result.roll.rolls, total: result.total, timestamp: new Date().toISOString(), attackId: result.attackId, weaponId: result.weaponId }; return { character: { ...character, lastDamage: result, rollHistory: [entry, ...character.rollHistory] }, result }; }
/** Applies manual incoming damage through the current head/body armor values. */
export function applyReceivedDamage(character: Character, amount: number, hitLocation: HitLocation = "body"): { character: Character; hpBefore: number; hpAfter: number; armorSPBefore: number; armorSPAfter: number; damageAbsorbed: number; damageToHP: number } | { error: string } {
  if (!Number.isInteger(amount) || amount <= 0) return { error: "Dano inválido." };
  const slot = armorSlotForLocation(hitLocation); const armorSPBefore = character.combat.armor[slot] ?? 0;
  const damageAbsorbed = Math.min(amount, armorSPBefore); const damageToHP = Math.max(0, amount - armorSPBefore);
  const armorSPAfter = damageToHP > 0 ? Math.max(0, armorSPBefore - 1) : armorSPBefore;
  const hpBefore = character.combat.hp.current; const hpAfter = Math.max(0, hpBefore - damageToHP);
  const entry: RollHistoryEntry = { id: crypto.randomUUID(), type: "received_damage", label: "Dano recebido", characterId: character.id, expression: String(amount), rolls: [], total: amount, timestamp: new Date().toISOString(), amount, hitLocation, armorSPBefore, armorSPAfter, damageAbsorbed, damageToHP, hpBefore, hpAfter };
  return { character: { ...character, combat: { ...character.combat, armor: { ...character.combat.armor, [slot]: armorSPAfter }, hp: { ...character.combat.hp, current: hpAfter } }, rollHistory: [entry, ...character.rollHistory] }, hpBefore, hpAfter, armorSPBefore, armorSPAfter, damageAbsorbed, damageToHP };
}