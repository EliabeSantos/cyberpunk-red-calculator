import type { AttributeName } from "@/types/character";
import type { DiceResult } from "@/lib/dice";

export type AttackType = "melee" | "martial_arts" | "handgun" | "smg" | "rifle" | "shotgun" | "sniper" | "heavy_weapon" | "thrown_weapon" | "grenade" | "exotic_weapon" | "weapon" | "unarmed" | "brawling";
export type AttackModifier = { source: string; value: number };
export type AttackMode = "normal" | "autofire" | "suppressive" | "aimed";
export type AttackContext = { type: AttackType; weaponId?: string; skillId?: string; modifiers?: AttackModifier[]; attackMode?: AttackMode };
export type AvailableAttack = { id: string; label: string; detail: string; context: AttackContext; source: "weapon" | "skill" };
export interface RollDetail { value: number; type: "normal" | "crit" | "fumble" | "crit_add" | "fumble_sub"; }
export type AttackRollResult = { attackId: string; attackType: AttackType; label: string; roll: DiceResult; stat: { id: AttributeName; value: number }; skill: { id: string; value: number }; modifiers: AttackModifier[]; total: number; weaponId?: string; damageDice?: string; naturalRoll: number; critical: boolean; fumble: boolean; diceRolls: RollDetail[]; diceTotal: number; };
export type EvasionRollResult = { evasionId: string; roll: DiceResult; stat: { id: AttributeName; value: number }; skill: { id: "evasion"; value: number }; skillBase: number; modifiers: AttackModifier[]; total: number; naturalRoll: number; critical: boolean; fumble: boolean; diceRolls: RollDetail[]; diceTotal: number; };
export type DamageRollResult = { attackId: string; attackName: string; weaponId?: string; damageDice: string; roll: DiceResult; total: number };