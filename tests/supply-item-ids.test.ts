/**
 * F1.13.2 — ID ESTÁVEL do item da mochila (`supplies.inventory`).
 *
 * Prova três promessas desta task:
 *   · a identidade vem do catálogo JÁ EXISTENTE (nada de segunda taxonomia);
 *   · o fallback é determinístico e compatível com os itens atuais;
 *   · a migration SQL usa EXATAMENTE a mesma regra — se os dois lados
 *     divergirem, o inventário legado migrado vira outro item.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { catalogItems } from "../src/data/items.ts";
import {
  findSupplyEntry,
  normalizeSupplyInventory,
  resolveSupplyItemId,
  slugifySupplyItemId,
  stableItemId,
} from "../src/data/supplyItems.ts";

/** Mesma expressão do SQL: `regexp_replace(lower(trim), '[^a-z0-9]+', '_')`. */
function sqlSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

test("o id vem do catálogo existente, não de uma taxonomia nova", () => {
  assert.equal(stableItemId("Stim"), "stim");
  assert.equal(stableItemId("MaxDoc"), "maxdoc");
  assert.equal(stableItemId("Trauma Injector"), "trauma_injector");
  // Itens cujo slug NÃO é igual ao id: só o catálogo resolve.
  assert.equal(stableItemId("Pistol Ammunition"), "pistol_ammo");
  assert.equal(stableItemId("Basic Medkit"), "basic_medkit");
  assert.equal(stableItemId("Combat Stimulant"), "stimulant");
});

test("fora do catálogo o id é o slug determinístico", () => {
  assert.equal(stableItemId("Trauma Patch"), "trauma_patch");
  assert.equal(stableItemId("Medkit"), "medkit");
  assert.equal(stableItemId("First Aid"), "first_aid");
  assert.equal(stableItemId("Heavy Pistol Ammo"), "heavy_pistol_ammo");
  assert.equal(stableItemId("  Trauma   Patch  "), "trauma_patch");
});

test("id é função do nome: mesmo nome → mesmo id; nomes distintos → ids distintos", () => {
  const names = catalogItems.map((item) => item.name);
  const ids = new Set(names.map((name) => stableItemId(name)));
  assert.equal(ids.size, names.length, "nomes diferentes nunca colidem num id só");
  for (const name of names) {
    assert.equal(stableItemId(name), stableItemId(name.toUpperCase()), "não depende de caixa");
    assert.equal(stableItemId(name), stableItemId(`  ${name}  `), "não depende de espaço nas pontas");
    assert.equal(stableItemId(name), stableItemId(name.trim()), "id determinístico");
  }
});

test("nome vazio não vira identidade", () => {
  assert.equal(stableItemId(""), "");
  assert.equal(stableItemId("   "), "");
  assert.equal(stableItemId(null), "");
  assert.equal(slugifySupplyItemId("!!!"), "");
});

test("resolveSupplyItemId prefere o persistido e deriva quando falta", () => {
  assert.equal(resolveSupplyItemId({ item: "Stim", itemId: "stim" }), "stim");
  assert.equal(resolveSupplyItemId({ item: "Stim" }), "stim");
  // Entrada legada sem `itemId` continua localizável pelo id derivado.
  assert.equal(resolveSupplyItemId({ item: "Trauma Patch" }), "trauma_patch");
  assert.equal(resolveSupplyItemId({ item: "Trauma Patch", itemId: "" }), "trauma_patch");
});

test("findSupplyEntry procura pelo ID, nunca pelo rótulo", () => {
  const inventory = [
    { item: "Stim", quantity: 2, itemId: "stim" },
    { item: "Trauma Patch", quantity: 1 },
  ];
  assert.equal(findSupplyEntry(inventory, "stim")?.quantity, 2);
  assert.equal(findSupplyEntry(inventory, "trauma_patch")?.quantity, 1);
  assert.equal(findSupplyEntry(inventory, "Stim"), null, "rótulo não localiza mais");
  assert.equal(findSupplyEntry(inventory, ""), null);
  assert.equal(findSupplyEntry(null, "stim"), null);
});

test("normalizeSupplyInventory grava o id em toda entrada e soma pilhas do mesmo item", () => {
  const normalized = normalizeSupplyInventory([
    { item: "Stim", quantity: 2 },
    { item: "  stim ", quantity: 3 }, // mesmo item em outro caixa/espaço
    { item: "Trauma Patch", quantity: 1 },
    { item: "Pistol Ammunition", quantity: 16 },
  ]);
  assert.deepEqual(
    normalized.map((entry) => [entry.itemId, entry.item, entry.quantity]),
    [
      ["stim", "Stim", 5],
      ["trauma_patch", "Trauma Patch", 1],
      ["pistol_ammo", "Pistol Ammunition", 16],
    ],
  );
});

test("normalizeSupplyInventory descarta o que não é item utilizável e é idempotente", () => {
  const legacy = [
    { item: "", quantity: 4 },
    { item: "Stim", quantity: 0 },
    { item: "MaxDoc", quantity: -2 },
    { item: "Bounce Back", quantity: 1.9 },
    { item: null, quantity: 1 },
    { nota: "não é item" },
  ];
  const once = normalizeSupplyInventory(legacy);
  assert.deepEqual(
    once.map((entry) => [entry.itemId, entry.quantity]),
    [["bounce_back", 1]],
  );
  assert.deepEqual(normalizeSupplyInventory(once), once, "rodar de novo não muda nada");
  assert.deepEqual(normalizeSupplyInventory(null), []);
});

test("migration SQL usa a MESMA regra do TypeScript", () => {
  const sql = readFileSync("supabase/migrations/20261010000000_mesa_supply_item_ids.sql", "utf8");
  const pairs = Array.from(sql.matchAll(/when '([^']+)'[\s]+then '([^']+)'/g)).map(
    (match) => [match[1], match[2]] as const,
  );
  assert.ok(pairs.length > 0, "o CASE da migration foi encontrado");

  // Todo par do SQL precisa ser exatamente o que o TS deriva…
  for (const [name, id] of pairs) {
    assert.equal(stableItemId(name), id, `SQL e TS divergem no item "${name}"`);
  }

  // …e o CASE precisa cobrir TODOS os itens do catálogo em que o slug sozinho
  // não bastaria: seria aí que o inventário legado migrado viraria outro item.
  const expected = catalogItems.filter((item) => sqlSlug(item.name) !== item.id);
  assert.deepEqual(
    pairs.map(([name]) => name).sort(),
    expected.map((item) => item.name.trim().toLowerCase()).sort(),
    "CASE cobre exatamente os itens cujo slug difere do id do catálogo",
  );

  // Fora do CASE o SQL cai no slug — que precisa bater com o TS para os 94
  // restantes também.
  const covered = new Set(pairs.map(([name]) => name));
  for (const item of catalogItems) {
    if (covered.has(item.name.trim().toLowerCase())) continue;
    assert.equal(sqlSlug(item.name), stableItemId(item.name), `fallback divergente em "${item.name}"`);
  }
});
