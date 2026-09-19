import type { AttributeName } from "@/types/character";
import type { DiceResult } from "@/lib/dice";

export type AttackType = "melee" | "martial_arts" | "handgun" | "smg" | "rifle" | "shotgun" | "sniper" | "heavy_weapon" | "thrown_weapon" | "grenade" | "exotic_weapon" | "weapon" | "unarmed";
export type AttackModifier = { source: string; value: number };
export type AttackContext = { type: AttackType; weaponId?: string; skillId?: string; modifiers?: AttackModifier[] };
export type AvailableAttack = { id: string; label: string; detail: string; context: AttackContext; source: "weapon" | "skill" };
export type AttackRollResult = { attackType: AttackType; label: string; roll: DiceResult; stat: { id: AttributeName; value: number }; skill: { id: string; value: number }; modifiers: AttackModifier[]; total: number; weaponId?: string; naturalRoll: number; critical: "critical_success" | "critical_failure" | null };