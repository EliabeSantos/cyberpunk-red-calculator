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