/**
 * SUPRIMENTOS DOS INIMIGOS: munição e itens de cura.
 *
 * Mesmo espírito dos implantes (`enemyImplants.ts`): quando um encontro é
 * criado, cada inimigo **já vem com a mochila montada** — a diferença é que
 * aqui quase nada é sorteado às cegas:
 *
 *  1. **Munição é garantida.** A mochila começa pelo `inventory` do JSON do
 *     bestiário (palavra final) e, quando o inimigo tem arma de pente mas não
 *     trouxe munição compatível, entra o equivalente a **2 cargas cheias** —
 *     o mesmo que os autores do JSON já fazem manualmente (16 de pistola de 8,
 *     50 de fuzil de 25...).
 *  2. **Cura é só uma possibilidade.** Sem item de cura nenhum, há **50% de
 *     chance** de receber **1 ou 2 unidades** de um item do catálogo. Quem já
 *     trouxe "Trauma Patch" no JSON não rola nada.
 *
 * Depois de pronta, a mochila entra na rolagem do inimigo do mesmo jeito que a
 * do jogador: o ataque gasta 1 bala do pente (`gmStorage.rollAttack`), o
 * botão de recarregar consome a reserva e o item de cura restaura HP.
 *
 * MOVE (Adrenaline Booster) fica de fora de propósito: move orçamento de
 * deslocamento, não dado — ver `PENDENCIAS.md`.
 */
import { catalogItems } from "@/data/items";
import type { EnemySupply, EnemyWeapon } from "@/types/enemy";

/** Tipo de munição que uma arma de pente consome. `null` = corpo a corpo. */
export type AmmoKind = "pistol" | "smg" | "rifle" | "shotgun";

/** Cargas cheias que um inimigo SEM munição no JSON recebe (decisão de 30/09/2026). */
export const MAGAZINES_PER_ENEMY = 2;

/** Chance de o inimigo ganhar um item de cura na criação do encontro. */
export const HEALING_CHANCE = 0.5;

/**
 * Palavras-chave que identificam a QUALIDADE de um item de munição.
 * Comparam-se em minúsculas contra o nome do item ("Heavy Pistol Ammo").
 */
const KIND_KEYWORDS: Record<AmmoKind, readonly string[]> = {
  pistol: ["pistol", "revolver", "handgun"],
  smg: ["smg", "submachine"],
  rifle: ["rifle", "carbine", "machine gun"],
  shotgun: ["shotgun", "shell"],
};

/** Nome canônico no catálogo do jogador (`items.json`) para cada qualidade. */
const AMMO_SUPPLY_NAME: Record<AmmoKind, string> = {
  pistol: "Pistol Ammunition",
  smg: "SMG Ammunition",
  rifle: "Rifle Ammunition",
  shotgun: "Shotgun Shells",
};

const AMMO_WORD = /(ammo|ammunition|muni[cç][aã]o|shell)/i;

/**
 * Nomes de cura do bestiário que **não** têm ficha no catálogo do jogador.
 * Sem esta tabela o "Trauma Patch" (15 inimigos no JSON) seria uma mochila
 * morta. Valores arredondados para o mesmo patamar do catálogo.
 */
const BESTIARY_HEALING: Record<string, number> = {
  "trauma patch": 5,
  "combat stim": 5,
  "protein pack": 3,
};

function normalize(name: unknown): string {
  return typeof name === "string" ? name.trim().toLowerCase() : "";
}

/** `true` quando o nome de um item parece ser munição ("Ammo", "Shotgun Shells"). */
export function isAmmoSupply(name: unknown): boolean {
  return AMMO_WORD.test(normalize(name));
}

function matchesKind(name: string, kind: AmmoKind): boolean {
  const lower = normalize(name);
  return KIND_KEYWORDS[kind].some((keyword) => lower.includes(keyword));
}

/** `true` quando o item pertence a QUALQUER das qualidades conhecidas. */
function matchesAnyKind(name: string): boolean {
  return (Object.keys(KIND_KEYWORDS) as AmmoKind[]).some((kind) => matchesKind(name, kind));
}

/**
 * Qualidade de munição que uma arma consome, decidida pelo NOME da arma e,
 * na falta dele, pela perícia do bestiário ("Handgun", "Shoulder Arms"...).
 * `null` para corpo a corpo (ou quando a ficha não diz `attackType` nem traz
 * pente — nada é consumido).
 */
export function getAmmoKind(
  weapon: { name?: string; skill?: string; attackType?: string; magazine?: number } | null | undefined,
): AmmoKind | null {
  if (!weapon) return null;
  if (weapon.attackType && weapon.attackType !== "ranged") return null;
  // Sem pente não há munição a gestionar (corpo a corpo e fichas antigas).
  if (typeof weapon.magazine === "number" && weapon.magazine <= 0) return null;

  const name = normalize(weapon.name);
  // O bestiário escreve a perícia pelo rótulo ("Shoulder Arms") e a ficha
  // guarda o id canônico (`shoulder_arms`) — mesmos dois, com "_" ≡ " ".
  const skill = normalize(weapon.skill).replace(/_/g, " ");

  // Ordem importa: "Heavy Pistol" não pode cair em rifle nem em SMG.
  if (name.includes("shotgun") || name.includes("escopeta")) return "shotgun";
  if (/\bsmg\b/.test(name) || name.includes("submachine")) return "smg";
  if (name.includes("rifle") || name.includes("carbine") || name.includes("machine gun")) return "rifle";
  if (name.includes("pistol") || name.includes("revolver") || name.includes("handgun")) return "pistol";

  if (skill.includes("shoulder arms") || skill.includes("heavy weapons")) return "rifle";
  if (skill.includes("autofire")) return "smg";
  if (skill.includes("handgun")) return "pistol";
  return null;
}

/** Nome canônico do item de munição gerado quando o JSON não trouxe nenhum. */
export function ammoSupplyName(kind: AmmoKind): string {
  return AMMO_SUPPLY_NAME[kind];
}

/**
 * Índice do item da mochila que alimenta uma arma de qualidade `kind`.
 *
 * Prefere o item ESPECÍFICO ("Heavy Pistol Ammo"); cai no genérico ("Ammo")
 * só quando ele não pertence a outra qualidade — um inimigo de escopeta não
 * gasta "Heavy Pistol Ammo". `-1` = nada compatível.
 */
/**
 * Índice do item da mochila que alimenta uma arma de qualidade `kind`, **pelo
 * nome** — a mesma regra de `findAmmoSupplyIndex` (que é esta função adaptada),
 * para quem guarda a mochila noutro formato (a ficha do jogador tem
 * `InventoryItem`, não `EnemySupply`).
 *
 * Prefere o item ESPECÍFICO ("Pistol Ammunition"); cai no genérico ("Ammo")
 * só quando ele não pertence a outra qualidade — uma arma de escopeta não gasta
 * munição de pistola, mesmo que a pilha dela apareça primeiro no inventário.
 * `-1` = nada compatível.
 */
export function findAmmoIndexByNames(names: readonly string[], kind: AmmoKind): number {
  const specific = names.findIndex((name) => isAmmoSupply(name) && matchesKind(name, kind));
  if (specific >= 0) return specific;
  return names.findIndex((name) => isAmmoSupply(name) && !matchesAnyKind(name));
}

export function findAmmoSupplyIndex(items: readonly EnemySupply[], kind: AmmoKind): number {
  return findAmmoIndexByNames(items.map((entry) => entry.item), kind);
}

/**
 * Retém apenas munição que pode alimentar pelo menos uma arma do snapshot.
 * A decisão continua passando pelo mesmo classificador usado no reload.
 */
export function isAmmoRelevantToWeapons(
  name: string,
  weapons: ReadonlyArray<{ name?: string; skill?: string; attackType?: string; magazine?: number }>,
): boolean {
  return weapons.some((weapon) => {
    // `planReload` classifica armas de ficha por nome/perícia; attackType
    // (`handgun`, `rifle`...) não é o marcador `ranged` usado pelo bestiário.
    const kind = getAmmoKind({ name: weapon.name, skill: weapon.skill });
    return kind !== null && findAmmoIndexByNames([name], kind) === 0;
  });
}

/**
 * HP que um item de cura restaura, ou `null` quando o item não cura.
 *
 * Resolve primeiro pelo catálogo do jogador (mesma fonte de
 * `getItemHealingAmount` da ficha) e só então pela tabela de nomes do
 * bestiário.
 */
export function getSupplyHealAmount(name: unknown): number | null {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed.length === 0) return null;

  const catalogItem = catalogItems.find(
    (item) => item.category === "healing" && item.name.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  if (typeof catalogItem?.hpRestore === "number" && catalogItem.hpRestore > 0) return catalogItem.hpRestore;

  const alias = BESTIARY_HEALING[trimmed.toLowerCase()];
  return typeof alias === "number" && alias > 0 ? alias : null;
}

/** `true` quando o item da mochila é um curativo utilizável. */
export function isHealingSupply(name: unknown): boolean {
  return getSupplyHealAmount(name) !== null;
}

/** Itens de cura prontos para sortear (só os que restauram HP de verdade). */
export function healingSupplyPool(): string[] {
  return catalogItems
    .filter((item) => item.category === "healing" && typeof item.hpRestore === "number" && item.hpRestore > 0)
    .map((item) => item.name.trim())
    .filter((name) => name.length > 0);
}

/** `true` quando a mochila já tem algo que restaure HP. */
function hasHealing(items: readonly EnemySupply[]): boolean {
  return items.some((entry) => isHealingSupply(entry.item));
}

/* -------------------------------------------------------------------------- *
 * Recarregar — a regra pura, usada pelo encontro e pelo melhoriário.
 * -------------------------------------------------------------------------- */

export interface ReloadPlan {
  /** Balas no pente AGORA / capacidade do pente. */
  ammo: number;
  magazine: number;
  /** Índice do item da mochila que alimenta a arma; `-1` = nada compatível. */
  itemIndex: number;
  itemName: string | null;
  /** Balas ainda na reserva do item acima. */
  reserve: number;
  /** `true` quando há o que recarregar. */
  canReload: boolean;
  /** Motivo quando `canReload` é `false` — serve de `title` no botão. */
  reason: string | null;
}

/**
 * Decide se uma arma pode ser recarregada e com o quê — mesma leitura da
 * ficha do jogador (`reloadWeapon`): pente cheio, sem munição compatível ou
 * reserva menor que o que falta, tudo vira `reason`.
 */
export function planReload(
  weapon: { name?: string; skill?: string },
  ammo: number,
  magazine: number,
  inventory: readonly EnemySupply[],
): ReloadPlan {
  const kind = getAmmoKind({ name: weapon.name, skill: weapon.skill });
  const itemIndex = kind ? findAmmoSupplyIndex(inventory, kind) : -1;
  const item = itemIndex >= 0 ? inventory[itemIndex] : null;
  const reserve = item?.quantity ?? 0;
  const clampedAmmo = Math.max(0, Math.min(magazine, ammo));
  const need = magazine - clampedAmmo;

  const reason =
    need <= 0
      ? "Pente cheio."
      : !item
        ? "Sem munição compatível na mochila."
        : reserve < need
          ? `Munição insuficiente: faltam ${need - reserve} balas.`
          : null;

  return {
    ammo: clampedAmmo,
    magazine,
    itemIndex,
    itemName: item?.item ?? null,
    reserve,
    canReload: reason === null,
    reason,
  };
}

/**
 * Aplica o recarregamento: enche o pente e desconta da reserva (some o item
 * quando a reserva zera). `null` quando o plano não permite.
 */
export function applyReload(plan: ReloadPlan, inventory: readonly EnemySupply[]): EnemySupply[] | null {
  if (!plan.canReload || plan.itemIndex < 0) return null;
  const need = plan.magazine - plan.ammo;
  const next = inventory.map((entry, index) =>
    index === plan.itemIndex ? { ...entry, quantity: entry.quantity - need } : entry,
  );
  // Reserva que zera some da mochila, como no inventário do jogador.
  return next.filter((entry, index) => index !== plan.itemIndex || entry.quantity > 0);
}

/** Abre 1 unidade de um item (cura, munição...): some da mochila quando zera. */
export function consumeSupply(inventory: readonly EnemySupply[], itemName: string): EnemySupply[] {
  let consumed = false;
  return inventory
    .map((entry) => {
      if (consumed || entry.item !== itemName) return entry;
      consumed = true;
      return { ...entry, quantity: entry.quantity - 1 };
    })
    .filter((entry) => entry.quantity > 0);
}

/** Funde pilhas de mesmo nome e descarta quantidade inválida. */
function normalizeInventory(items: readonly EnemySupply[] | null | undefined): EnemySupply[] {
  const merged: EnemySupply[] = [];
  for (const entry of items ?? []) {
    if (!entry || typeof entry.item !== "string") continue;
    const name = entry.item.trim();
    const quantity = Math.max(0, Math.floor(Number(entry.quantity)));
    if (name.length === 0 || !Number.isFinite(quantity) || quantity === 0) continue;
    const existing = merged.find((item) => item.item === name);
    if (existing) existing.quantity += quantity;
    else merged.push({ item: name, quantity });
  }
  return merged;
}

/**
 * Mochila de UM inimigo no nascimento do encontro.
 *
 * @param base   `inventory` do JSON do bestiário — palavra final, nunca é cortado.
 * @param weapon Arma escolhida para o encontro; só ela define o tipo de munição.
 * @param rng    Sorteio da cura; injetável para teste determinístico.
 */
export function getEnemySupplies(
  base: readonly EnemySupply[] | null | undefined,
  weapon: EnemyWeapon | null | undefined,
  rng: () => number = Math.random,
): EnemySupply[] {
  const items = normalizeInventory(base);

  // 1. Munição: garantia de 2 cargas quando o JSON não trouxe nenhuma.
  const kind = getAmmoKind(weapon);
  const magazine = typeof weapon?.magazine === "number" ? weapon.magazine : 0;
  if (kind && magazine > 0 && findAmmoSupplyIndex(items, kind) < 0) {
    items.push({ item: ammoSupplyName(kind), quantity: magazine * MAGAZINES_PER_ENEMY });
  }

  // 2. Cura: possibilidade, nunca certeza (só quando ainda não há curativo).
  if (!hasHealing(items) && rng() < HEALING_CHANCE) {
    const pool = healingSupplyPool();
    if (pool.length > 0) {
      const name = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
      items.push({ item: name, quantity: rng() < 0.5 ? 2 : 1 });
    }
  }

  return items;
}
