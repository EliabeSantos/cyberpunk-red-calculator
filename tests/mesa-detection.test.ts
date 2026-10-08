import assert from "node:assert/strict";
import test from "node:test";
import { createTestRandomSource } from "../src/lib/random.ts";
import { resolveDetectionCheck, rollPerceptionCheck, rollStealthCheck } from "../src/lib/mesa/detection.ts";

test("Stealth usa COOL + Stealth + 1d10", () => {
  const result = rollStealthCheck({ stat: 8, skill: 4, rng: createTestRandomSource([7]) });
  assert.equal(result.roll, 7);
  assert.equal(result.total, 19);
});

test("Perception usa INT + Perception + 1d10", () => {
  const result = rollPerceptionCheck({ stat: 6, skill: 5, rng: createTestRandomSource([7]) });
  assert.equal(result.roll, 7);
  assert.equal(result.total, 18);
});

test("detecção usa a oposição server-side e não revela em empate", () => {
  const result = resolveDetectionCheck({ observerPerception: 8, targetStealth: 8, rng: createTestRandomSource([5, 5]) });
  assert.equal(result.detected, false);
  assert.equal(result.observerTotal, 13);
  assert.equal(result.targetTotal, 13);
});

test("detecção revela somente quando Perception vence Stealth", () => {
  const result = resolveDetectionCheck({ observerPerception: 8, targetStealth: 8, rng: createTestRandomSource([10, 1]) });
  assert.equal(result.detected, true);
});
