import {
  ATTRIBUTE_CREATION_RULES,
  CHARACTER_CREATION_RULES,
  getRequiredSkillMinimum,
} from "@/data/characterCreation";
import {
  calculateMaximumHitPoints,
  calculateMaximumHumanity,
} from "@/lib/calculations";
import type { AttributeName, Character } from "@/types/character";

export type CreationPointSummary = {
  attributePointsTotal: number;
  attributePointsSpent: number;
  attributePointsRemaining: number;
  skillPointsTotal: number;
  skillPointsPreAllocated: number;
  skillPointsSpentManual: number;
  skillPointsRemaining: number;
};
export type CreationValidation = {
  valid: boolean;
  errors: string[];
  summary: CreationPointSummary;
};

export function getAttributePointsSpent(character: Pick<Character, "stats">): number {
  return Object.values(character.stats).reduce((sum, value) => sum + value, 0);
}
export function getAttributePointsRemaining(character: Pick<Character, "stats">): number {
  return CHARACTER_CREATION_RULES.attributePoints - getAttributePointsSpent(character);
}
export function getRequiredSkillPoints(): number {
  return Object.values(CHARACTER_CREATION_RULES.requiredSkills).reduce((sum, value) => sum + value, 0);
}
export function getSkillMinimum(skillId: string): number {
  return getRequiredSkillMinimum(skillId);
}
/** Cada nível custa 1 ou 2 pontos conforme a perícia; Base nunca entra neste cálculo. */
export function getSkillPointsSpent(character: Pick<Character, "skills">): number {
  return Object.values(character.skills).reduce(
    (sum, skill) => sum + skill.level * skill.costMultiplier,
    0,
  );
}
export function getSkillPointsRemaining(character: Pick<Character, "skills">): number {
  return CHARACTER_CREATION_RULES.skillPoints - getSkillPointsSpent(character);
}
export function getCreationPointSummary(character: Pick<Character, "stats" | "skills">): CreationPointSummary {
  const attributePointsSpent = getAttributePointsSpent(character);
  const skillPointsPreAllocated = getRequiredSkillPoints();
  const skillPointsSpent = getSkillPointsSpent(character);
  return {
    attributePointsTotal: CHARACTER_CREATION_RULES.attributePoints,
    attributePointsSpent,
    attributePointsRemaining: CHARACTER_CREATION_RULES.attributePoints - attributePointsSpent,
    skillPointsTotal: CHARACTER_CREATION_RULES.skillPoints,
    skillPointsPreAllocated,
    skillPointsSpentManual: skillPointsSpent - skillPointsPreAllocated,
    skillPointsRemaining: CHARACTER_CREATION_RULES.skillPoints - skillPointsSpent,
  };
}
export function canIncreaseAttribute(character: Pick<Character, "stats">, attribute: AttributeName): boolean {
  return character.stats[attribute] < ATTRIBUTE_CREATION_RULES[attribute].maximum && getAttributePointsRemaining(character) > 0;
}
export function canDecreaseAttribute(character: Pick<Character, "stats">, attribute: AttributeName): boolean {
  return character.stats[attribute] > ATTRIBUTE_CREATION_RULES[attribute].minimum;
}
export function canIncreaseSkill(character: Pick<Character, "skills">, skillId: string): boolean {
  const skill = character.skills[skillId];
  return Boolean(skill && skill.level < CHARACTER_CREATION_RULES.skillMaximum && getSkillPointsRemaining(character) >= skill.costMultiplier);
}
export function canDecreaseSkill(character: Pick<Character, "skills">, skillId: string): boolean {
  const skill = character.skills[skillId];
  return Boolean(skill && skill.level > getSkillMinimum(skillId));
}
export function changeAttributeAtCreation(character: Character, attribute: AttributeName, delta: 1 | -1): Character {
  if ((delta === 1 && !canIncreaseAttribute(character, attribute)) || (delta === -1 && !canDecreaseAttribute(character, attribute))) return character;
  const stats = { ...character.stats, [attribute]: character.stats[attribute] + delta };
  const maximumHitPoints = calculateMaximumHitPoints(stats);
  return {
    ...character,
    stats,
    combat: { ...character.combat, hp: { current: maximumHitPoints, max: maximumHitPoints } },
  };
}
export function changeSkillAtCreation(character: Character, skillId: string, delta: 1 | -1): Character {
  if ((delta === 1 && !canIncreaseSkill(character, skillId)) || (delta === -1 && !canDecreaseSkill(character, skillId))) return character;
  const skill = character.skills[skillId];
  return {
    ...character,
    skills: { ...character.skills, [skillId]: { ...skill, level: skill.level + delta } },
  };
}
export function validateCharacterCreation(character: Character): CreationValidation {
  const errors: string[] = [];
  const summary = getCreationPointSummary(character);
  if (summary.attributePointsRemaining !== 0) errors.push(summary.attributePointsRemaining < 0 ? "Os pontos de STAT foram excedidos." : "Distribua todos os pontos de STAT.");
  if (summary.skillPointsRemaining !== 0) errors.push(summary.skillPointsRemaining < 0 ? "Os pontos de perícias foram excedidos." : "Distribua todos os pontos livres de Perícia.");
  for (const attribute of Object.keys(character.stats) as AttributeName[]) {
    const value = character.stats[attribute];
    const rule = ATTRIBUTE_CREATION_RULES[attribute];
    if (value < rule.minimum || value > rule.maximum) errors.push(`${attribute} deve ficar entre ${rule.minimum} e ${rule.maximum}.`);
  }
  for (const [id, skill] of Object.entries(character.skills)) {
    if (skill.level < getSkillMinimum(id)) errors.push(`${skill.name} não pode ficar abaixo de ${getSkillMinimum(id)}.`);
    if (skill.level > CHARACTER_CREATION_RULES.skillMaximum) errors.push(`${skill.name} ultrapassou o limite de criação.`);
  }
  if (!character.identity.name.trim()) errors.push("Informe o nome do personagem.");
  if (!character.primaryRole || character.roleAbilities.length === 0) errors.push("Selecione uma Role.");
  return { valid: errors.length === 0, errors, summary };
}
export function finalizeCharacterCreation(character: Character): Character {
  const validation = validateCharacterCreation(character);
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  return { ...character, progression: { improvementPoints: 0 } };
}