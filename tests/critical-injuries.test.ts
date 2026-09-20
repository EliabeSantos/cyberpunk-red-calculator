import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyCharacter } from "../src/types/character.ts";
import { applyReceivedDamage, applyAttackDamage, rollDamage } from "../src/lib/damage.ts";
import { calculateWoundThreshold, calculateMaximumHitPoints } from "../src/lib/calculations.ts";
import { checkCriticalInjuryFromDamage, rollCriticalInjury } from "../src/data/criticalInjuries.ts";
import { rollDice } from "../src/lib/dice.ts";

function createTestCharacter(hpMax = 40, hpCurrent = 40) {
  const character = createEmptyCharacter("test-char");
  character.stats = { ...character.stats, BODY: 8, WILL: 8, EMP: 8 };
  character.combat.hp = { current: hpCurrent, max: hpMax };
  character.combat.armor = { head: 0, body: 0 };
  return character;
}

test("calculateWoundThreshold returns half max HP rounded down", () => {
  assert.strictEqual(calculateWoundThreshold(40), 20);
  assert.strictEqual(calculateWoundThreshold(35), 17);
  assert.strictEqual(calculateWoundThreshold(30), 15);
  assert.strictEqual(calculateWoundThreshold(21), 10);
  assert.strictEqual(calculateWoundThreshold(1), 0);
});

test("checkCriticalInjuryFromDamage detects two or more 6s", () => {
  assert.strictEqual(checkCriticalInjuryFromDamage([6, 6]), true);
  assert.strictEqual(checkCriticalInjuryFromDamage([6, 6, 6]), true);
  assert.strictEqual(checkCriticalInjuryFromDamage([6, 5, 6]), true);
  assert.strictEqual(checkCriticalInjuryFromDamage([6]), false);
  assert.strictEqual(checkCriticalInjuryFromDamage([5, 5]), false);
  assert.strictEqual(checkCriticalInjuryFromDamage([6, 4]), false);
  assert.strictEqual(checkCriticalInjuryFromDamage([]), false);
});

test("rollCriticalInjury returns valid injury from table", () => {
  const originalRandom = Math.random;
  Math.random = () => 0.5; // Will give ~7 on 2d6
  try {
    const injury = rollCriticalInjury("head");
    assert.ok(injury);
    assert.strictEqual(injury.location, "head");
    assert.ok(injury.roll >= 2 && injury.roll <= 12);
    assert.ok(injury.name.length > 0);
    assert.ok(injury.effect.length > 0);
  } finally {
    Math.random = originalRandom;
  }
});

test("applyReceivedDamage does not trigger Seriously Wounded when damage doesn't cross threshold", () => {
  const character = createTestCharacter(40, 40); // HP 40, Wound Threshold 20
  const result = applyReceivedDamage(character, 5, "body"); // HP 35, still above 20
  
  assert.ok("character" in result);
  if ("character" in result) {
    assert.strictEqual(result.result.hpBefore, 40);
    assert.strictEqual(result.result.hpAfter, 35);
    assert.strictEqual(result.result.woundThreshold, 20);
    assert.strictEqual(result.result.crossedWoundThreshold, false);
    assert.strictEqual(result.result.criticalInjuryTriggered, false);
  }
});

test("applyReceivedDamage triggers Seriously Wounded when crossing threshold", () => {
  const character = createTestCharacter(40, 25); // HP 25, Wound Threshold 20
  const result = applyReceivedDamage(character, 10, "body"); // HP 15, crosses 20
  
  assert.ok("character" in result);
  if ("character" in result) {
    assert.strictEqual(result.result.hpBefore, 25);
    assert.strictEqual(result.result.hpAfter, 15);
    assert.strictEqual(result.result.woundThreshold, 20);
    assert.strictEqual(result.result.crossedWoundThreshold, true);
    assert.strictEqual(result.result.criticalInjuryTriggered, true);
    assert.ok(result.result.criticalInjury);
    assert.strictEqual(result.result.location, "body");
  }
});

test("applyReceivedDamage does not trigger Seriously Wounded again when already below threshold", () => {
  const character = createTestCharacter(40, 15); // Already below Wound Threshold (20)
  const result = applyReceivedDamage(character, 5, "body"); // HP 10
  
  assert.ok("character" in result);
  if ("character" in result) {
    assert.strictEqual(result.result.hpBefore, 15);
    assert.strictEqual(result.result.hpAfter, 10);
    assert.strictEqual(result.result.woundThreshold, 20);
    assert.strictEqual(result.result.crossedWoundThreshold, false);
    assert.strictEqual(result.result.criticalInjuryTriggered, false);
  }
});

test("applyReceivedDamage records hit location correctly", () => {
  const character = createTestCharacter(40, 25);
  const result = applyReceivedDamage(character, 10, "head");
  
  assert.ok("character" in result);
  if ("character" in result) {
    assert.strictEqual(result.result.location, "head");
  }
});

test("applyReceivedDamage preserves existing critical injuries and adds new one", () => {
  const character = createTestCharacter(40, 25);
  character.combat.criticalInjuries = [{ roll: 0, name: "Existing injury", effect: "", quickFix: "", treatment: "", bonusDamage: 5, location: "body", modifiers: [] }];
  
  const result = applyReceivedDamage(character, 10, "body");
  
  assert.ok("character" in result);
  if ("character" in result) {
    assert.strictEqual(result.character.combat.criticalInjuries.length, 2);
    assert.strictEqual(result.character.combat.criticalInjuries[0].name, "Existing injury");
    // The new injury should be a valid CriticalInjury object with a name
    assert.ok(result.character.combat.criticalInjuries[1].name);
    assert.ok(result.character.combat.criticalInjuries[1].effect);
  }
});

test("applyAttackDamage detects Critical Injury from damage dice (two or more 6s)", () => {
  const character = createTestCharacter(40, 40);
  
  // Mock a damage roll with two 6s
  const mockDamageRoll = {
    attackId: "test",
    attackName: "Test Weapon",
    weaponId: "test-weapon",
    damageDice: "2d6",
    roll: { expression: "2d6", rolls: [6, 6], total: 12 },
    total: 12,
  } as import("../src/types/attack.ts").DamageRollResult;
  
  const result = applyAttackDamage(character, mockDamageRoll, "body");
  
  assert.ok("character" in result);
  if ("character" in result) {
    assert.strictEqual(result.result.criticalInjuryFromDice, true);
    assert.strictEqual(result.result.criticalInjuryTriggered, true);
    // Critical Injury from dice is in criticalInjuryFromDiceResult
    assert.ok(result.result.criticalInjuryFromDiceResult);
    assert.strictEqual(result.result.criticalInjuryFromDiceResult?.location, "body");
  }
});

test("applyAttackDamage triggers both Seriously Wounded and Critical Injury from dice", () => {
  const character = createTestCharacter(40, 25); // Near threshold
  // Mock a damage roll with two 6s (total 12)
  const mockDamageRoll = {
    attackId: "test",
    attackName: "Test Weapon",
    weaponId: "test-weapon",
    damageDice: "2d6",
    roll: { expression: "2d6", rolls: [6, 6], total: 12 },
    total: 12,
  } as import("../src/types/attack.ts").DamageRollResult;
  
  const result = applyAttackDamage(character, mockDamageRoll, "body");
  
  assert.ok("character" in result);
  if ("character" in result) {
    assert.strictEqual(result.result.crossedWoundThreshold, true);
    assert.strictEqual(result.result.criticalInjuryFromDice, true);
    assert.strictEqual(result.result.criticalInjuryTriggered, true);
    // Should have two injuries recorded
    assert.strictEqual(result.character.combat.criticalInjuries.length, 2);
  }
});

test("applyAttackDamage with Aimed Shot to Head records head location", () => {
  const character = createTestCharacter(40, 40);
  const mockDamageRoll = {
    attackId: "test",
    attackName: "Test Weapon",
    weaponId: "test-weapon",
    damageDice: "2d6",
    roll: { expression: "2d6", rolls: [3, 4], total: 7 },
    total: 7,
  } as import("../src/types/attack.ts").DamageRollResult;
  
  const result = applyAttackDamage(character, mockDamageRoll, "head");
  
  assert.ok("character" in result);
  if ("character" in result) {
    assert.strictEqual(result.result.location, "head");
    if (result.result.criticalInjury) {
      assert.strictEqual(result.result.criticalInjury.location, "head");
    }
  }
});

test("applyAttackDamage with Aimed Shot to Leg records leg location", () => {
  const character = createTestCharacter(40, 40);
  const mockDamageRoll = {
    attackId: "test",
    attackName: "Test Weapon",
    weaponId: "test-weapon",
    damageDice: "2d6",
    roll: { expression: "2d6", rolls: [2, 3], total: 5 },
    total: 5,
  } as import("../src/types/attack.ts").DamageRollResult;
  
  const result = applyAttackDamage(character, mockDamageRoll, "right_leg");
  
  assert.ok("character" in result);
  if ("character" in result) {
    assert.strictEqual(result.result.location, "right_leg");
    if (result.result.criticalInjury) {
      assert.strictEqual(result.result.criticalInjury.location, "right_leg");
    }
  }
});

test("rollDamage uses rollDice from existing dice system", () => {
  const originalRandom = Math.random;
  Math.random = () => 0.5; // ~3-4 on each die
  try {
    const attack = {
      attackId: "test",
      attackType: "handgun" as import("../src/types/attack.ts").AttackType,
      label: "Test",
      roll: { expression: "1d10", rolls: [5], total: 5 },
      stat: { id: "REF" as import("../src/types/character.ts").AttributeName, value: 7 },
      skill: { id: "handgun", value: 4 },
      modifiers: [],
      total: 16,
      naturalRoll: 5,
      critical: null,
      damageDice: "2d6",
    } as import("../src/types/attack.ts").AttackRollResult;
    const result = rollDamage(attack);
    assert.ok(!("error" in result));
    if (!("error" in result)) {
      assert.strictEqual(result.damageDice, "2d6");
      assert.ok(result.roll.rolls.length === 2);
      assert.ok(result.roll.rolls.every((r) => r >= 1 && r <= 6));
    }
  } finally {
    Math.random = originalRandom;
  }
});

test("applyReceivedDamage registers history entry with all damage details", () => {
  const character = createTestCharacter(40, 40);
  const initialHistoryLength = character.rollHistory.length;
  
  const result = applyReceivedDamage(character, 10, "body");
  
  assert.ok("character" in result);
  if ("character" in result) {
    assert.strictEqual(result.character.rollHistory.length, initialHistoryLength + 1);
    const entry = result.character.rollHistory[0];
    assert.strictEqual(entry.type, "received_damage");
    assert.strictEqual(entry.amount, 10);
    assert.strictEqual(entry.hitLocation, "body");
    assert.strictEqual(entry.hpBefore, 40);
    assert.strictEqual(entry.hpAfter, 30);
  }
});

test("applyAttackDamage registers history with damage dice expression", () => {
  const character = createTestCharacter(40, 40);
  const initialHistoryLength = character.rollHistory.length;
  
  const mockDamageRoll = {
    attackId: "test",
    attackName: "Test Weapon",
    weaponId: "test-weapon",
    damageDice: "2d6",
    roll: { expression: "2d6", rolls: [3, 4], total: 7 },
    total: 7,
  } as import("../src/types/attack.ts").DamageRollResult;
  
  const result = applyAttackDamage(character, mockDamageRoll, "body");
  
  assert.ok("character" in result);
  if ("character" in result) {
    assert.strictEqual(result.character.rollHistory.length, initialHistoryLength + 1);
    const entry = result.character.rollHistory[0];
    assert.strictEqual(entry.type, "received_damage");
    assert.strictEqual(entry.expression, "2d6");
    assert.deepStrictEqual(entry.rolls, [3, 4]);
    assert.strictEqual(entry.total, 7);
  }
});