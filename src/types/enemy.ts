import { normalizeSkillId } from "@/data/skills";
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
  attackBase: number; // pre-calculated STAT + WeaponSkill
  rateOfFire?: number;
  /** Capacidade do pente. Ausente em arma corpo a corpo e em fichas antigas. */
  magazine?: number;
  /** Balas no pente AGORA — começa igual a `magazine` e desce a cada tiro. */
  ammo?: number;
  requiresTwoHands?: boolean;
}

/**
 * Item da mochila de um inimigo: munição para recarregar, cura e utilidades.
 * O formato é o mesmo do `inventory` do JSON do bestiário.
 */
export interface EnemySupply {
  item: string;
  quantity: number;
  /**
   * F1.13.2 — identidade estável do item (catálogo do jogador ou slug
   * determinístico). Ausente em dados antigos: use `resolveSupplyItemId`.
   */
  itemId?: string;
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
  /**
   * Implantes (cyberware) vindos do catálogo JSON — lista de nomes que serve de
   * base aos implantes do encontro (`src/data/enemyImplants.ts`) e que **entra
   * nas rolagens** de quem os tem (`src/lib/enemyCyberware.ts`). Opcional nas
   * fichas salvas antes desta feature.
   */
  cyberware?: string[];
  /**
   * Mochila vinda do JSON do bestiário (munição, cura, utilidades) — é a base
   * da mochila do encontro (`getEnemySupplies`), que garante munição e sorteia
   * cura. Opcional nas fichas salvas antes desta feature e em inimigo criado
   * à mão no editor.
   */
  inventory?: EnemySupply[];
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
    cyberware: [],
    inventory: [],
    gmNotes: "",
    conditions: [],
  };
}

/**
 * Lookup da perícia do inimigo — o caminho único para ler `enemy.skills`.
 *
 * Aceita o id canônico (`handgun`), o rótulo do bestiário ("Handgun") e a
 * chave legada em caixa mista, porque o catálogo migrou para o id da ficha sem
 * deixar de entender fichas gravadas antes da normalização.
 */
export function getEnemySkill(skills: EnemySkills, skillId: string): EnemySkill | undefined {
  const direct = skills[skillId];
  if (direct) return direct;

  const canonical = normalizeSkillId(skillId);
  const byCanonicalKey = skills[canonical];
  if (byCanonicalKey) return byCanonicalKey;

  return Object.entries(skills).find(([key]) => normalizeSkillId(key) === canonical)?.[1];
}

/**
 * Chave de uma perícia recém-criada no formulário do GM: o id canônico do
 * rótulo escolhido (`handgun`) ou, para a personalizada sem nome, uma chave
 * estável. É a MESMA regra que `addSkill` aplica — `name` continua sendo o
 * rótulo que a UI mostra.
 */
export function newEnemySkillId(predefinedName?: string): string {
  return predefinedName ? normalizeSkillId(predefinedName) : `skill_${Date.now()}`;
}

/**
 * Leva `skills` (chaves) e `weapons[].skill` para o id canônico da ficha.
 *
 * Só a CHAVE muda: `skill.name` continua sendo o rótulo visível ("Handgun").
 * Duas entradas que colidem no mesmo id não se juntam — fica a primeira.
 */
export function withCanonicalSkillIds(enemy: Enemy): Enemy {
  const skills: EnemySkills = {};
  let skillsChanged = false;
  for (const [key, skill] of Object.entries(enemy.skills ?? {})) {
    const id = normalizeSkillId(key);
    if (id !== key) skillsChanged = true;
    if (Object.hasOwn(skills, id)) continue;
    skills[id] = skill;
  }

  let weaponsChanged = false;
  const weapons = (enemy.weapons ?? []).map((weapon) => {
    const skill = normalizeSkillId(weapon.skill ?? "");
    if (skill === weapon.skill) return weapon;
    weaponsChanged = true;
    return { ...weapon, skill };
  });

  if (!skillsChanged && !weaponsChanged) return enemy;
  return { ...enemy, skills, weapons };
}

export function calculateEnemySkillBase(enemy: Enemy, skillId: string): number {
  const skill = getEnemySkill(enemy.skills, skillId);
  if (!skill) return 0;
  return enemy.stats[skill.stat] + skill.level;
}

export function getEnemyArmorForLocation(enemy: Enemy, location: HitLocation): number {
  return location === "head" ? enemy.combat.armor.head : enemy.combat.armor.body;
}
