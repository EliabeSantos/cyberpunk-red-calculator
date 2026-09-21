import { getRequiredSkillMinimum } from "@/data/characterCreation";
import type { AttributeName, Skills } from "@/types/character";

export type SkillCategory = "awareness" | "body" | "control" | "education" | "fighting" | "performance" | "ranged_weapon" | "social" | "technique";
export type SkillDefinition = { name: string; stat: AttributeName; category: SkillCategory; costMultiplier: 1 | 2; creation: { required: boolean; minimumLevel: number } };
type DefinitionInput = Omit<SkillDefinition, "creation">;
const normal = (name: string, stat: AttributeName, category: SkillCategory): DefinitionInput => ({ name, stat, category, costMultiplier: 1 });
const double = (name: string, stat: AttributeName, category: SkillCategory): DefinitionInput => ({ name, stat, category, costMultiplier: 2 });

/** The 66 Core Rulebook skills. Specializations belong to a character skill instance, never this catalog. */
const baseSkillDefinitions: Record<string, DefinitionInput> = {
  concentration: normal("Concentration", "WILL", "awareness"),
  conceal_reveal_object: normal("Conceal/Reveal Object", "INT", "awareness"),
  lip_reading: normal("Lip Reading", "INT", "awareness"),
  perception: normal("Perception", "INT", "awareness"),
  tracking: normal("Tracking", "INT", "awareness"),
  athletics: normal("Athletics", "DEX", "body"), contortionist: normal("Contortionist", "DEX", "body"), dance: normal("Dance", "DEX", "body"), endurance: normal("Endurance", "WILL", "body"), resist_torture_drugs: normal("Resist Torture/Drugs", "WILL", "body"), stealth: normal("Stealth", "DEX", "body"),
  drive_land_vehicle: normal("Drive Land Vehicle", "REF", "control"), pilot_air_vehicle: double("Pilot Air Vehicle", "REF", "control"), pilot_sea_vehicle: normal("Pilot Sea Vehicle", "REF", "control"), riding: normal("Riding", "REF", "control"),
  accounting: normal("Accounting", "INT", "education"), animal_handling: normal("Animal Handling", "INT", "education"), bureaucracy: normal("Bureaucracy", "INT", "education"), business: normal("Business", "INT", "education"), composition: normal("Composition", "INT", "education"), criminology: normal("Criminology", "INT", "education"), cryptography: normal("Cryptography", "INT", "education"), deduction: normal("Deduction", "INT", "education"), education: normal("Education", "INT", "education"), gamble: normal("Gamble", "INT", "education"), language: normal("Language", "INT", "education"), library_search: normal("Library Search", "INT", "education"), local_expert: normal("Local Expert", "INT", "education"), science: normal("Science", "INT", "education"), tactics: normal("Tactics", "INT", "education"), wilderness_survival: normal("Wilderness Survival", "INT", "education"),
  brawling: normal("Brawling", "DEX", "fighting"), evasion: normal("Evasion", "DEX", "fighting"), martial_arts: double("Martial Arts", "DEX", "fighting"), melee_weapon: normal("Melee Weapon", "DEX", "fighting"),
  acting: normal("Acting", "COOL", "performance"), play_instrument: normal("Play Instrument", "TECH", "performance"),
  archery: normal("Archery", "REF", "ranged_weapon"), autofire: double("Autofire", "REF", "ranged_weapon"), handgun: normal("Handgun", "REF", "ranged_weapon"), heavy_weapons: double("Heavy Weapons", "REF", "ranged_weapon"), shoulder_arms: normal("Shoulder Arms", "REF", "ranged_weapon"),
  bribery: normal("Bribery", "COOL", "social"), conversation: normal("Conversation", "EMP", "social"), human_perception: normal("Human Perception", "EMP", "social"), interrogation: normal("Interrogation", "COOL", "social"), persuasion: normal("Persuasion", "COOL", "social"), personal_grooming: normal("Personal Grooming", "COOL", "social"), streetwise: normal("Streetwise", "COOL", "social"), trading: normal("Trading", "COOL", "social"), wardrobe_style: normal("Wardrobe & Style", "COOL", "social"),
  air_vehicle_tech: normal("Air Vehicle Tech", "TECH", "technique"), basic_tech: normal("Basic Tech", "TECH", "technique"), cybertech: normal("Cybertech", "TECH", "technique"), demolitions: double("Demolitions", "TECH", "technique"), electronics_security: double("Electronics/Security Tech", "TECH", "technique"), first_aid: normal("First Aid", "TECH", "technique"), forgery: normal("Forgery", "TECH", "technique"), land_vehicle_tech: normal("Land Vehicle Tech", "TECH", "technique"), paint_draw_sculpt: normal("Paint/Draw/Sculpt", "TECH", "technique"), paramedic: double("Paramedic", "TECH", "technique"), photography_film: normal("Photography/Film", "TECH", "technique"), pick_lock: normal("Pick Lock", "TECH", "technique"), pick_pocket: normal("Pick Pocket", "TECH", "technique"), sea_vehicle_tech: normal("Sea Vehicle Tech", "TECH", "technique"), weaponstech: normal("Weaponstech", "TECH", "technique"),
  interface: normal("Interface", "INT", "technique"),
};

export const skillDefinitions: Record<string, SkillDefinition> = Object.fromEntries(
  Object.entries(baseSkillDefinitions).map(([id, definition]) => {
    const minimumLevel = getRequiredSkillMinimum(id);
    return [id, { ...definition, creation: { required: minimumLevel > 0, minimumLevel } }];
  }),
);
export function createDefaultSkills(): Skills {
  return Object.fromEntries(Object.entries(skillDefinitions).map(([id, definition]) => [id, {
    name: definition.name, stat: definition.stat, category: definition.category,
    costMultiplier: definition.costMultiplier, level: definition.creation.minimumLevel,
  }]));
}