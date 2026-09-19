import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyCharacter } from "../src/types/character.ts";
import { changeAttributeAtCreation } from "../src/lib/characterCreation.ts";

test("EMP 8 → Humanity 80 during creation", () => {
  let character = createEmptyCharacter("test");
  // Default EMP is 2, so initial Humanity is 20
  assert.strictEqual(character.humanity.current, 20);
  assert.strictEqual(character.humanity.max, 20);

  // Increase EMP from 2 to 8 (6 increments)
  for (let i = 0; i < 6; i++) {
    character = changeAttributeAtCreation(character, "EMP", 1);
  }

  assert.strictEqual(character.stats.EMP, 8);
  assert.strictEqual(character.humanity.current, 80);
  assert.strictEqual(character.humanity.max, 80);
});

test("EMP 7 → Humanity 70 during creation", () => {
  let character = createEmptyCharacter("test");
  for (let i = 0; i < 5; i++) {
    character = changeAttributeAtCreation(character, "EMP", 1);
  }

  assert.strictEqual(character.stats.EMP, 7);
  assert.strictEqual(character.humanity.current, 70);
  assert.strictEqual(character.humanity.max, 70);
});

test("EMP 6 → Humanity 60 during creation", () => {
  let character = createEmptyCharacter("test");
  for (let i = 0; i < 4; i++) {
    character = changeAttributeAtCreation(character, "EMP", 1);
  }

  assert.strictEqual(character.stats.EMP, 6);
  assert.strictEqual(character.humanity.current, 60);
  assert.strictEqual(character.humanity.max, 60);
});

test("EMP 2 → Humanity 20 during creation (default)", () => {
  const character = createEmptyCharacter("test");

  assert.strictEqual(character.stats.EMP, 2);
  assert.strictEqual(character.humanity.current, 20);
  assert.strictEqual(character.humanity.max, 20);
});

test("WILL/BODY changes do not affect Humanity", () => {
  let character = createEmptyCharacter("test");
  // Increase EMP to 8 first
  for (let i = 0; i < 6; i++) {
    character = changeAttributeAtCreation(character, "EMP", 1);
  }
  assert.strictEqual(character.humanity.current, 80);

  // Now change WILL and BODY to 8
  for (let i = 0; i < 6; i++) {
    character = changeAttributeAtCreation(character, "WILL", 1);
    character = changeAttributeAtCreation(character, "BODY", 1);
  }

  assert.strictEqual(character.stats.WILL, 8);
  assert.strictEqual(character.stats.BODY, 8);
  // Humanity should still be 80 (based on EMP only)
  assert.strictEqual(character.humanity.current, 80);
  assert.strictEqual(character.humanity.max, 80);
});

test("EMP 8 + WILL 2 + BODY 2 → Humanity 80", () => {
  let character = createEmptyCharacter("test");
  // EMP starts at 2, WILL at 2, BODY at 2
  // Increase EMP to 8
  for (let i = 0; i < 6; i++) {
    character = changeAttributeAtCreation(character, "EMP", 1);
  }
  // WILL and BODY stay at 2
  assert.strictEqual(character.stats.EMP, 8);
  assert.strictEqual(character.stats.WILL, 2);
  assert.strictEqual(character.stats.BODY, 2);
  assert.strictEqual(character.humanity.current, 80);
  assert.strictEqual(character.humanity.max, 80);
});

test("EMP 8 + WILL 8 + BODY 8 → Humanity 80", () => {
  let character = createEmptyCharacter("test");
  // Increase EMP to 8
  for (let i = 0; i < 6; i++) {
    character = changeAttributeAtCreation(character, "EMP", 1);
  }
  // Increase WILL to 8
  for (let i = 0; i < 6; i++) {
    character = changeAttributeAtCreation(character, "WILL", 1);
  }
  // Increase BODY to 8
  for (let i = 0; i < 6; i++) {
    character = changeAttributeAtCreation(character, "BODY", 1);
  }

  assert.strictEqual(character.stats.EMP, 8);
  assert.strictEqual(character.stats.WILL, 8);
  assert.strictEqual(character.stats.BODY, 8);
  // Humanity based only on EMP
  assert.strictEqual(character.humanity.current, 80);
  assert.strictEqual(character.humanity.max, 80);
});

test("Decreasing EMP reduces Humanity", () => {
  let character = createEmptyCharacter("test");
  // First increase EMP to 8
  for (let i = 0; i < 6; i++) {
    character = changeAttributeAtCreation(character, "EMP", 1);
  }
  assert.strictEqual(character.humanity.current, 80);

  // Now decrease EMP back to 5
  for (let i = 0; i < 3; i++) {
    character = changeAttributeAtCreation(character, "EMP", -1);
  }

  assert.strictEqual(character.stats.EMP, 5);
  assert.strictEqual(character.humanity.current, 50);
  assert.strictEqual(character.humanity.max, 50);
});

test("HP still recalculated correctly with BODY/WILL changes", () => {
  let character = createEmptyCharacter("test");
  // Default BODY=2, WILL=2 → HP = 10 + 5 * floor((2+2)/2) = 20
  assert.strictEqual(character.combat.hp.max, 20);

  // Increase BODY to 8
  for (let i = 0; i < 6; i++) {
    character = changeAttributeAtCreation(character, "BODY", 1);
  }
  // BODY=8, WILL=2 → HP = 10 + 5 * floor((8+2)/2) = 10 + 5*5 = 35
  assert.strictEqual(character.combat.hp.max, 35);

  // Increase WILL to 8
  for (let i = 0; i < 6; i++) {
    character = changeAttributeAtCreation(character, "WILL", 1);
  }
  // BODY=8, WILL=8 → HP = 10 + 5 * floor((8+8)/2) = 10 + 5*8 = 50
  assert.strictEqual(character.combat.hp.max, 50);
});