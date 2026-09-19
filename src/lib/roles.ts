import { roleDefinitions } from "@/data/roles";
import type { Character } from "@/types/character";
import type { RoleAbilityId, RoleAbilityState, RoleId } from "@/types/roles";

export function getRoleAbilityIPCost(nextRank: number): number { return nextRank >= 1 && nextRank <= 10 ? nextRank * 60 : 0; }
export function getNetActionsPerTurn(rank: number): number { return rank >= 10 ? 5 : rank >= 7 ? 4 : rank >= 4 ? 3 : 2; }
export function getMakerSpecialtyPoints(rank: number): number { return rank * 2; }
export function getMedicineSpecialtyPoints(rank: number): number { return rank; }
export function getSurgerySkillFromMedicine(ability: RoleAbilityState): number { return (ability.specialties?.surgery ?? 0) * 2; }
export function getMedicalTechSkillFromMedicine(ability: RoleAbilityState): number { return (ability.specialties?.pharmaceuticals ?? 0) + (ability.specialties?.cryosystem_operation ?? 0); }
export function getCharismaticImpactTier(rank: number): string { return rank === 10 ? "international" : rank >= 9 ? "national" : rank >= 7 ? "local media" : rank >= 5 ? "citywide" : rank >= 3 ? "local" : "small clubs"; }
export function getFanDV(size: "individual" | "small_group" | "large_group"): number { return { individual: 9, small_group: 13, large_group: 17 }[size]; }
export function getFanImpact(rank: number, size: "individual" | "small_group" | "large_group"): boolean { return rank >= Math.ceil(getFanDV(size) / 3); }
export function getCredibilityReach(rank: number): string { return rank === 10 ? "worldwide" : rank >= 9 ? "national" : rank >= 7 ? "state" : rank >= 5 ? "citywide" : rank >= 3 ? "city" : "local"; }
export function getCredibilityScore(rank: number): number { return rank === 10 ? 7 : rank >= 9 ? 6 : rank >= 7 ? 5 : rank >= 5 ? 4 : rank >= 3 ? 3 : 2; }
export function getCredibilitySources(rank: number): string { return rank >= 9 ? "high-level sources" : rank >= 5 ? "important sources" : "local sources"; }
export function getCredibilityImpact(rank: number): string { return getCredibilityReach(rank); }
export function getOperatorContacts(rank: number): string { return rank >= 9 ? "national" : rank >= 7 ? "elite local" : rank >= 5 ? "important city" : rank >= 3 ? "city" : "local"; }
export function getOperatorReach(rank: number): string { return rank >= 9 ? "Luxury" : rank >= 7 ? "Very Expensive" : rank >= 3 ? "Expensive" : "Cheap/Everyday"; }
export function getOperatorHaggle(rank: number): number { return rank >= 9 ? 20 : rank >= 5 ? 15 : 10; }
export function getOperatorGrease(rank: number): string { return rank >= 5 ? "Night Market access" : "local cultural knowledge"; }
export function getMotoSkillBonus(character: Pick<Character, "roleAbilities">): number { return character.roleAbilities.find((ability) => ability.abilityId === "moto")?.rank ?? 0; }
export function getNomadVehicleOptions(rank: number): string[] { return rank >= 9 ? ["Aerozep", "AV-9", "Super Groundcar", "Yacht"] : rank >= 7 ? ["AV-4", "Cabin Cruiser", "Superbike"] : rank >= 5 ? ["Helicopter", "High Performance Groundcar", "Speedboat"] : ["Compact Groundcar", "Gyrocopter", "Jetski", "Roadbike"]; }
export function getBackupTier(rank: number): string { return rank >= 10 ? "National Law Enforcement" : rank >= 9 ? "C-SWAT" : rank >= 8 ? "Recovery Zone Marshal" : rank >= 5 ? "Sheriff's Department" : rank >= 3 ? "Local Beat Cops" : "Corporate Security"; }
export function getCombatAwarenessTotal(character: Pick<Character, "roleAbilities">): number { return character.roleAbilities.find((ability) => ability.abilityId === "combat_awareness")?.rank ?? 0; }
export function getCombatAwarenessBonus(character: Pick<Character, "roleAbilities">, specialty: string): number { return character.roleAbilities.find((ability) => ability.abilityId === "combat_awareness")?.specialties?.[specialty] ?? 0; }
export function setCombatAwarenessAllocation(character: Character, specialties: Record<string, number>): Character | null { const ability = character.roleAbilities.find((item) => item.abilityId === "combat_awareness"); if (!ability || Object.values(specialties).reduce((sum, value) => sum + value, 0) > ability.rank) return null; return { ...character, roleAbilities: character.roleAbilities.map((item) => item === ability ? { ...item, specialties } : item) }; }
export function resetCombatAwarenessAllocation(character: Character): Character | null { return setCombatAwarenessAllocation(character, {}); }
export function addPrimaryRole(character: Character, roleId: RoleId): Character { const definition = roleDefinitions[roleId]; return { ...character, primaryRole: roleId, identity: { ...character.identity, role: definition.name }, roleAbilities: [{ roleId, abilityId: definition.abilityId, rank: 4 }], teamMembers: [], familyVehicles: [] }; }
export function canMulticlass(character: Character): boolean { return !!character.roleAbilities.at(-1) && character.roleAbilities.at(-1)!.rank >= 4; }
export function addMulticlassRole(character: Character, roleId: RoleId): Character | null { if (!canMulticlass(character) || character.roleAbilities.some((item) => item.roleId === roleId)) return null; const definition = roleDefinitions[roleId]; return { ...character, roleAbilities: [...character.roleAbilities, { roleId, abilityId: definition.abilityId, rank: 1 }] }; }
export function spendIPOnRoleAbility(character: Character, roleId: RoleId): Character | null { const ability = character.roleAbilities.find((item) => item.roleId === roleId); if (!ability || ability.rank >= 10) return null; const nextRank = ability.rank + 1; const cost = getRoleAbilityIPCost(nextRank); if (character.ip < cost) return null; return { ...character, ip: character.ip - cost, progression: { improvementPoints: character.ip - cost }, roleAbilities: character.roleAbilities.map((item) => item === ability ? { ...item, rank: nextRank } : item) }; }
export function setRoleSpecialties(character: Character, roleId: RoleId, specialties: Record<string, number>): Character | null {
  const ability = character.roleAbilities.find((item) => item.roleId === roleId);
  if (!ability) return null;
  const limit = ability.abilityId === "maker" ? getMakerSpecialtyPoints(ability.rank) : ability.rank;
  if (Object.values(specialties).some((value) => value < 0) || Object.values(specialties).reduce((sum, value) => sum + value, 0) > limit) return null;
  return { ...character, roleAbilities: character.roleAbilities.map((item) => item === ability ? { ...item, specialties } : item) };
}
export function getTeamMemberSlots(rank: number): number { return rank >= 9 ? 3 : rank >= 5 ? 2 : rank >= 3 ? 1 : 0; }
export function requestBackup(character: Pick<Character, "roleAbilities">): { success: boolean; tier: string } {
  const rank = character.roleAbilities.find((ability) => ability.abilityId === "backup")?.rank ?? 0;
  return { success: rank > 0, tier: rank > 0 ? getBackupTier(rank) : "None" };
}
export function resolveBackupArrival(): { arrivalMinutes: number } { return { arrivalMinutes: Math.floor(Math.random() * 6) + 1 }; }
export function addFamilyVehicle(character: Character, name: string): Character | null {
  const rank = character.roleAbilities.find((ability) => ability.abilityId === "moto")?.rank ?? 0;
  if (!getNomadVehicleOptions(rank).includes(name)) return null;
  return { ...character, familyVehicles: [...character.familyVehicles, { id: crypto.randomUUID(), name, upgrades: [] }] };
}
export function upgradeFamilyVehicle(character: Character, vehicleId: string, upgrade: string): Character | null {
  if (!character.roleAbilities.some((ability) => ability.abilityId === "moto")) return null;
  const vehicle = character.familyVehicles.find((item) => item.id === vehicleId);
  if (!vehicle) return null;
  return { ...character, familyVehicles: character.familyVehicles.map((item) => item.id === vehicleId ? { ...item, upgrades: [...item.upgrades, upgrade] } : item) };
}