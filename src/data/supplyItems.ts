/**
 * F1.13.2 — **ID ESTÁVEL** do item dentro de uma mochila (`supplies.inventory`).
 *
 * Até aqui a identidade de um item da mochila era o NOME (`entry.item`): dois
 * pedidos de munição com rótulos diferentes eram dois itens, e um item renomeado
 * virava outro. O modelo passa a carregar o id explícito ao lado do nome:
 *
 *     { itemId: "stim", item: "Stim", quantity: 2 }
 *
 * `item` continua sendo o rótulo de apresentação — nada de renomear colunas nem
 * mudar o formato que inimigo/reload/characterSync já leem.
 *
 * ## De onde vem o id (sem inventar segunda taxonomia)
 *
 * 1. **Catálogo do jogador** (`src/data/items.json`): se o nome existe lá, o id
 *    É o `CatalogItem.id` real (`"Stim"` → `stim`, `"Pistol Ammunition"` →
 *    `pistol_ammo`). É a mesma taxonomia que a ficha usa em `catalogItemId`.
 * 2. **Slug determinístico** para o que não está no catálogo (nomes do
 *    bestiário, ex.: `"Trauma Patch"` → `trauma_patch`).
 *
 * A regra (2) é replicada **literalmente** na migration SQL
 * `20261010000000_mesa_supply_item_ids.sql`, que normaliza as mochilas já
 * gravadas — mesma chave, mesmos resultados, sem divergência entre o que o
 * banco grava e o que o servidor deriva.
 *
 * Módulo puro: nada de DOM, rede, Supabase ou React.
 */
import { catalogItems } from "@/data/items";
import type { EnemySupply } from "@/types/enemy";

/** Chave de comparação de nome: trim + minúsculas. */
function nameKey(name: unknown): string {
  return typeof name === "string" ? name.trim().toLowerCase() : "";
}

/**
 * Slug determinístico — **a mesma expressão** da função SQL
 * `public.mesa_supply_item_id`. Mantenha as duas em sincronia.
 */
export function slugifySupplyItemId(name: unknown): string {
  return nameKey(name)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

/**
 * Id estável de um item da mochila a partir do RÓTULO: id do catálogo quando o
 * nome existe nele, slug determinístico quando não existe. Nome vazio → `""`.
 */
export function stableItemId(name: unknown): string {
  const key = nameKey(name);
  if (key.length === 0) return "";
  const catalogItem = catalogItems.find((entry) => nameKey(entry.name) === key);
  if (typeof catalogItem?.id === "string" && catalogItem.id.length > 0) return catalogItem.id;
  return slugifySupplyItemId(key);
}

/** Id efetivo de uma entrada da mochila: o persistido, senão o derivado. */
export function resolveSupplyItemId(entry: { item?: unknown; itemId?: unknown }): string {
  const stored = typeof entry.itemId === "string" ? entry.itemId.trim() : "";
  if (stored.length > 0) return stored;
  return stableItemId(entry.item);
}

/** Localiza uma entrada da mochila pelo id estável (nunca pelo rótulo). */
export function findSupplyEntry(
  inventory: readonly EnemySupply[] | null | undefined,
  itemId: string,
): EnemySupply | null {
  if (!itemId) return null;
  return inventory?.find((entry) => resolveSupplyItemId(entry) === itemId) ?? null;
}

/**
 * Normaliza uma mochila crua: id em todas as entradas, pilhas de mesmo id
 * somadas, quantidades inválidas descartadas e ordem estável.
 *
 * Usado em TODO caminho de escrita (`sanitizeSupplies`, mochila da ficha na
 * Mesa, consumo e cura) — é o que mantém o dado gravado compatível com o que a
 * migration faz no banco.
 */
export function normalizeSupplyInventory(items: unknown): EnemySupply[] {
  const source = Array.isArray(items) ? items : [];
  const merged = new Map<string, EnemySupply>();

  for (const raw of source) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    const name = typeof entry.item === "string" ? entry.item.trim().slice(0, 60) : "";
    const quantity = Math.floor(Number(entry.quantity));
    if (name.length === 0) continue;
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    const itemId = resolveSupplyItemId({ item: name, itemId: entry.itemId });
    if (itemId.length === 0) continue;

    const existing = merged.get(itemId);
    if (existing) existing.quantity += quantity;
    else merged.set(itemId, { itemId, item: name, quantity });
  }

  return Array.from(merged.values());
}
