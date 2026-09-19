import type { RoleAbilityId, RoleId } from "@/types/roles";
export type RoleDefinition = { id: RoleId; name: string; abilityId: RoleAbilityId; abilityName: string };
export const roleDefinitions: Record<RoleId, RoleDefinition> = {
  rockerboy: { id: "rockerboy", name: "Rockerboy", abilityId: "charismatic_impact", abilityName: "Charismatic Impact" },
  solo: { id: "solo", name: "Solo", abilityId: "combat_awareness", abilityName: "Combat Awareness" },
  netrunner: { id: "netrunner", name: "Netrunner", abilityId: "interface", abilityName: "Interface" },
  tech: { id: "tech", name: "Tech", abilityId: "maker", abilityName: "Maker" },
  medtech: { id: "medtech", name: "Medtech", abilityId: "medicine", abilityName: "Medicine" },
  media: { id: "media", name: "Media", abilityId: "credibility", abilityName: "Credibility" },
  exec: { id: "exec", name: "Exec", abilityId: "teamwork", abilityName: "Teamwork" },
  lawman: { id: "lawman", name: "Lawman", abilityId: "backup", abilityName: "Backup" },
  fixer: { id: "fixer", name: "Fixer", abilityId: "operator", abilityName: "Operator" },
  nomad: { id: "nomad", name: "Nomad", abilityId: "moto", abilityName: "Moto" },
};
export const combatAwarenessSpecialties = ["initiative", "damage", "evasion", "fumble_recovery", "perception", "threat_detection", "spot_weakness"] as const;
export const makerSpecialties = ["field_expertise", "upgrade_expertise", "fabrication_expertise", "invention_expertise"] as const;
export const medicineSpecialties = ["surgery", "pharmaceuticals", "cryosystem_operation"] as const;
export const interfaceAbilities = ["backdoor", "cloak", "control", "eye_dee", "pathfinder", "scanner", "slide", "virus", "zap"] as const;