import { skillDefinitions } from "@/data/skills";
import { rollDice } from "@/lib/dice";
import { getCriticalInjuryModifiers } from "@/lib/calculations";
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
  modifiers?: { source: string; value: number }[];
}

/**
 * Realiza um check de perícia seguindo a regra:
 * Resultado = STAT + Skill Level + 1d10 + Critical Injury Modifiers
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

  // Calcula modificadores de Critical Injuries
  const injuryModifiers = getCriticalInjuryModifiers(character);
  
  // Calcula modificador do STAT (se houver)
  const statModifier = injuryModifiers.statModifiers[definition.stat] || 0;
  const modifiedStatValue = statValue + statModifier;
  
  // Calcula modificador da perícia específica
  const skillModifier = injuryModifiers.skillModifiers[skillId] || 0;
  
  // Calcula modificadores gerais aplicáveis
  const allPhysicalModifier = injuryModifiers.allPhysicalModifier;
  const allMentalModifier = injuryModifiers.allMentalModifier;
  const allActionsModifier = injuryModifiers.allActionsModifier;
  const fineManipulationModifier = injuryModifiers.fineManipulationModifier;
  const twoHandedModifier = injuryModifiers.twoHandedModifier;
  const rangedModifier = injuryModifiers.rangedModifier;
  const meleeModifier = injuryModifiers.meleeModifier;
  const socialModifier = injuryModifiers.socialModifier;
  const allActions = allActionsModifier;
  
  // Determina quais modificadores se aplicam a esta perícia
  const isPhysicalSkill = ["athletics", "brawling", "concentration", "contortionist", "dance", "endurance", "resist_torture_drugs", "stealth", "drive_land_vehicle", "pilot_air_vehicle", "pilot_sea_vehicle", "riding", "brawling", "evasion", "martial_arts", "melee_weapon", "archery", "autofire", "handgun", "heavy_weapons", "shoulder_arms", "acting", "play_instrument", "bribery", "conversation", "human_perception", "interrogation", "persuasion", "personal_grooming", "streetwise", "trading", "wardrobe_style", "air_vehicle_tech", "basic_tech", "cybertech", "demolitions", "electronics_security", "first_aid", "forgery", "land_vehicle_tech", "paint_draw_sculpt", "paramedic", "photography_film", "pick_lock", "pick_pocket", "sea_vehicle_tech", "weaponstech"].includes(skillId);
  
  const isMentalSkill = ["concentration", "education", "perception", "tracking", "accounting", "animal_handling", "bureaucracy", "business", "composition", "criminology", "cryptography", "deduction", "education", "gamble", "language", "library_search", "local_expert", "science", "tactics", "wilderness_survival"].includes(skillId);
  
  const isSocialSkill = ["bribery", "conversation", "human_perception", "interrogation", "persuasion", "personal_grooming", "streetwise", "trading", "wardrobe_style"].includes(skillId);
  
  // Calcula o modificador total
  let totalModifier = statModifier + skillModifier + allActions;
  
  if (isPhysicalSkill) {
    totalModifier += allPhysicalModifier;
  }
  if (isMentalSkill) {
    totalModifier += allMentalModifier;
  }
  if (isSocialSkill) {
    totalModifier += socialModifier;
  }
  
  // Modificadores específicos por categoria de perícia
  // Fine manipulation: perícias que requerem manipulação fina
  const fineManipulationSkills = ["pick_lock", "pick_pocket", "forgery", "electronics_security", "first_aid", "paramedic", "cybertech", "basic_tech", "weaponstech", "paint_draw_sculpt", "photography_film", "play_instrument"];
  if (fineManipulationSkills.includes(skillId)) {
    totalModifier += fineManipulationModifier;
  }
  
  // Two-handed: perícias de armas duas mãos
  const twoHandedSkills = ["heavy_weapons", "shoulder_arms", "martial_arts", "melee_weapon", "brawling"];
  if (twoHandedSkills.includes(skillId)) {
    totalModifier += twoHandedModifier;
  }
  
  // Ranged skills
  const rangedSkills = ["archery", "autofire", "handgun", "heavy_weapons", "shoulder_arms"];
  if (rangedSkills.includes(skillId)) {
    totalModifier += rangedModifier;
  }
  
  // Melee skills
  const meleeSkills = ["brawling", "martial_arts", "melee_weapon"];
  if (meleeSkills.includes(skillId)) {
    totalModifier += meleeModifier;
  }
  
  // Social skills
  const socialSkills = ["bribery", "conversation", "human_perception", "interrogation", "persuasion", "personal_grooming", "streetwise", "trading", "wardrobe_style"];
  if (socialSkills.includes(skillId)) {
    totalModifier += socialModifier;
  }
  
  // Rolagem de 1d10 com exploding dice (crítico em 10, falha crítica em 1)
  interface RollDetail { value: number; type: "normal" | "crit" | "fumble" | "crit_add" | "fumble_sub"; }
  let allRolls: RollDetail[] = [];
  let diceTotal = 0;
  let isCritical = false;
  let isFumble = false;
  
  function rollExplodingD10(): number {
    const roll = rollDice("1d10");
    const rollValue = roll.rolls[0];
    allRolls.push({ value: rollValue, type: "normal" });
    diceTotal += rollValue;
    
    // Se rolou 10, rola UMA vez mais e ADICIONA (crítico)
    if (rollValue === 10) {
      isCritical = true;
      allRolls[allRolls.length - 1].type = "crit";
      const nextRoll = rollDice("1d10");
      const nextValue = nextRoll.rolls[0];
      allRolls.push({ value: nextValue, type: "crit_add" });
      diceTotal += nextValue;
      return diceTotal;
    }
    
    // Se rolou 1, rola UMA vez mais e SUBTRAI (falha crítica)
    if (rollValue === 1) {
      isFumble = true;
      allRolls[allRolls.length - 1].type = "fumble";
      const nextRoll = rollDice("1d10");
      const nextValue = nextRoll.rolls[0];
      allRolls.push({ value: nextValue, type: "fumble_sub" });
      diceTotal -= nextValue;
      return diceTotal;
    }
    
    return diceTotal;
  }
  
  rollExplodingD10();

  // Total = STAT + Skill Level + d10 (com exploding) + Modifiers
  const finalStatValue = statValue + statModifier;
  const total = finalStatValue + skill.level + diceTotal + totalModifier;

  const result: SkillCheckResult = {
    skillId,
    skillName: skill.name,
    statId: definition.stat,
    statValue: finalStatValue,
    statBase: statValue,
    statModifier,
    skillLevel: skill.level,
    skillModifier,
    diceRoll: diceTotal,
    totalModifier,
    total,
    critical: isCritical,
    fumble: isFumble,
    diceRolls: allRolls,
  };

  // Prepara lista de modificadores para o histórico
  const modifierEntries = [];
  if (statModifier !== 0) modifierEntries.push({ source: `STAT (${definition.stat})`, value: statModifier });
  if (skillModifier !== 0) modifierEntries.push({ source: `Perícia (${skill.name})`, value: skillModifier });
  if (allPhysicalModifier !== 0) modifierEntries.push({ source: "Físico (lesão)", value: allPhysicalModifier });
  if (allMentalModifier !== 0) modifierEntries.push({ source: "Mental (lesão)", value: allMentalModifier });
  if (allActions !== 0) modifierEntries.push({ source: "Todas ações (lesão)", value: allActions });
  if (fineManipulationModifier !== 0) modifierEntries.push({ source: "Manipulação fina (lesão)", value: fineManipulationModifier });
  if (twoHandedModifier !== 0) modifierEntries.push({ source: "Duas mãos (lesão)", value: twoHandedModifier });
  if (rangedModifier !== 0) modifierEntries.push({ source: "Distância (lesão)", value: rangedModifier });
  if (meleeModifier !== 0) modifierEntries.push({ source: "Corpo a corpo (lesão)", value: meleeModifier });
  if (socialModifier !== 0) modifierEntries.push({ source: "Social (lesão)", value: socialModifier });

  // Registra no histórico de rolagens
  const historyEntry: RollHistoryEntry = {
    id: crypto.randomUUID(),
    type: "skill_check",
    label: skill.name,
    characterId: character.id,
    expression: `1d10${isCritical ? " (crítico!)" : ""}${isFumble ? " (falha crítica!)" : ""}`,
    rolls: allRolls.map((r) => r.value),
    total,
    timestamp: new Date().toISOString(),
    stat: { id: definition.stat, value: modifiedStatValue },
    skill: { id: skillId, value: skill.level },
    modifiers: modifierEntries,
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
  statBase: number;
  statModifier: number;
  skillLevel: number;
  skillModifier: number;
  diceRoll: number;
  totalModifier: number;
  total: number;
  critical: boolean;
  fumble: boolean;
  diceRolls: { value: number; type: "normal" | "crit" | "fumble" | "crit_add" | "fumble_sub" }[];
}