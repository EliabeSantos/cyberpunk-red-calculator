import { getCatalogItem, type CatalogItem } from "@/data/items";
import type { Character, InventoryItem } from "@/types/character";

export type PurchaseResult = { character: Character; item: CatalogItem } | { error: "item-not-found" | "insufficient-funds" };
export function canPurchaseItem(character: Character, item: CatalogItem): boolean { return character.wallet.eurodollars >= item.price; }
export function purchaseItem(character: Character, itemId: string): PurchaseResult {
  const item = getCatalogItem(itemId);
  if (!item) return { error: "item-not-found" };
  if (!canPurchaseItem(character, item)) return { error: "insufficient-funds" };
  const existing = character.inventory.find((inventoryItem) => inventoryItem.catalogItemId === item.id);
  const quantity = item.quantity ?? 1;
  const inventory: InventoryItem[] = existing
    ? character.inventory.map((inventoryItem) => inventoryItem.catalogItemId === item.id ? { ...inventoryItem, quantity: inventoryItem.quantity + quantity } : inventoryItem)
    : [...character.inventory, { id: crypto.randomUUID(), catalogItemId: item.id, name: item.name, category: item.category, quantity, notes: item.description ?? item.effects?.join(" ") }];
  return { character: { ...character, wallet: { eurodollars: character.wallet.eurodollars - item.price }, inventory }, item };
}
export function addEurodollars(character: Character, amount: number): Character { return amount > 0 ? { ...character, wallet: { eurodollars: character.wallet.eurodollars + amount } } : character; }