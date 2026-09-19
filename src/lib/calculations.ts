import type { Stats } from "@/types/character";

export function calculateMaximumHitPoints(stats: Pick<Stats, "BODY" | "WILL">): number {
  return 10 + 5 * Math.floor((stats.BODY + stats.WILL) / 2);
}
export function calculateMaximumHumanity(stats: Pick<Stats, "EMP">): number {
  return stats.EMP * 10;
}
/** A única fórmula de Base: STAT associado + nível da Skill. */
export function getSkillBase(
  character: Pick<import("@/types/character").Character, "stats" | "skills">,
  skillId: string,
): number {
  const skill = character.skills[skillId];
  if (!skill) throw new Error(`Perícia não encontrada: ${skillId}`);
  return character.stats[skill.stat] + skill.level;
}