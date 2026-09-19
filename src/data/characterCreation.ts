import type { AttributeName } from "@/types/character";

/** Complete Package: pools independentes para STATs e Perícias. */
export const CHARACTER_CREATION_RULES = {
  attributePoints: 62,
  skillPoints: 86,
  skillMaximum: 6,
  requiredSkills: {
    athletics: 2,
    brawling: 2,
    concentration: 2,
    conversation: 2,
    education: 2,
    evasion: 2,
    first_aid: 2,
    human_perception: 2,
    language: 2,
    local_expert: 2,
    perception: 2,
    persuasion: 2,
    stealth: 2,
  },
} as const;

export const ATTRIBUTE_CREATION_RULES: Record<AttributeName, { minimum: number; maximum: number }> = {
  INT: { minimum: 2, maximum: 8 }, REF: { minimum: 2, maximum: 8 }, DEX: { minimum: 2, maximum: 8 },
  TECH: { minimum: 2, maximum: 8 }, COOL: { minimum: 2, maximum: 8 }, WILL: { minimum: 2, maximum: 8 },
  LUCK: { minimum: 2, maximum: 8 }, MOVE: { minimum: 2, maximum: 8 }, BODY: { minimum: 2, maximum: 8 }, EMP: { minimum: 2, maximum: 8 },
};

export function getRequiredSkillMinimum(skillId: string): number {
  return CHARACTER_CREATION_RULES.requiredSkills[skillId as keyof typeof CHARACTER_CREATION_RULES.requiredSkills] ?? 0;
}