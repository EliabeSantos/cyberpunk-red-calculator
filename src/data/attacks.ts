import type { CatalogItem } from "@/data/items";
import type { AttackType } from "@/types/attack";

export type WeaponAttackProfile = { type: AttackType; skillId: string };
/** Perfis centralizados para os subtipos já presentes no catálogo. */
const subcategoryProfiles: Record<string, WeaponAttackProfile> = {
  handgun: { type: "handgun", skillId: "handgun" },
  smg: { type: "smg", skillId: "shoulder_arms" },
  rifle: { type: "rifle", skillId: "shoulder_arms" },
  shotgun: { type: "shotgun", skillId: "shoulder_arms" },
  heavy: { type: "heavy_weapon", skillId: "heavy_weapons" },
  melee: { type: "melee", skillId: "melee_weapon" },
};
export function getWeaponAttackProfile(item: Pick<CatalogItem, "subcategory">): WeaponAttackProfile | undefined { return item.subcategory ? subcategoryProfiles[item.subcategory] : undefined; }

/** Cyberwares que viram uma arma própria ao serem instalados: a skill vem daqui,
 * o dano e o ROF vêm do catálogo (campos `damage`/`rof` já declarados no item). */
const integratedWeaponProfiles: Record<string, WeaponAttackProfile> = {
  mantis_blades: { type: "melee", skillId: "melee_weapon" },
  monowire: { type: "melee", skillId: "melee_weapon" },
  projectile_launch_system: { type: "heavy_weapon", skillId: "heavy_weapons" },
};

export type IntegratedWeaponProfile = WeaponAttackProfile & { name: string; damage: string; rateOfFire?: number };

/** Perfil da arma integrada do cyberware, ou undefined quando o item não gera arma. */
export function getIntegratedWeaponProfile(item: CatalogItem): IntegratedWeaponProfile | undefined {
  const profile = integratedWeaponProfiles[item.id];
  if (!profile || typeof item.damage !== "string") return undefined;
  return {
    ...profile,
    name: item.name,
    damage: item.damage,
    rateOfFire: typeof item.rof === "number" ? item.rof : undefined,
  };
}