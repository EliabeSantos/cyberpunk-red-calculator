import { getCatalogItem } from "@/data/items";
import { applyHumanityLoss, rollHumanityLoss, type HumanityLossResult } from "@/lib/humanity";
import type { Character, CyberwareItem, InventoryItem } from "@/types/character";

export type CyberwareInstallationResult = { character: Character; humanityLoss: HumanityLossResult | null };

/** Instala o cyberware, aplica e registra a Humanity Loss somente neste momento. */
export function installCyberware(character: Character, inventoryItem: InventoryItem): CyberwareInstallationResult {
  const catalogItem = inventoryItem.catalogItemId ? getCatalogItem(inventoryItem.catalogItemId) : undefined;
  const source = { id: inventoryItem.catalogItemId ?? inventoryItem.id, name: inventoryItem.name, humanityLoss: typeof catalogItem?.humanityLoss === "string" || typeof catalogItem?.humanityLoss === "number" ? catalogItem.humanityLoss : undefined };
  const rolledLoss = rollHumanityLoss(source);
  const removedInventory = inventoryItem.quantity > 1 ? character.inventory.map((item) => item.id === inventoryItem.id ? { ...item, quantity: item.quantity - 1 } : item) : character.inventory.filter((item) => item.id !== inventoryItem.id);
  const cyberware: CyberwareItem = { id: crypto.randomUUID(), name: inventoryItem.name, humanityLoss: source.humanityLoss === undefined ? undefined : String(source.humanityLoss), installedAt: new Date().toISOString() };
  let updated: Character = { ...character, inventory: removedInventory, cyberware: [...character.cyberware, cyberware] };
  if (!rolledLoss) return { character: updated, humanityLoss: null };
  const applied = applyHumanityLoss(updated, rolledLoss.humanityLost, `${source.name} — instalação`, { expression: rolledLoss.expression, rolls: rolledLoss.rolls, cyberwareId: source.id, cyberwareName: source.name });
  return { character: applied.character, humanityLoss: { ...rolledLoss, humanityBefore: applied.humanityBefore, humanityAfter: applied.humanityAfter } };
}