/**
 * F1.46 — fonte canônica das tabelas de alcance/DV do Cyberpunk RED.
 *
 * A tabela é definida uma única vez aqui. O catálogo apenas escolhe qual
 * perfil uma arma usa (`rangeProfile`); Tactical Map e o gateway do servidor
 * chamam o mesmo resolver abaixo.
 *
 * As faixas do livro são expressas em metros inteiros. A política desta
 * aplicação é arredondar a distância real para cima antes de consultar a
 * tabela (a mesma convenção histórica de `tacticalDistance`). Assim, os
 * limites são determinísticos também quando a posição produz uma fração.
 */
import { getCatalogItem } from "@/data/items";
import type { CombatWeapon } from "@/lib/combat/contract";

export type WeaponRangeBand =
  | "point_blank"
  | "close"
  | "medium"
  | "long"
  | "extreme"
  | "very_long"
  | "ultra"
  | "maximum";

export type WeaponRangeProfileId =
  | "pistol"
  | "smg"
  | "shotgun"
  | "assault_rifle"
  | "sniper_rifle"
  | "grenade_launcher"
  | "rocket_launcher";

export interface WeaponRangeBandDefinition {
  band: WeaponRangeBand;
  minMeters: number;
  maxMeters: number;
  dv: number;
}

export interface WeaponRangeProfile {
  id: WeaponRangeProfileId;
  label: string;
  bands: readonly WeaponRangeBandDefinition[];
}

export type WeaponRangeResolution =
  | {
      status: "valid";
      distanceMeters: number;
      normalizedDistanceMeters: number;
      profileId: WeaponRangeProfileId;
      band: WeaponRangeBand;
      minMeters: number;
      maxMeters: number;
      dv: number;
    }
  | {
      status: "out_of_range";
      distanceMeters: number;
      normalizedDistanceMeters: number;
      profileId: WeaponRangeProfileId;
      maxMeters: number;
    }
  | {
      status: "undefined";
      distanceMeters: number;
      reason: "missing_profile" | "invalid_profile" | "invalid_distance";
    };

const BAND_ORDER: readonly WeaponRangeBand[] = [
  "point_blank",
  "close",
  "medium",
  "long",
  "extreme",
  "very_long",
  "ultra",
  "maximum",
];

const BAND_LABELS: Record<WeaponRangeBand, string> = {
  point_blank: "Point Blank",
  close: "Close",
  medium: "Medium",
  long: "Long",
  extreme: "Extreme",
  very_long: "Very Long",
  ultra: "Ultra",
  maximum: "Maximum",
};

function bands(dvs: readonly number[], lastBand: number): WeaponRangeBandDefinition[] {
  const limits: readonly [number, number][] = [
    [0, 6],
    [7, 12],
    [13, 25],
    [26, 50],
    [51, 100],
    [101, 200],
    [201, 400],
    [401, 800],
  ];
  return limits.slice(0, lastBand + 1).map(([minMeters, maxMeters], index) => ({
    band: BAND_ORDER[index],
    minMeters,
    maxMeters,
    dv: dvs[index],
  }));
}

/** Valores oficiais da tabela Single Shot de alcance/DV do Core Rulebook. */
export const WEAPON_RANGE_PROFILES: Readonly<Record<WeaponRangeProfileId, WeaponRangeProfile>> = {
  pistol: { id: "pistol", label: "Pistol", bands: bands([13, 15, 20, 25, 30, 30], 5) },
  smg: { id: "smg", label: "SMG", bands: bands([13, 15, 20, 25, 30, 30], 5) },
  shotgun: { id: "shotgun", label: "Shotgun", bands: bands([13, 15, 20, 25, 30, 35], 5) },
  assault_rifle: { id: "assault_rifle", label: "Assault Rifle", bands: bands([17, 16, 15, 13, 15, 20, 25, 30], 7) },
  sniper_rifle: { id: "sniper_rifle", label: "Sniper Rifle", bands: bands([30, 25, 25, 20, 20, 20, 25, 30], 7) },
  grenade_launcher: { id: "grenade_launcher", label: "Grenade Launcher", bands: bands([16, 15, 15, 17, 20, 22, 25], 6) },
  rocket_launcher: { id: "rocket_launcher", label: "Rocket Launcher", bands: bands([17, 16, 15, 15, 20, 20, 25, 30], 7) },
};

export function rangeBandLabel(band: WeaponRangeBand): string {
  return BAND_LABELS[band];
}

/** Validação estrutural usada pelo catálogo e pelo resolver. */
export function isValidWeaponRangeProfile(value: unknown): value is WeaponRangeProfile {
  if (typeof value !== "object" || value === null) return false;
  const profile = value as Partial<WeaponRangeProfile>;
  if (typeof profile.id !== "string" || !Object.prototype.hasOwnProperty.call(WEAPON_RANGE_PROFILES, profile.id)) return false;
  if (!Array.isArray(profile.bands) || profile.bands.length === 0) return false;
  let previousMax = -1;
  for (let index = 0; index < profile.bands.length; index += 1) {
    const entry = profile.bands[index];
    if (!entry || entry.band !== BAND_ORDER[index]) return false;
    if (!Number.isInteger(entry.minMeters) || !Number.isInteger(entry.maxMeters) || !Number.isInteger(entry.dv)) return false;
    if (entry.minMeters < 0 || entry.minMeters > entry.maxMeters || entry.dv < 0) return false;
    if (entry.minMeters !== previousMax + 1) return false;
    previousMax = entry.maxMeters;
  }
  return true;
}

/** Resolver puro: não lê React, mapa, banco nem valores enviados pelo cliente. */
export function resolveWeaponRangeBand(
  distanceMeters: number,
  profile: WeaponRangeProfile | null | undefined,
): WeaponRangeResolution {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    return { status: "undefined", distanceMeters, reason: "invalid_distance" };
  }
  if (!profile) {
    return { status: "undefined", distanceMeters, reason: "missing_profile" };
  }
  if (!isValidWeaponRangeProfile(profile)) {
    return { status: "undefined", distanceMeters, reason: "invalid_profile" };
  }

  const normalizedDistanceMeters = Math.ceil(distanceMeters);
  const resolved = profile.bands.find(
    (entry) => normalizedDistanceMeters >= entry.minMeters && normalizedDistanceMeters <= entry.maxMeters,
  );
  if (!resolved) {
    return {
      status: "out_of_range",
      distanceMeters,
      normalizedDistanceMeters,
      profileId: profile.id,
      maxMeters: profile.bands[profile.bands.length - 1].maxMeters,
    };
  }
  return {
    status: "valid",
    distanceMeters,
    normalizedDistanceMeters,
    profileId: profile.id,
    band: resolved.band,
    minMeters: resolved.minMeters,
    maxMeters: resolved.maxMeters,
    dv: resolved.dv,
  };
}

/** Resolve o perfil declarado pelo catálogo para Player e Enemy igualmente. */
export function getWeaponRangeProfile(weapon: Pick<CombatWeapon, "id" | "catalogItemId"> | null | undefined): WeaponRangeProfile | undefined {
  if (!weapon) return undefined;
  const catalogId = weapon.catalogItemId ?? weapon.id;
  if (!catalogId) return undefined;
  const profileId = getCatalogItem(catalogId)?.rangeProfile;
  return typeof profileId === "string" && Object.prototype.hasOwnProperty.call(WEAPON_RANGE_PROFILES, profileId)
    ? WEAPON_RANGE_PROFILES[profileId as WeaponRangeProfileId]
    : undefined;
}

/** A lista de ids de ataque à distância já usada pelo Combat Engine. */
export function isRangedWeaponAttack(attackType?: string, skillId?: string): boolean {
  return new Set([
    "handgun",
    "smg",
    "rifle",
    "shotgun",
    "sniper",
    "heavy_weapon",
    "thrown_weapon",
    "grenade",
    "exotic_weapon",
  ]).has(attackType ?? "") || new Set(["archery", "autofire", "handgun", "heavy_weapons", "shoulder_arms"]).has(skillId ?? "");
}
