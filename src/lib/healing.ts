import { getCatalogItem } from "@/data/items";
import type { Character, InventoryItem } from "@/types/character";

/** Fallback para itens sem `hpRestore` explícito (ex.: notas do jogador "Recupera 5 HP."). */
const HP_RESTORE_PATTERN = /recupera\s+(\d+)\s+hp/i;

/** Quantidade de HP que o item restaura quando usado, ou `null` se o item não restaura HP. */
export function getItemHealAmount(item: InventoryItem): number | null {
  const catalogItem = item.catalogItemId ? getCatalogItem(item.catalogItemId) : null;
  const explicit = catalogItem?.hpRestore;
  if (typeof explicit === "number" && explicit > 0) return explicit;

  const text = [
    catalogItem?.description ?? "",
    ...(catalogItem?.effects ?? []),
    item.notes ?? "",
  ].join(" ");
  const match = text.match(HP_RESTORE_PATTERN);
  const amount = match ? Number(match[1]) : 0;
  return amount > 0 ? amount : null;
}

/** true quando o item estabiliza um personagem Mortally Wounded (encerra os Death Saves). */
export function doesItemStabilize(item: InventoryItem): boolean {
  const catalogItem = item.catalogItemId ? getCatalogItem(item.catalogItemId) : null;
  if (catalogItem?.stabilizes === true) return true;
  return (catalogItem?.effects ?? []).some((effect) => /estabiliza/i.test(effect));
}

/** true quando o item restaura HP e há unidades disponíveis para uso. */
export function isHealingItem(item: InventoryItem): boolean {
  return item.quantity > 0 && getItemHealAmount(item) !== null;
}

export interface HealingItemResult {
  character: Character;
  itemId: string;
  itemName: string;
  hpBefore: number;
  hpAfter: number;
  /** HP efetivamente recuperados (pode ser menor que o total do item ao estar no máximo). */
  restored: number;
  /** true quando o uso encerrou os Death Saves pendentes (estabilização ou recuperação acima de 0 HP). */
  stabilized: boolean;
}

/** Usa um item de cura do inventário: restaura o HP projetado do item, estabiliza se aplicável
 * e consome 1 unidade. */
export function applyHealingItem(
  character: Character,
  inventoryItemId: string
): HealingItemResult | { error: string } {
  const item = character.inventory.find((entry) => entry.id === inventoryItemId);
  if (!item) return { error: "Item não encontrado no inventário." };
  if (item.quantity <= 0) return { error: "Você não tem mais unidades deste item." };
  if (character.combat.isDead) return { error: "Não é possível usar itens em um personagem morto." };

  const amount = getItemHealAmount(item);
  if (amount === null) return { error: "Este item não restaura HP." };

  const stabilizes = doesItemStabilize(item);
  const hpBefore = character.combat.hp.current;
  let hpAfter = Math.min(character.combat.hp.max, hpBefore + amount);
  let stabilized = false;

  if (hpBefore <= 0) {
    if (stabilizes) {
      // Estabilização: para os Death Saves e retorna para pelo menos 1 HP
      // (mesma convenção usada por First Aid em damage.ts).
      hpAfter = Math.max(hpAfter, 1);
      stabilized = true;
    } else if (hpAfter > 0) {
      // Recuperou acima de 0 HP sem estabilização explícita: encerra os Death Saves pendentes
      // para o personagem não ficar preso rolando Death Saves sem conseguir usar First Aid.
      stabilized = true;
    }
  }

  const inventory = character.inventory
    .map((entry) =>
      entry.id === inventoryItemId ? { ...entry, quantity: entry.quantity - 1 } : entry
    )
    .filter((entry) => entry.quantity > 0);

  const updatedCharacter: Character = {
    ...character,
    combat: {
      ...character.combat,
      hp: { ...character.combat.hp, current: hpAfter },
      deathSaveDC: stabilized ? 0 : character.combat.deathSaveDC,
      deathSaveFailures: stabilized ? 0 : character.combat.deathSaveFailures,
    },
    inventory,
  };

  return {
    character: updatedCharacter,
    itemId: item.id,
    itemName: item.name,
    hpBefore,
    hpAfter,
    restored: Math.max(0, hpAfter - hpBefore),
    stabilized,
  };
}
