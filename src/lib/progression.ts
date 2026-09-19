import { PROGRESSION_RULES } from "@/data/progression";
import type { Character } from "@/types/character";

export function getSkillUpgradeCost(currentLevel: number, costMultiplier: 1 | 2 = 1): number {
  return (currentLevel + 1) * PROGRESSION_RULES.skillUpgradeCostPerLevel * costMultiplier;
}
export function canUpgradeSkill(character: Character, skillId: string, availableIP = character.ip): boolean {
  const skill = character.skills[skillId];
  return Boolean(skill && skill.level < PROGRESSION_RULES.maximumSkillLevel && availableIP >= getSkillUpgradeCost(skill.level, skill.costMultiplier));
}
export function upgradeSkill(character: Character, skillId: string): Character | null {
  if (!canUpgradeSkill(character, skillId)) return null;
  const skill = character.skills[skillId];
  const cost = getSkillUpgradeCost(skill.level, skill.costMultiplier);
  return {
    ...character,
    ip: character.ip - cost,
    skills: { ...character.skills, [skillId]: { ...skill, level: skill.level + 1 } },
    progression: { improvementPoints: character.ip - cost },
  };
}
export function grantImprovementPoints(character: Character, amount: number): Character {
  return amount > 0 ? { ...character, ip: character.ip + amount, progression: { improvementPoints: character.ip + amount } } : character;
}