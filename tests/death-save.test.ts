import assert from "node:assert/strict";
import test from "node:test";
import { resolveDeathSave } from "../src/lib/damage.ts";
import type { RandomSource } from "../src/lib/combat/contract.ts";

function rng(face: number): RandomSource {
  return { d10: () => face, roll: () => ({ expression: "1d10", rolls: [face], total: face }) };
}

test("Death Save usa 1d10 contra a DC e preserva falhas no sucesso", () => {
  const result = resolveDeathSave({ dc: 6, failures: 2 }, rng(6));
  assert.equal(result.success, true);
  assert.equal(result.characterDied, false);
  assert.deepEqual(result.state, { dc: 6, failures: 2 });
});

test("falha reduz a DC, incrementa contador e só mata quando ultrapassa a nova DC", () => {
  const result = resolveDeathSave({ dc: 6, failures: 2 }, rng(7));
  assert.equal(result.success, false);
  assert.equal(result.characterDied, true);
  assert.deepEqual(result.state, { dc: 5, failures: 3 });
});

test("Death Save com DC zero mantém regra existente sem inventar reset", () => {
  const result = resolveDeathSave({ dc: 0, failures: 3 }, rng(1));
  assert.equal(result.success, false);
  assert.equal(result.characterDied, true);
  assert.deepEqual(result.state, { dc: 0, failures: 4 });
});
