import { skillDefinitions } from "@/data/skills";
import { rollDice } from "@/lib/dice";
import type { Character, Skill, RollHistoryEntry } from "@/types/character";

/** Registro de check de perícia no histórico */
interface SkillCheckHistoryEntry {
  id: string;
  type: "skill_check";
  label: string;
  characterId: string;
  expression: string;
  rolls: number[];
  total: number;
  timestamp: string;
  skillId: string;
  stat: { id: string; value: number };
  skill: { id: string; value: number };
}

/**
 * Realiza um check de perícia seguindo a regra:
 * Resultado = STAT + Skill Level + 1d10
 *
 * @param character - O personagem
 * @param skillId - ID da perícia a ser rolada
 * @returns Objeto com os resultados da rolagem ou erro, junto com o personagem atualizado
 */
export function rollSkillCheck(
  character: Character,
  skillId: string,
): {
  character: Character;
  result: SkillCheckResult;
} | { error: string; character: Character } {
  const skill = character.skills[skillId];
  if (!skill) {
    return { error: `Perícia "${skillId}" não existe na ficha.`, character };
  }

  // Usa a definição da perícia para descobrir o STAT associado
  // Esta é a fonte única de verdade para a associação STAT↔Skill
  const definition = skillDefinitions[skillId];
  if (!definition) {
    return { error: `Definição da perícia "${skillId}" não encontrada.`, character };
  }

  const statValue = character.stats[definition.stat];
  if (statValue === undefined) {
    return {
      error: `Atributo ${definition.stat} não encontrado no personagem.`,
      character,
    };
  }

  // Rolagem de 1d10
  const roll = rollDice("1d10");

  // Total = STAT + Skill Level + d10
  const total = statValue + skill.level + roll.total;

  const result: SkillCheckResult = {
    skillId,
    skillName: skill.name,
    statId: definition.stat,
    statValue,
    skillLevel: skill.level,
    diceRoll: roll.total,
    total,
  };

  // Registra no histórico de rolagens
  const historyEntry: RollHistoryEntry = {
    id: crypto.randomUUID(),
    type: "skill_check",
    label: skill.name,
    characterId: character.id,
    expression: roll.expression,
    rolls: roll.rolls,
    total,
    timestamp: new Date().toISOString(),
    stat: { id: definition.stat, value: statValue },
    skill: { id: skillId, value: skill.level },
  };

  const updatedCharacter: Character = {
    ...character,
    rollHistory: [historyEntry, ...character.rollHistory],
  };

  return { character: updatedCharacter, result };
}

export interface SkillCheckResult {
  skillId: string;
  skillName: string;
  statId: string;
  statValue: number;
  skillLevel: number;
  diceRoll: number;
  total: number;
}