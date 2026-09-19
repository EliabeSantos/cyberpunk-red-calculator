import { getCatalogItem } from "@/data/items";
import { getWeaponAttackProfile } from "@/data/attacks";
import { installCyberware, type CyberwareInstallationResult } from "@/lib/cyberware";
import type { Character, InventoryItem, Weapon } from "@/types/character";

export type EquipResult = { character: Character; cyberwareInstallation?: CyberwareInstallationResult };
export function isEquippableItem(item: InventoryItem): boolean { return item.category === "cyberware" || item.category === "weapon" || item.category === "armor"; }
/** Move um item do inventário à área correspondente; instalar cyberware aplica Humanity Loss. */
export function equipInventoryItem(character: Character, inventoryItemId: string): EquipResult | null {
  const inventoryItem = character.inventory.find((item) => item.id === inventoryItemId);
  if (!inventoryItem || !isEquippableItem(inventoryItem)) return null;
  if (inventoryItem.category === "cyberware") { const cyberwareInstallation = installCyberware(character, inventoryItem); return { character: cyberwareInstallation.character, cyberwareInstallation }; }
  const catalogItem = inventoryItem.catalogItemId ? getCatalogItem(inventoryItem.catalogItemId) : undefined;
  const inventory = inventoryItem.quantity > 1 ? character.inventory.map((item) => item.id === inventoryItemId ? { ...item, quantity: item.quantity - 1 } : item) : character.inventory.filter((item) => item.id !== inventoryItemId);
  if (inventoryItem.category === "weapon") {
    const attackProfile = catalogItem ? getWeaponAttackProfile(catalogItem) : undefined;
    const weapon: Weapon = { id: crypto.randomUUID(), catalogItemId: inventoryItem.catalogItemId, name: inventoryItem.name, damage: typeof catalogItem?.damage === "string" ? catalogItem.damage : "—", rateOfFire: typeof catalogItem?.rof === "number" ? catalogItem.rof : undefined, magazine: typeof catalogItem?.ammo === "number" ? catalogItem.ammo : undefined, ammo: typeof catalogItem?.ammo === "number" ? catalogItem.ammo : undefined, skill: attackProfile?.skillId, attackType: attackProfile?.type };
    return { character: { ...character, inventory, weapons: [...character.weapons, weapon] } };
  }
  const sp = typeof catalogItem?.sp === "number" ? catalogItem.sp : 0;
  const armor = catalogItem?.subcategory === "head" ? { ...character.combat.armor, head: sp } : { ...character.combat.armor, body: sp };
  return { character: { ...character, inventory, combat: { ...character.combat, armor } } };
}