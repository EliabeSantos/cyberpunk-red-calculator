import { getCatalogItem } from "@/data/items";
import { getWeaponAttackProfile } from "@/data/attacks";
import { installCyberware, type CyberwareInstallationResult } from "@/lib/cyberware";
import { validateCyberwareInstall, validateWeaponEquip } from "@/lib/cyberwareEffects";
import type { Character, InventoryItem, Weapon } from "@/types/character";
import { createId } from "@/lib/id";

export type EquipResult = { character: Character; cyberwareInstallation?: CyberwareInstallationResult };
export function isCyberdeckItem(item: Pick<InventoryItem, "catalogItemId" | "id" | "name">): boolean {
  const catalogId = (item.catalogItemId ?? item.id ?? "").trim().toLowerCase();
  const name = item.name.trim().toLowerCase();
  return catalogId === "cyberdeck" || name === "cyberdeck";
}
export function isEquippableItem(item: InventoryItem): boolean {
  return item.category === "cyberware" || item.category === "weapon" || item.category === "armor" || item.category === "netrunner" || isCyberdeckItem(item);
}
/** Move um item do inventário à área correspondente; instalar cyberware aplica Humanity Loss.
 * Retorna `{ error }` quando um requisito (pré-requisito, slot ou arma smart) não está atendido. */
export function equipInventoryItem(character: Character, inventoryItemId: string): EquipResult | { error: string } | null {
  const inventoryItem = character.inventory.find((item) => item.id === inventoryItemId);
  if (!inventoryItem || !isEquippableItem(inventoryItem)) return null;
  const catalogItem = inventoryItem.catalogItemId ? getCatalogItem(inventoryItem.catalogItemId) : undefined;
  if (isCyberdeckItem(inventoryItem)) {
    return {
      character: {
        ...character,
        inventory: character.inventory.map((item) => item.id === inventoryItemId ? { ...item, equipped: item.equipped !== true } : item),
      },
    };
  }
  if (inventoryItem.category === "cyberware") {
    if (catalogItem) {
      const requirement = validateCyberwareInstall(character, catalogItem);
      if (requirement) return requirement;
    }
    const cyberwareInstallation = installCyberware(character, inventoryItem);
    return { character: cyberwareInstallation.character, cyberwareInstallation };
  }
  const inventory = inventoryItem.quantity > 1 ? character.inventory.map((item) => item.id === inventoryItemId ? { ...item, quantity: item.quantity - 1 } : item) : character.inventory.filter((item) => item.id !== inventoryItemId);
  if (inventoryItem.category === "weapon") {
    if (catalogItem) {
      const requirement = validateWeaponEquip(character, catalogItem);
      if (requirement) return requirement;
    }
    const attackProfile = catalogItem ? getWeaponAttackProfile(catalogItem) : undefined;
  const weapon: Weapon = { id: createId(), catalogItemId: inventoryItem.catalogItemId, name: inventoryItem.name, damage: typeof catalogItem?.damage === "string" ? catalogItem.damage : "—", rateOfFire: typeof catalogItem?.rof === "number" ? catalogItem.rof : undefined, magazine: typeof catalogItem?.ammo === "number" ? catalogItem.ammo : undefined, ammo: typeof catalogItem?.ammo === "number" ? catalogItem.ammo : undefined, skill: attackProfile?.skillId, attackType: attackProfile?.type };
    return { character: { ...character, inventory, weapons: [...character.weapons, weapon] } };
  }
  const sp = typeof catalogItem?.sp === "number" ? catalogItem.sp : 0;
  const armor = catalogItem?.subcategory === "head" ? { ...character.combat.armor, head: sp } : { ...character.combat.armor, body: sp };
  return { character: { ...character, inventory, combat: { ...character.combat, armor } } };
}
