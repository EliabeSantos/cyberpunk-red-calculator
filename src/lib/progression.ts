import { PROGRESSION_RULES } from "@/data/progression";
import { calculateSkillValues } from "@/lib/calculations";
import type { Character } from "@/types/character";

export function getSkillUpgradeCost(currentLevel: number): number { return (currentLevel + 1) * PROGRESSION_RULES.skillUpgradeCostPerLevel; }
export function canUpgradeSkill(character: Character, skillId: string, availableIP = character.progression.improvementPoints): boolean {
  const skill = character.skills[skillId];
  return Boolean(skill && skill.level < PROGRESSION_RULES.maximumSkillLevel && availableIP >= getSkillUpgradeCost(skill.level));
}
export function upgradeSkill(character: Character, skillId: string): Character | null {
  if (!canUpgradeSkill(character, skillId)) return null;
  const skill = character.skills[skillId]; const cost = getSkillUpgradeCost(skill.level);
  return { ...character, skills: { ...character.skills, [skillId]: calculateSkillValues(character.attributes, { ...skill, level: skill.level + 1 }) }, progression: { improvementPoints: character.progression.improvementPoints - cost } };
}
export function grantImprovementPoints(character: Character, amount: number): Character {
  return amount > 0 ? { ...character, progression: { improvementPoints: character.progression.improvementPoints + amount } } : character;
}