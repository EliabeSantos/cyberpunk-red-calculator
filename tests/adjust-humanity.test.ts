import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyCharacter } from "../src/types/character.ts";
import { installCyberware, removeCyberware } from "../src/lib/cyberware.ts";
import { adjustHumanity, applyHumanityLoss, type HumanityLossResult } from "../src/lib/humanity.ts";
import { getCatalogItem } from "../src/data/items.ts";

function createCharacterWithEmp(emp: number) {
  const character = createEmptyCharacter("test-char");
  character.stats = { ...character.stats, EMP: emp };
  character.humanity = { current: emp * 10, max: emp * 10 };
  return character;
}

function getCyberwareInventoryItem(name: string, catalogId: string) {
  return {
    id: crypto.randomUUID(),
    name,
    category: "cyberware" as const,
    quantity: 1,
    catalogItemId: catalogId,
  };
}

test("adjustHumanity reduces Current Humanity", () => {
  const character = createCharacterWithEmp(8); // 80/80
  const resolution = adjustHumanity(character, 50, "Teste redução");
  assert.ok("character" in resolution);
  assert.strictEqual(resolution.humanityBefore, 80);
  assert.strictEqual(resolution.humanityAfter, 50);
  assert.strictEqual(resolution.character.humanity.current, 50);
  assert.strictEqual(resolution.character.humanity.max, 80); // max unchanged
});

test("adjustHumanity increases Current Humanity within max", () => {
  const character = createCharacterWithEmp(8);
  character.humanity = { current: 59, max: 72 };
  const resolution = adjustHumanity(character, 70, "Teste aumento");
  assert.ok("character" in resolution);
  assert.strictEqual(resolution.humanityBefore, 59);
  assert.strictEqual(resolution.humanityAfter, 70);
  assert.strictEqual(resolution.character.humanity.current, 70);
  assert.strictEqual(resolution.character.humanity.max, 72); // max unchanged
});

test("adjustHumanity preserves Maximum Humanity", () => {
  const character = createCharacterWithEmp(8);
  character.humanity = { current: 59, max: 72 };
  const resolution = adjustHumanity(character, 65, "Teste");
  assert.ok("character" in resolution);
  assert.strictEqual(resolution.character.humanity.max, 72);
  assert.strictEqual(resolution.character.humanity.current, 65);
});

test("adjustHumanity rejects value above Maximum Humanity", () => {
  const character = createCharacterWithEmp(8);
  character.humanity = { current: 59, max: 72 };
  const resolution = adjustHumanity(character, 80, "Teste inválido");
  assert.ok("error" in resolution);
  assert.strictEqual(resolution.error, `Humanity não pode exceder o máximo (72).`);
});

test("adjustHumanity rejects negative value", () => {
  const character = createCharacterWithEmp(8);
  const resolution = adjustHumanity(character, -5, "Teste inválido");
  assert.ok("error" in resolution);
  assert.strictEqual(resolution.error, "Humanity não pode ser negativa.");
});

test("adjustHumanity rejects NaN", () => {
  const character = createCharacterWithEmp(8);
  const resolution = adjustHumanity(character, NaN, "Teste inválido");
  assert.ok("error" in resolution);
  assert.strictEqual(resolution.error, "Valor de Humanity inválido.");
});

test("adjustHumanity does not modify cyberware or inventory", () => {
  const character = createCharacterWithEmp(8);
  character.cyberware = [
    { id: "cw-1", name: "Cyberarm", humanityLoss: "2d6", installedAt: "", isBorgware: false },
  ];
  const originalCyberware = [...character.cyberware];
  const originalInventory = [...character.inventory];

  const resolution = adjustHumanity(character, 50, "Teste");
  assert.ok("character" in resolution);
  assert.deepStrictEqual(resolution.character.cyberware, originalCyberware);
  assert.deepStrictEqual(resolution.character.inventory, originalInventory);
});

test("adjustHumanity does not generate Humanity Loss entry", () => {
  const character = createCharacterWithEmp(8);
  const originalHistoryLength = character.rollHistory.length;

  const resolution = adjustHumanity(character, 50, "Teste ajuste");
  assert.ok("character" in resolution);

  // Should have one new entry in history
  assert.strictEqual(resolution.character.rollHistory.length, originalHistoryLength + 1);

  // The new entry should be labeled as ajuste, not humanity_loss from cyberware
  const newEntry = resolution.character.rollHistory[0];
  assert.strictEqual(newEntry.type, "humanity_loss"); // reuses type
  assert.ok(newEntry.label.includes("Ajuste de Humanity"));
  assert.strictEqual(newEntry.expression, "ajuste");
  assert.strictEqual(newEntry.rolls.length, 0);
});

test("adjustHumanity records history with reason", () => {
  const character = createCharacterWithEmp(8);
  const resolution = adjustHumanity(character, 50, "Cyberware removido por engano");
  assert.ok("character" in resolution);
  const newEntry = resolution.character.rollHistory[0];
  assert.ok(newEntry.label.includes("Cyberware removido por engano"));
});

test("removeCyberware still RAW: preserves Current Humanity", () => {
  const character = createCharacterWithEmp(8);
  character.cyberware = [
    { id: "cw-1", name: "Cyberarm", humanityLoss: "2d6", installedAt: "", isBorgware: false },
    { id: "cw-2", name: "Cyberleg", humanityLoss: "2d6", installedAt: "", isBorgware: false },
  ];
  character.humanity = { current: 59, max: 76 }; // 80 - 4 = 76 max

  const updated = removeCyberware(character, "cw-1");
  assert.strictEqual(updated.humanity.current, 59); // preserved
  assert.strictEqual(updated.humanity.max, 78); // 80 - 2 = 78
});

test("adjustHumanity after removeCyberware works correctly", () => {
  const character = createCharacterWithEmp(8);
  character.cyberware = [
    { id: "cw-1", name: "Cyberarm", humanityLoss: "2d6", installedAt: "", isBorgware: false },
    { id: "cw-2", name: "Cyberleg", humanityLoss: "2d6", installedAt: "", isBorgware: false },
  ];
  character.humanity = { current: 59, max: 76 };

  const afterRemove = removeCyberware(character, "cw-1");
  assert.strictEqual(afterRemove.humanity.current, 59);
  assert.strictEqual(afterRemove.humanity.max, 78);

  // Now manually adjust to max
  const resolution = adjustHumanity(afterRemove, 78, "Correção após remoção acidental");
  assert.ok("character" in resolution);
  assert.strictEqual(resolution.character.humanity.current, 78);
  assert.strictEqual(resolution.character.humanity.max, 78);
});

test("adjustHumanity rejects invalid string input", () => {
  const character = createCharacterWithEmp(8);
  // @ts-expect-error testing invalid input
  const resolution = adjustHumanity(character, "invalid", "Teste");
  assert.ok("error" in resolution);
});

test("adjustHumanity at zero is allowed", () => {
  const character = createCharacterWithEmp(8);
  const resolution = adjustHumanity(character, 0, "Morte");
  assert.ok("character" in resolution);
  assert.strictEqual(resolution.character.humanity.current, 0);
});

test("adjustHumanity at max is allowed", () => {
  const character = createCharacterWithEmp(8);
  character.humanity = { current: 59, max: 72 };
  const resolution = adjustHumanity(character, 72, "Restauração total");
  assert.ok("character" in resolution);
  assert.strictEqual(resolution.character.humanity.current, 72);
  assert.strictEqual(resolution.character.humanity.max, 72);
});