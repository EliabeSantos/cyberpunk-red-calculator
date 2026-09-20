export const roleIds = ["rockerboy", "solo", "netrunner", "tech", "medtech", "media", "exec", "lawman", "fixer", "nomad"] as const;
export type RoleId = (typeof roleIds)[number];
export const roleAbilityIds = ["charismatic_impact", "combat_awareness", "interface", "maker", "medicine", "credibility", "teamwork", "backup", "operator", "moto"] as const;
export type RoleAbilityId = (typeof roleAbilityIds)[number];
export type RoleAbilityData = {
  id: RoleAbilityId;
  name: string;
  description: string;
  effectsByLevel: Record<number, string>;
};
export type RoleAbilityState = { roleId: RoleId; abilityId: RoleAbilityId; rank: number; specialties?: Record<string, number> };
export type TeamMember = { id: string; name: string; role?: string };
export type FamilyVehicle = { id: string; name: string; upgrades: string[] };