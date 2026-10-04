import assert from "node:assert/strict";
import test from "node:test";

import {
  hasServerEvasionTarget,
  MesaError,
  validateCombatAttackTarget,
} from "../src/lib/mesa/store.ts";

const combat = { id: "combat-a", session_id: "session-a" };

function target(overrides: Partial<{ id: string; combat_id: string; session_id: string; is_dead: boolean }> = {}) {
  return {
    id: "target-a",
    combat_id: "combat-a",
    session_id: "session-a",
    is_dead: false,
    ...overrides,
  };
}

function errorOf(callback: () => void): MesaError {
  try {
    callback();
  } catch (caught) {
    assert.ok(caught instanceof MesaError);
    return caught;
  }
  assert.fail("expected target validation error");
}

test("target válido pertence ao combate e à Mesa atuais", () => {
  validateCombatAttackTarget(combat, target());
});

test("target inexistente é recusado", () => {
  const error = errorOf(() => validateCombatAttackTarget(combat, null));
  assert.equal(error.status, 404);
  assert.equal(error.code, "target_not_found");
});

test("target de outro combate é recusado", () => {
  const error = errorOf(() => validateCombatAttackTarget(combat, target({ combat_id: "combat-b" })));
  assert.equal(error.status, 404);
  assert.equal(error.code, "target_not_found");
});

test("target de outra Mesa é recusado", () => {
  const error = errorOf(() => validateCombatAttackTarget(combat, target({ session_id: "session-b" })));
  assert.equal(error.status, 404);
  assert.equal(error.code, "target_not_found");
});

test("target fora do combate ativo é recusado mesmo existindo na Mesa", () => {
  const error = errorOf(() => validateCombatAttackTarget(combat, target({ combat_id: "combat-closed" })));
  assert.equal(error.status, 404);
  assert.equal(error.code, "target_not_found");
});

test("target derrotado é recusado pela regra de estado existente", () => {
  const error = errorOf(() => validateCombatAttackTarget(combat, target({ is_dead: true })));
  assert.equal(error.status, 400);
  assert.equal(error.code, "target_defeated");
});

test("DEX e Evasion server-side ficam disponíveis sem aceitar valores do cliente", () => {
  assert.equal(
    hasServerEvasionTarget({ stats: { DEX: 8 }, skills: { evasion: { stat: "DEX", level: 6 } } }),
    true,
  );
  assert.equal(hasServerEvasionTarget({ stats: { DEX: 8 }, skills: {} }), false);
});

test("inimigo sem Evasion não recebe fallback de defesa", () => {
  assert.equal(hasServerEvasionTarget({ stats: { REF: 8 }, skills: {} }), false);
});
