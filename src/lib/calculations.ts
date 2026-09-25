import type { Stats } from "@/types/character";
import type { Character } from "@/types/character";
import type { AttributeName } from "@/types/character";
import type { CriticalInjury } from "@/data/criticalInjuries";
import { ignoresWoundPenalty } from "@/lib/cyberwareEffects";

export function calculateMaximumHitPoints(
  stats: Pick<Stats, "BODY" | "WILL">,
): number {
  return 10 + 5 * Math.floor((stats.BODY + stats.WILL) / 2);
}
export function calculateMaximumHumanity(stats: Pick<Stats, "EMP">): number {
  return stats.EMP * 10;
}

/** Calcula todos os modificadores ativos das Critical Injuries do personagem.
 * Retorna um objeto com os modificadores agrupados por tipo para fácil aplicação.
 */
export function getCriticalInjuryModifiers(
  character: Pick<Character, "combat">,
): {
  statModifiers: Record<AttributeName, number>;
  skillModifiers: Record<string, number>;
  moveModifier: number;
  allPhysicalModifier: number;
  allMentalModifier: number;
  allActionsModifier: number;
  rangedModifier: number;
  meleeModifier: number;
  fineManipulationModifier: number;
  twoHandedModifier: number;
  socialModifier: number;
  deathSaveModifier: number;
  /** Lista de descrições dos modificadores para exibição na UI */
  descriptions: string[];
} {
  const injuries = character.combat?.criticalInjuries || [];

  const result = {
    statModifiers: {} as Record<AttributeName, number>,
    skillModifiers: {} as Record<string, number>,
    moveModifier: 0,
    allPhysicalModifier: 0,
    allMentalModifier: 0,
    allActionsModifier: 0,
    rangedModifier: 0,
    meleeModifier: 0,
    fineManipulationModifier: 0,
    twoHandedModifier: 0,
    socialModifier: 0,
    deathSaveModifier: 0,
    descriptions: [] as string[],
  };

  for (const injury of injuries) {
    for (const mod of injury.modifiers || []) {
      switch (mod.type) {
        case "stat":
          if (mod.stat) {
            result.statModifiers[mod.stat] =
              (result.statModifiers[mod.stat] || 0) + mod.value;
            result.descriptions.push(`${injury.name}: ${mod.description}`);
          }
          break;
        case "skill":
          if (mod.skillId) {
            result.skillModifiers[mod.skillId] =
              (result.skillModifiers[mod.skillId] || 0) + mod.value;
            result.descriptions.push(`${injury.name}: ${mod.description}`);
          }
          break;
        case "move":
          result.moveModifier += mod.value;
          result.descriptions.push(`${injury.name}: ${mod.description}`);
          break;
        case "all_physical":
          result.allPhysicalModifier += mod.value;
          result.descriptions.push(`${injury.name}: ${mod.description}`);
          break;
        case "all_mental":
          result.allMentalModifier += mod.value;
          result.descriptions.push(`${injury.name}: ${mod.description}`);
          break;
        case "all_actions":
          result.allActionsModifier += mod.value;
          result.descriptions.push(`${injury.name}: ${mod.description}`);
          break;
        case "ranged":
          result.rangedModifier += mod.value;
          result.descriptions.push(`${injury.name}: ${mod.description}`);
          break;
        case "melee":
          result.meleeModifier += mod.value;
          result.descriptions.push(`${injury.name}: ${mod.description}`);
          break;
        case "fine_manipulation":
          result.fineManipulationModifier += mod.value;
          result.descriptions.push(`${injury.name}: ${mod.description}`);
          break;
        case "two_handed":
          result.twoHandedModifier += mod.value;
          result.descriptions.push(`${injury.name}: ${mod.description}`);
          break;
        case "social":
          result.socialModifier += mod.value;
          result.descriptions.push(`${injury.name}: ${mod.description}`);
          break;
        case "death_save":
          result.deathSaveModifier += mod.value;
          result.descriptions.push(`${injury.name}: ${mod.description}`);
          break;
      }
    }
  }

  return result;
}

/** Calcula o Wound Threshold (limiar de ferimento grave).
 * Em Cyberpunk RED, o Wound Threshold é metade do HP máximo (arredondado para baixo).
 * Personagens com HP <= Wound Threshold estão "Seriously Wounded".
 */
export function calculateWoundThreshold(maxHP: number): number {
  return Math.floor(maxHP / 2);
}

/** Calcula a Humanity Máxima baseada no Cyberware instalado.
 * Regra: cada cyberware -2, cada borgware -4.
 * A Humanity Máxima não pode ser menor que 0.
 * Usa o EMP do personagem para calcular o máximo inicial (EMP * 10),
 * não o valor já reduzido armazenado em character.humanity.max.
 */
export function calculateMaximumHumanityFromCyberware(
  character: Pick<Character, "cyberware" | "stats">,
): number {
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

/** Tipo do status de HP do personagem. */
export type HPStatus =
  | "normal"
  | "seriously_wounded"
  | "mortally_wounded"
  | "dead";

/** Calcula o status de HP do personagem baseado nas regras do Cyberpunk RED.
 * - HP > Wound Threshold → Normal
 * - HP <= Wound Threshold e HP > 0 → Seriously Wounded (-2 em todas ações)
 * - HP <= 0 e não isDead → Mortally Wounded (sistema de Death Saves)
 * - isDead === true → Dead
 */
export function calculateHPStatus(
  hpCurrent: number,
  hpMax: number,
  isDead: boolean,
): HPStatus {
  if (isDead) return "dead";
  if (hpCurrent <= 0) return "mortally_wounded";
  const woundThreshold = calculateWoundThreshold(hpMax);
  if (hpCurrent <= woundThreshold) return "seriously_wounded";
  return "normal";
}

/** Penalidade de HP quando Seriously/Mortally Wounded: −2 em todas as ações (CPR).
 * Pain Editor ativo zera essa penalidade — é a única peça que faz isso hoje.
 * Fonte única para First Aid, perícia, ataque e Evasão usarem o mesmo número. */
export function getWoundPenalty(
  character: Pick<Character, "combat" | "cyberware">,
): number {
  const status = calculateHPStatus(
    character.combat.hp.current,
    character.combat.hp.max,
    character.combat.isDead,
  );
  if (status !== "seriously_wounded" && status !== "mortally_wounded") return 0;
  if (ignoresWoundPenalty(character)) return 0;
  return -2;
}

/** A única fórmula de Base: STAT associado + nível da Skill. */
export function getSkillBase(
  character: Pick<import("@/types/character").Character, "stats" | "skills">,
  skillId: string,
): number {
  const skill = character.skills[skillId];
  if (!skill) return 0;
  return character.stats[skill.stat] + skill.level;
}
