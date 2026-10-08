import type { NetBlackIce, NetProgram } from "@/lib/mesa/types";
import type { RandomSource } from "@/lib/combat/contract";

export type NetAttackResolution = {
  roll: number;
  bonus: number;
  total: number;
  defense: number;
  hit: boolean;
};

/** NET combat uses the same server RNG/authority, but never physical HP/armor. */
export function resolveNetAttack(input: {
  interfaceRank: number;
  programAttackBonus: number;
  defense: number;
  rng: RandomSource;
}): NetAttackResolution {
  const roll = input.rng.d10();
  const bonus = input.interfaceRank + input.programAttackBonus;
  return { roll, bonus, total: roll + bonus, defense: input.defense, hit: roll + bonus > input.defense };
}

export function applyProgramDamage(program: NetProgram, damage: number): NetProgram {
  const rezz = Math.max(0, program.rezz - Math.max(0, Math.floor(damage)));
  return { ...program, rezz, state: rezz <= 0 ? "destroyed" : "active" };
}

export function activateBlackIce(ice: NetBlackIce, rng: RandomSource, netrunnerId: string): NetBlackIce {
  if (ice.state !== "inactive") return ice;
  return { ...ice, state: "active", initiative: rng.d10() + ice.speed, engagedNetrunnerId: netrunnerId };
}

export function slideBlackIce(input: { ice: NetBlackIce; interfaceRank: number; programBonus: number; rng: RandomSource }): { ice: NetBlackIce; resolution: NetAttackResolution } {
  const resolution = resolveNetAttack({ interfaceRank: input.interfaceRank, programAttackBonus: input.programBonus, defense: input.ice.per, rng: input.rng });
  return { resolution, ice: resolution.hit ? { ...input.ice, engagedNetrunnerId: undefined } : input.ice };
}

export function iceAttack(input: { ice: NetBlackIce; targetDefense: number; rng: RandomSource }): NetAttackResolution {
  return resolveNetAttack({ interfaceRank: 0, programAttackBonus: input.ice.attack, defense: input.targetDefense, rng: input.rng });
}

export function brainDamageForIce(ice: NetBlackIce): number {
  return Math.max(0, Math.floor(ice.brainDamage ?? 0));
}
