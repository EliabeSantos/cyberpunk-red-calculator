import type { AttributeName } from "@/types/character";
import type { HitLocation } from "@/types/combat";
import type { CriticalInjury } from "@/data/criticalInjuries";

export const enemyStatNames = ["INT", "REF", "DEX", "TECH", "COOL", "WILL", "LUCK", "MOVE", "BODY", "EMP"] as const;
export type EnemyAttributeName = (typeof enemyStatNames)[number];
export type EnemyStats = Record<EnemyAttributeName, number>;

export interface EnemyIdentity {
  name: string;
  archetype: string; // Ex: "Gang Member", "Corporate Security", "Cyberpsycho", etc.
  threatLevel: "low" | "medium" | "high" | "extreme";
  faction?: string;
  role?: string;
  description?: string;
}

export interface EnemySkill {
  name: string;
  stat: EnemyAttributeName;
  level: number;
  specialization?: string;
}
export type EnemySkills = Record<string, EnemySkill>;

export interface EnemyWeapon {
  id: string;
  name: string;
  damage: string;
  attackType: "melee" | "ranged" | "thrown";
  skill: string; // skill ID used for this weapon
  rateOfFire?: number;
  magazine?: number;
  ammo?: number;
}

export interface EnemyArmor {
  head: number;
  body: number;
}

export interface EnemyCombatStats {
  hp: { current: number; max: number };
  armor: EnemyArmor;
  criticalInjuries: CriticalInjury[];
}

export interface Enemy {
  id: string;
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
  identity: EnemyIdentity;
  stats: EnemyStats;
  skills: EnemySkills;
  weapons: EnemyWeapon[];
  combat: EnemyCombatStats;
  // GM notes, only visible to GM
  gmNotes?: string;
  // Conditions/Status effects
  conditions: EnemyCondition[];
}

export interface EnemyCondition {
  id: string;
  name: string;
  description?: string;
  // Mechanical modifiers
  statModifiers?: Partial<EnemyStats>;
  skillModifiers?: Record<string, number>;
  // Duration tracking
  duration?: number; // in rounds, null = permanent until removed
  source?: string; // what caused this condition
}

const defaultEnemyStats: EnemyStats = {
  INT: 3,
  REF: 3,
  DEX: 3,
  TECH: 3,
  COOL: 3,
  WILL: 3,
  LUCK: 0,
  MOVE: 3,
  BODY: 3,
  EMP: 3,
};

function calculateEnemyMaxHP(stats: EnemyStats): number {
  // Same formula as characters: BODY + WILL
  return stats.BODY + stats.WILL;
}

export function createEmptyEnemy(id = crypto.randomUUID()): Enemy {
  const now = new Date().toISOString();
  const stats = { ...defaultEnemyStats };
  const maxHP = calculateEnemyMaxHP(stats);
  return {
    id,
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    identity: {
      name: "",
      archetype: "",
      threatLevel: "low",
      description: "",
    },
    stats,
    skills: {},
    weapons: [],
    combat: {
      hp: { current: maxHP, max: maxHP },
      armor: { head: 0, body: 0 },
      criticalInjuries: [],
    },
    gmNotes: "",
    conditions: [],
  };
}

export function calculateEnemySkillBase(enemy: Enemy, skillId: string): number {
  const skill = enemy.skills[skillId];
  if (!skill) return 0;
  return enemy.stats[skill.stat] + skill.level;
}

export function getEnemyArmorForLocation(enemy: Enemy, location: HitLocation): number {
  return location === "head" ? enemy.combat.armor.head : enemy.combat.armor.body;
}