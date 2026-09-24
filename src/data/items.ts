import rawCatalog from "@/data/items.json" with { type: "json" };

export type ItemCategory = "cyberware" | "weapon" | "armor" | "healing" | "grenade" | "ammunition" | "electronics" | "netrunner" | "tool" | "drone" | "survival" | "clothing" | "consumable" | "drug" | "gear" | "mission_item";
export interface CatalogItem { id: string; name: string; category: ItemCategory; subcategory?: string; price: number; description?: string; effects?: string[]; quantity?: number; /** HP restaurados ao usar o item. */ hpRestore?: number; /** Item estabiliza personagem Mortally Wounded (encerra Death Saves). */ stabilizes?: boolean; [key: string]: unknown; }
type ItemCatalog = { version: string; source: string; items: CatalogItem[] };
export const itemCatalog = rawCatalog as ItemCatalog;
export const catalogItems = itemCatalog.items;
export function getCatalogItem(itemId: string): CatalogItem | undefined { return catalogItems.find((item) => item.id === itemId); }