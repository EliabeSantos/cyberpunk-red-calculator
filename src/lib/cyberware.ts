import { getCatalogItem } from "@/data/items";
import { applyHumanityLoss, rollHumanityLoss, type HumanityLossResult } from "@/lib/humanity";
import { calculateMaximumHumanityFromCyberware } from "@/lib/calculations";
import type { Character, CyberwareItem, InventoryItem } from "@/types/character";

export type CyberwareInstallationResult = { character: Character; humanityLoss: HumanityLossResult | null };

/** Determina se um item do catálogo é Borgware baseado na subcategoria. */
function isBorgwareCatalogItem(catalogItem: { subcategory?: string } | undefined): boolean {
  return catalogItem?.subcategory === "borgware";
}

/** Instala o cyberware, aplica e registra a Humanity Loss, e reduz a Maximum Humanity. */
export function installCyberware(character: Character, inventoryItem: InventoryItem): CyberwareInstallationResult {
  const catalogItem = inventoryItem.catalogItemId ? getCatalogItem(inventoryItem.catalogItemId) : undefined;
  const source = { id: inventoryItem.catalogItemId ?? inventoryItem.id, name: inventoryItem.name, humanityLoss: typeof catalogItem?.humanityLoss === "string" || typeof catalogItem?.humanityLoss === "number" ? catalogItem.humanityLoss : undefined };
  const rolledLoss = rollHumanityLoss(source);
  const removedInventory = inventoryItem.quantity > 1 ? character.inventory.map((item) => item.id === inventoryItem.id ? { ...item, quantity: item.quantity - 1 } : item) : character.inventory.filter((item) => item.id !== inventoryItem.id);
  const borgware = isBorgwareCatalogItem(catalogItem);
  const cyberware: CyberwareItem = { id: crypto.randomUUID(), name: inventoryItem.name, humanityLoss: source.humanityLoss === undefined ? undefined : String(source.humanityLoss), installedAt: new Date().toISOString(), isBorgware: borgware };
  let updated: Character = { ...character, inventory: removedInventory, cyberware: [...character.cyberware, cyberware] };
  // Reduz Maximum Humanity pelo cyberware instalado
  updated = { ...updated, humanity: { ...updated.humanity, max: calculateMaximumHumanityFromCyberware({ cyberware: updated.cyberware, stats: updated.stats }) } };
  if (!rolledLoss) return { character: updated, humanityLoss: null };
  const applied = applyHumanityLoss(updated, rolledLoss.humanityLost, `${source.name} — instalação`, { expression: rolledLoss.expression, rolls: rolledLoss.rolls, cyberwareId: source.id, cyberwareName: source.name });
  return { character: applied.character, humanityLoss: { ...rolledLoss, humanityBefore: applied.humanityBefore, humanityAfter: applied.humanityAfter } };
}

/** Remove um cyberware instalado, envia para o inventário e recalcula a Maximum Humanity.
 * A Humanity atual NÃO é restaurada automaticamente.
 */
export function removeCyberware(character: Character, cyberwareId: string): Character {
  const cyberwareIndex = character.cyberware.findIndex((cw) => cw.id === cyberwareId);
  if (cyberwareIndex === -1) return character;
  const removedCyberware = character.cyberware[cyberwareIndex];
  const updatedCyberware = character.cyberware.filter((_, i) => i !== cyberwareIndex);
  
  // Adiciona o cyberware removido ao inventário
  const inventoryItem: InventoryItem = {
    id: crypto.randomUUID(),
    name: removedCyberware.name,
    quantity: 1,
    category: "cyberware",
    notes: removedCyberware.humanityLoss ? `Perda de Humanidade: ${removedCyberware.humanityLoss}` : undefined,
  };
  
  const updated: Character = {
    ...character,
    cyberware: updatedCyberware,
    inventory: [...character.inventory, inventoryItem],
    humanity: { ...character.humanity, max: calculateMaximumHumanityFromCyberware({ cyberware: updatedCyberware, stats: character.stats }) },
  };
  return updated;
}