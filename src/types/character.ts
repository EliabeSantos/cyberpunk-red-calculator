import { createDefaultSkills } from "@/data/skills";
import { calculateMaximumHitPoints, calculateMaximumHumanity } from "@/lib/calculations";

export const statNames = ["INT", "REF", "DEX", "TECH", "COOL", "WILL", "LUCK", "MOVE", "BODY", "EMP"] as const;
export type AttributeName = (typeof statNames)[number];
/** Compatibilidade de tipo para módulos externos; no personagem o campo é sempre `stats`. */
export type Attributes = Stats;
export type Stats = Record<AttributeName, number>;
export interface CharacterIdentity { name: string; player: string; role: string; level: number; photoUrl?: string; }
export interface Skill { name: string; stat: AttributeName; category: import("@/data/skills").SkillCategory; costMultiplier: 1 | 2; level: number; base: number; specialization?: string; }
export type Skills = Record<string, Skill>;
export interface CombatStats { hp: { current: number; max: number }; stamina: { current: number; max: number }; armor: { head: number; body: number }; criticalInjuries: string[]; }
export interface Weapon { id: string; catalogItemId?: string; name: string; damage: string; rateOfFire?: number; magazine?: number; ammo?: number; skill?: string; attackType?: import("@/types/attack").AttackType; }
export interface CyberwareItem { id: string; name: string; humanityLoss?: string; installedAt: string; }
export interface InventoryItem { id: string; name: string; quantity: number; category?: string; catalogItemId?: string; notes?: string; }
export interface Progression { improvementPoints: number; }
export interface Wallet { eurodollars: number; }
export interface RollHistoryEntry { id: string; type: "humanity_loss" | "attack" | "damage"; label: string; characterId: string; expression: string; rolls: number[]; total: number; timestamp: string; cyberwareId?: string; cyberwareName?: string; humanityBefore?: number; humanityAfter?: number; attackType?: import("@/types/attack").AttackType; weaponId?: string; attackId?: string; damageDice?: string; stat?: { id: AttributeName; value: number }; skill?: { id: string; value: number }; modifiers?: import("@/types/attack").AttackModifier[]; }
export interface Character { id: string; schemaVersion: 2; createdAt: string; updatedAt: string; identity: CharacterIdentity; stats: Stats; skills: Skills; progression: Progression; wallet: Wallet; rollHistory: RollHistoryEntry[]; lastAttack?: import("@/types/attack").AttackRollResult; lastDamage?: import("@/types/attack").DamageRollResult; combat: CombatStats; humanity: { current: number; max: number }; luck: { current: number; max: number }; weapons: Weapon[]; cyberware: CyberwareItem[]; inventory: InventoryItem[]; }
const defaultStats: Stats = { INT: 0, REF: 0, DEX: 0, TECH: 0, COOL: 0, WILL: 0, LUCK: 0, MOVE: 0, BODY: 0, EMP: 0 };
export function createEmptyCharacter(id = crypto.randomUUID()): Character { const now = new Date().toISOString(); const stats = { ...defaultStats }; return { id, schemaVersion: 2, createdAt: now, updatedAt: now, identity: { name: "", player: "", role: "", level: 1 }, stats, skills: createDefaultSkills(stats), progression: { improvementPoints: 0 }, wallet: { eurodollars: 0 }, rollHistory: [], combat: { hp: { current: calculateMaximumHitPoints(stats), max: calculateMaximumHitPoints(stats) }, stamina: { current: 0, max: 0 }, armor: { head: 0, body: 0 }, criticalInjuries: [] }, humanity: { current: calculateMaximumHumanity(stats), max: calculateMaximumHumanity(stats) }, luck: { current: 0, max: 0 }, weapons: [], cyberware: [], inventory: [] }; }