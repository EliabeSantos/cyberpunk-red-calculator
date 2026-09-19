import { getRequiredSkillMinimum } from "@/data/characterCreation";
import type { AttributeName, Attributes, Skill, Skills } from "@/types/character";

export type SkillDefinition = { name: string; stat: AttributeName; creation: { required: boolean; minimumLevel: number } };

/** Catálogo inicial de perícias. Especializações poderão ser adicionadas depois. */
const baseSkillDefinitions: Record<string, Omit<SkillDefinition, "creation">> = {
  athletics: { name: "Atletismo", stat: "DEX" },
  brawling: { name: "Briga", stat: "DEX" },
  contortionist: { name: "Contorcionismo", stat: "DEX" },
  dance: { name: "Dança", stat: "DEX" },
  evasion: { name: "Evasão", stat: "DEX" },
  martial_arts: { name: "Artes Marciais", stat: "DEX" },
  melee_weapon: { name: "Arma Branca", stat: "DEX" },
  stealth: { name: "Furtividade", stat: "DEX" },
  pick_pocket: { name: "Furto", stat: "DEX" },
  drive_land_vehicle: { name: "Condução", stat: "REF" },
  handgun: { name: "Armas de Fogo Curtas", stat: "REF" },
  heavy_weapons: { name: "Armas Pesadas", stat: "REF" },
  shoulder_arms: { name: "Armas de Ombro", stat: "REF" },
  autofire: { name: "Rajada Automática", stat: "REF" },
  concentration: { name: "Concentração", stat: "WILL" },
  endurance: { name: "Resistência", stat: "WILL" },
  resist_torture_drugs: { name: "Resistir a Tortura/Drogas", stat: "WILL" },
  bribery: { name: "Suborno", stat: "COOL" },
  interrogation: { name: "Interrogatório", stat: "COOL" },
  intimidation: { name: "Intimidação", stat: "COOL" },
  streetwise: { name: "Streetwise", stat: "COOL" },
  trading: { name: "Comércio", stat: "COOL" },
  education: { name: "Educação", stat: "INT" },
  business: { name: "Negócios", stat: "INT" },
  deduction: { name: "Dedução", stat: "INT" },
  language: { name: "Idioma", stat: "INT" },
  local_expert: { name: "Especialista Local", stat: "INT" },
  science: { name: "Ciência", stat: "INT" },
  tactics: { name: "Tática", stat: "INT" },
  perception: { name: "Percepção", stat: "INT" },
  tracking: { name: "Rastreamento", stat: "INT" },
  conceal_reveal_object: { name: "Esconder/Revelar Objeto", stat: "INT" },
  first_aid: { name: "Primeiros Socorros", stat: "TECH" },
  land_vehicle: { name: "Veículos Terrestres", stat: "TECH" },
  basic_tech: { name: "Tecnologia Básica", stat: "TECH" },
  cybertech: { name: "Cybertech", stat: "TECH" },
  electronics_security: { name: "Eletrônica/Segurança", stat: "TECH" },
  weaponstech: { name: "Tecnologia de Armas", stat: "TECH" },
  pick_lock: { name: "Arrombar Fechaduras", stat: "TECH" },
  composition: { name: "Composição", stat: "EMP" },
  conversation: { name: "Conversação", stat: "EMP" },
  human_perception: { name: "Percepção Humana", stat: "EMP" },
  interpersonal: { name: "Interação", stat: "EMP" },
  play_instrument: { name: "Instrumento Musical", stat: "EMP" },
  play: { name: "Atuação", stat: "EMP" },
};
/** Regras por perícia, incluindo mínimos obrigatórios de criação. */
export const skillDefinitions: Record<string, SkillDefinition> = Object.fromEntries(
  Object.entries(baseSkillDefinitions).map(([id, definition]) => {
    const minimumLevel = getRequiredSkillMinimum(id);
    return [id, { ...definition, creation: { required: minimumLevel > 0, minimumLevel } }];
  }),
);
export function createDefaultSkills(attributes: Attributes): Skills {
  return Object.fromEntries(
    Object.entries(skillDefinitions).map(([id, definition]) => {
      const base = attributes[definition.stat];
      const skill: Skill = { name: definition.name, stat: definition.stat, level: definition.creation.minimumLevel, base, total: base + definition.creation.minimumLevel };
      return [id, skill];
    }),
  );
}