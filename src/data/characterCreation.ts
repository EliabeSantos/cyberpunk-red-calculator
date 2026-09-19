import type { AttributeName } from "@/types/character";

export const CHARACTER_CREATION_RULES = {
  attributePoints: 80,
  skillPoints: 62,
  skillMaximum: 6,
  requiredSkills: {
    concentration: 2,
    perception: 2,
  },
} as const;

export const ATTRIBUTE_CREATION_RULES: Record<AttributeName, { minimum: number; maximum: number }> = {
  INT: { minimum: 0, maximum: 10 }, REF: { minimum: 0, maximum: 10 }, DEX: { minimum: 0, maximum: 10 },
  TECH: { minimum: 0, maximum: 10 }, COOL: { minimum: 0, maximum: 10 }, WILL: { minimum: 0, maximum: 10 },
  LUCK: { minimum: 0, maximum: 10 }, MOVE: { minimum: 0, maximum: 10 }, BODY: { minimum: 0, maximum: 10 }, EMP: { minimum: 0, maximum: 10 },
};

export function getRequiredSkillMinimum(skillId: string): number {
  return CHARACTER_CREATION_RULES.requiredSkills[skillId as keyof typeof CHARACTER_CREATION_RULES.requiredSkills] ?? 0;
}