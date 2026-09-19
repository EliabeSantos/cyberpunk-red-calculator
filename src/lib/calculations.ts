import type { Attributes, Skill, Skills } from "@/types/character";

/** HP máximo no Cyberpunk RED: 10 + 5 × floor((BODY + WILL) / 2). */
export function calculateMaximumHitPoints(attributes: Pick<Attributes, "BODY" | "WILL">): number {
  return 10 + 5 * Math.floor((attributes.BODY + attributes.WILL) / 2);
}

/** Humanidade máxima no Cyberpunk RED: EMP × 10. */
export function calculateMaximumHumanity(attributes: Pick<Attributes, "EMP">): number {
  return attributes.EMP * 10;
}

/** Retorna uma perícia sincronizada com o atributo atual, sem rolar dados. */
export function calculateSkillValues(attributes: Attributes, skill: Skill): Skill {
  const base = attributes[skill.stat];
  return { ...skill, base, total: base + skill.level };
}

export function recalculateSkills(attributes: Attributes, skills: Skills): Skills {
  return Object.fromEntries(Object.entries(skills).map(([id, skill]) => [id, calculateSkillValues(attributes, skill)]));
}