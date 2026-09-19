import type { Stats } from "@/types/character";
import type { Character } from "@/types/character";

export function calculateMaximumHitPoints(stats: Pick<Stats, "BODY" | "WILL">): number {
  return 10 + 5 * Math.floor((stats.BODY + stats.WILL) / 2);
}
export function calculateMaximumHumanity(stats: Pick<Stats, "EMP">): number {
  return stats.EMP * 10;
}

/** Calcula a Humanity Máxima baseada no Cyberware instalado.
 * Regra: cada cyberware -2, cada borgware -4.
 * A Humanity Máxima não pode ser menor que 0.
 * Usa o EMP do personagem para calcular o máximo inicial (EMP * 10),
 * não o valor já reduzido armazenado em character.humanity.max.
 */
export function calculateMaximumHumanityFromCyberware(character: Pick<Character, "cyberware" | "stats">): number {
  const initialMax = character.stats.EMP * 10;
  let reduction = 0;
  for (const cw of character.cyberware) {
    reduction += cw.isBorgware ? 4 : 2;
  }
  return Math.max(0, initialMax - reduction);
}

/** Calcula o EMP atual baseado na Humanity atual.
 * Regra: EMP = floor(Humanity / 10), mínimo 1.
 */
export function calculateEmpFromHumanity(humanityCurrent: number): number {
  return Math.max(1, Math.floor(humanityCurrent / 10));
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