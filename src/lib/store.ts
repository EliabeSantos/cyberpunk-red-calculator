import { getCatalogItem, type CatalogItem } from "@/data/items";
import type { Character, InventoryItem } from "@/types/character";

export type PurchaseResult = { character: Character; item: CatalogItem } | { error: "item-not-found" | "insufficient-funds" };
export type SaleResult = { character: Character; item: CatalogItem; quantity: number; proceeds: number } | { error: "item-not-found" | "not-in-inventory" | "invalid-quantity" };
/** The only catalog-to-inventory acquisition path, used by paid and free acquisitions. */
export function addCatalogItemToInventory(character: Character, item: CatalogItem, quantity = item.quantity ?? 1): Character {
  if (!Number.isInteger(quantity) || quantity <= 0) return character;
  const existing = character.inventory.find((inventoryItem) => inventoryItem.catalogItemId === item.id);
  const inventory: InventoryItem[] = existing ? character.inventory.map((inventoryItem) => inventoryItem.catalogItemId === item.id ? { ...inventoryItem, quantity: inventoryItem.quantity + quantity } : inventoryItem) : [...character.inventory, { id: crypto.randomUUID(), catalogItemId: item.id, name: item.name, category: item.category, quantity, notes: item.description ?? item.effects?.join(" ") }];
  return { ...character, inventory };
}
export function canPurchaseItem(character: Character, item: CatalogItem): boolean { return character.wallet.eurodollars >= item.price; }
export function purchaseItem(character: Character, itemId: string): PurchaseResult { const item = getCatalogItem(itemId); if (!item) return { error: "item-not-found" }; if (!canPurchaseItem(character, item)) return { error: "insufficient-funds" }; return { character: { ...addCatalogItemToInventory(character, item), wallet: { eurodollars: character.wallet.eurodollars - item.price } }, item }; }
export function getItemForFree(character: Character, itemId: string): PurchaseResult { const item = getCatalogItem(itemId); if (!item) return { error: "item-not-found" }; return { character: addCatalogItemToInventory(character, item), item }; }
export function getSellPrice(price: number): number { return Math.floor(price * 0.1); }
export function sellInventoryItem(character: Character, inventoryItemId: string, quantity = 1): SaleResult {
  if (!Number.isInteger(quantity) || quantity <= 0) return { error: "invalid-quantity" };
  const inventoryItem = character.inventory.find((item) => item.id === inventoryItemId);
  if (!inventoryItem || !inventoryItem.catalogItemId) return { error: "not-in-inventory" };
  const item = getCatalogItem(inventoryItem.catalogItemId); if (!item) return { error: "item-not-found" };
  if (quantity > inventoryItem.quantity) return { error: "invalid-quantity" };
  const inventory = inventoryItem.quantity === quantity ? character.inventory.filter((item) => item.id !== inventoryItemId) : character.inventory.map((item) => item.id === inventoryItemId ? { ...item, quantity: item.quantity - quantity } : item);
  const proceeds = getSellPrice(item.price) * quantity;
  return { character: { ...character, inventory, wallet: { eurodollars: character.wallet.eurodollars + proceeds } }, item, quantity, proceeds };
}
export function addEurodollars(character: Character, amount: number): Character { return amount > 0 ? { ...character, wallet: { eurodollars: character.wallet.eurodollars + amount } } : character; }