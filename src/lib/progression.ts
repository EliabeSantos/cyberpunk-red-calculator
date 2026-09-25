import { PROGRESSION_RULES } from "@/data/progression";
import { MARTIAL_ARTS_FORMS } from "@/data/skills";
import type { Character } from "@/types/character";

export function getSkillUpgradeCost(
  currentLevel: number,
  costMultiplier: 1 | 2 = 1,
): number {
  return (
    (currentLevel + 1) *
    PROGRESSION_RULES.skillUpgradeCostPerLevel *
    costMultiplier
  );
}

/** Especialização de Martial Arts (Karate/Taekwondo/Judo/Aikido) é filha da perícia-mãe:
 * não se compra com IP, e cada nível custa 1 ponto a mais — 1, 2, 3… */
export function getSpecializationCost(currentLevel: number): number {
  return currentLevel + 1;
}

/** Bolso único de pontos de Martial Arts: os níveis da perícia-mãe geram 1 ponto cada,
 * e o mesmo bolso paga as especializações e o desbloqueio dos Special Moves. */
export interface MartialArtsPoints {
  /** Total já ganho (= nível de Martial Arts). */
  total: number;
  /** Gasto em especializações (1 + 2 + … + nível, somado nas 4 formas). */
  spentSpecializations: number;
  /** Gasto em Special Moves desbloqueados (1 ponto cada). */
  spentMoves: number;
  /** Pontos gastáveis agora (nunca negativo). */
  free: number;
  /** Saldo real: negativo = especializações já pagas com IP antigo acima do que a mãe cobre. */
  balance: number;
}

export function getMartialArtsPoints(
  character: Pick<Character, "skills" | "unlockedSpecialMoves">,
): MartialArtsPoints {
  const total = Math.max(0, character.skills.martial_arts?.level ?? 0);
  const spentSpecializations = MARTIAL_ARTS_FORMS.reduce((sum, { skillId }) => {
    const level = Math.max(0, character.skills[skillId]?.level ?? 0);
    return sum + (level * (level + 1)) / 2;
  }, 0);
  const spentMoves = Math.max(0, character.unlockedSpecialMoves?.length ?? 0);
  const balance = total - spentSpecializations - spentMoves;
  return {
    total,
    spentSpecializations,
    spentMoves,
    free: Math.max(0, balance),
    balance,
  };
}

export function canUpgradeSpecialization(
  character: Pick<Character, "skills" | "unlockedSpecialMoves">,
  skillId: string,
): boolean {
  const skill = character.skills[skillId];
  if (!skill || !MARTIAL_ARTS_FORMS.some((entry) => entry.skillId === skillId))
    return false;
  if (skill.level >= PROGRESSION_RULES.maximumSkillLevel) return false;
  const points = getMartialArtsPoints(character);
  return points.free >= getSpecializationCost(skill.level);
}

export function upgradeSpecialization(
  character: Character,
  skillId: string,
): Character | null {
  const skill = character.skills[skillId];
  if (!skill || !MARTIAL_ARTS_FORMS.some((entry) => entry.skillId === skillId))
    return null;
  if (!canUpgradeSpecialization(character, skillId)) return null;
  return {
    ...character,
    skills: {
      ...character.skills,
      [skillId]: { ...skill, level: skill.level + 1 },
    },
  };
}
export function canUpgradeSkill(
  character: Character,
  skillId: string,
  availableIP = character.ip,
): boolean {
  const skill = character.skills[skillId];
  return Boolean(
    skill &&
    skill.level < PROGRESSION_RULES.maximumSkillLevel &&
    availableIP >= getSkillUpgradeCost(skill.level, skill.costMultiplier),
  );
}
export function upgradeSkill(
  character: Character,
  skillId: string,
): Character | null {
  if (!canUpgradeSkill(character, skillId)) return null;
  const skill = character.skills[skillId];
  const cost = getSkillUpgradeCost(skill.level, skill.costMultiplier);
  return {
    ...character,
    ip: character.ip - cost,
    skills: {
      ...character.skills,
      [skillId]: { ...skill, level: skill.level + 1 },
    },
    progression: { improvementPoints: character.ip - cost },
  };
}
export function grantImprovementPoints(
  character: Character,
  amount: number,
): Character {
  return amount > 0
    ? {
        ...character,
        ip: character.ip + amount,
        progression: { improvementPoints: character.ip + amount },
      }
    : character;
}
