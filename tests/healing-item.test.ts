import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyCharacter } from "../src/types/character.ts";
import { applyHealingItem, getItemHealAmount, isHealingItem } from "../src/lib/healing.ts";

function characterWithHp(current: number, max = 40) {
  const character = createEmptyCharacter("test-char");
  character.combat.hp = { current, max };
  return character;
}

type InventoryItemOverrides = {
  id?: string;
  name?: string;
  quantity?: number;
  category?: string;
  catalogItemId?: string;
  notes?: string;
};

function inventoryItem(overrides: InventoryItemOverrides = {}) {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: overrides.name ?? "Item",
    quantity: overrides.quantity ?? 1,
    category: overrides.category,
    catalogItemId: overrides.catalogItemId,
    notes: overrides.notes,
  };
}

test("getItemHealAmount reads the designed hpRestore from the catalog", () => {
  const stim = inventoryItem({ name: "Stim", category: "healing", catalogItemId: "stim" });
  assert.strictEqual(getItemHealAmount(stim), 5);
  assert.strictEqual(getItemHealAmount(inventoryItem({ catalogItemId: "maxdoc" })), 10);
  assert.strictEqual(getItemHealAmount(inventoryItem({ catalogItemId: "trauma_injector" })), 2);
  assert.strictEqual(getItemHealAmount(inventoryItem({ catalogItemId: "bounce_back" })), 6);
});

test("getItemHealAmount falls back to parsing free text in notes", () => {
  const custom = inventoryItem({ name: "Bandagem", notes: "Recupera 3 HP." });
  assert.strictEqual(getItemHealAmount(custom), 3);
});

test("getItemHealAmount returns null for items that do not restore HP", () => {
  assert.strictEqual(getItemHealAmount(inventoryItem({ catalogItemId: "basic_medkit" })), null);
  assert.strictEqual(getItemHealAmount(inventoryItem({ name: "Granada" })), null);
});

test("isHealingItem requires the designed health and available quantity", () => {
  assert.ok(isHealingItem(inventoryItem({ catalogItemId: "stim" })));
  assert.ok(!isHealingItem(inventoryItem({ catalogItemId: "stim", quantity: 0 })));
  assert.ok(!isHealingItem(inventoryItem({ catalogItemId: "advanced_medkit" })));
});

test("applyHealingItem restores the designed HP and consumes one unit", () => {
  const character = characterWithHp(5);
  const item = inventoryItem({ name: "Stim", category: "healing", catalogItemId: "stim", quantity: 2 });
  character.inventory = [item];

  const result = applyHealingItem(character, item.id);
  assert.ok("character" in result);
  assert.strictEqual(result.hpBefore, 5);
  assert.strictEqual(result.hpAfter, 10);
  assert.strictEqual(result.restored, 5);
  assert.strictEqual(result.stabilized, false);
  assert.strictEqual(result.character.combat.hp.current, 10);
  assert.strictEqual(result.character.inventory[0].quantity, 1);
});

test("applyHealingItem removes the item when the last unit is consumed", () => {
  const character = characterWithHp(5);
  const item = inventoryItem({ catalogItemId: "stim", quantity: 1 });
  character.inventory = [item];

  const result = applyHealingItem(character, item.id);
  assert.ok("character" in result);
  assert.strictEqual(result.character.inventory.length, 0);
});

test("applyHealingItem clamps healing at maximum HP", () => {
  const character = characterWithHp(38, 40);
  const item = inventoryItem({ catalogItemId: "maxdoc" });
  character.inventory = [item];

  const result = applyHealingItem(character, item.id);
  assert.ok("character" in result);
  assert.strictEqual(result.character.combat.hp.current, 40);
  assert.strictEqual(result.restored, 2);
});

test("stabilizing item ends death saves and returns to at least 1 HP", () => {
  const character = characterWithHp(-3);
  character.combat.deathSaveDC = 5;
  character.combat.deathSaveFailures = 2;
  const item = inventoryItem({ catalogItemId: "trauma_injector" });
  character.inventory = [item];

  const result = applyHealingItem(character, item.id);
  assert.ok("character" in result);
  assert.strictEqual(result.stabilized, true);
  assert.strictEqual(result.character.combat.hp.current, 1);
  assert.strictEqual(result.character.combat.deathSaveDC, 0);
  assert.strictEqual(result.character.combat.deathSaveFailures, 0);
});

test("non-stabilizing item that heals above 0 HP also ends death saves", () => {
  const character = characterWithHp(-3);
  character.combat.deathSaveDC = 5;
  character.combat.deathSaveFailures = 1;
  const item = inventoryItem({ catalogItemId: "stim" });
  character.inventory = [item];

  const result = applyHealingItem(character, item.id);
  assert.ok("character" in result);
  assert.strictEqual(result.character.combat.hp.current, 2);
  assert.strictEqual(result.stabilized, true);
  assert.strictEqual(result.character.combat.deathSaveDC, 0);
  assert.strictEqual(result.character.combat.deathSaveFailures, 0);
});

test("healing a conscious character keeps pending death save state untouched", () => {
  const character = characterWithHp(10);
  character.combat.deathSaveDC = 0;
  const item = inventoryItem({ catalogItemId: "stim" });
  character.inventory = [item];

  const result = applyHealingItem(character, item.id);
  assert.ok("character" in result);
  assert.strictEqual(result.stabilized, false);
  assert.strictEqual(result.character.combat.deathSaveDC, 0);
});

test("applyHealingItem rejects unknown, exhausted, non-healing items and dead characters", () => {
  const character = characterWithHp(10);
  const unknown = applyHealingItem(character, "missing-id");
  assert.ok("error" in unknown);

  const exhausted = inventoryItem({ catalogItemId: "stim", quantity: 0 });
  character.inventory = [exhausted];
  const exhaustedResult = applyHealingItem(character, exhausted.id);
  assert.ok("error" in exhaustedResult);

  const medkit = inventoryItem({ catalogItemId: "basic_medkit" });
  character.inventory = [medkit];
  const noHeal = applyHealingItem(character, medkit.id);
  assert.ok("error" in noHeal);

  const dead = characterWithHp(-5);
  dead.combat.isDead = true;
  const stim = inventoryItem({ catalogItemId: "stim" });
  dead.inventory = [stim];
  const deadResult = applyHealingItem(dead, stim.id);
  assert.ok("error" in deadResult);
});
