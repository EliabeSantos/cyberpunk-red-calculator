import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIONS_PER_TURN,
  ACTION_COSTS,
  METERS_PER_MOVE,
  MOVEMENT_PER_TURN,
  advanceTurn,
  applyAction,
  beginTurn,
  getActionCost,
  isCombatActionType,
  movementMetersPerTurn,
  resolveAction,
  rollEnemyInitiative,
  sortByInitiative,
  type ActionEconomy,
} from "../src/lib/combatEngine.ts";

function economy(overrides: Partial<ActionEconomy> = {}): ActionEconomy {
  return {
    actionsMax: ACTIONS_PER_TURN,
    actionsRemaining: ACTIONS_PER_TURN,
    movementMax: 6,
    movementRemaining: 6,
    ...overrides,
  };
}

/** Monta o pedido como o servidor monta: lendo o estado do banco. */
function request(overrides: Partial<Parameters<typeof resolveAction>[0]> = {}) {
  return resolveAction({
    combatStatus: "active",
    initiativeStarted: true,
    activeCombatantId: "combatente-1",
    actorRole: "player",
    actorOwnsCombatant: true,
    combatant: { id: "combatente-1", isDead: false, ...economy() },
    actionType: "attack",
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Economia de ações
// ---------------------------------------------------------------------------

test("turno começa com 2 ações e movimento cheio", () => {
  const started = beginTurn(economy({ actionsRemaining: 0, movementRemaining: 1 }));
  assert.equal(started.actionsRemaining, ACTIONS_PER_TURN);
  assert.equal(started.movementRemaining, 6);
});

test("dois ataques esgotam o turno (2 → 1 → 0)", () => {
  let current = economy();

  const first = request({ combatant: { id: "combatente-1", isDead: false, ...current } });
  assert.deepEqual(first, { ok: true, cost: 1 });
  current = applyAction(current, "attack");

  const second = request({ combatant: { id: "combatente-1", isDead: false, ...current } });
  assert.deepEqual(second, { ok: true, cost: 1 });
  current = applyAction(current, "attack");

  assert.equal(current.actionsRemaining, 0);

  const third = request({ combatant: { id: "combatente-1", isDead: false, ...current } });
  assert.deepEqual(third, { ok: false, reason: "insufficient_actions" });
});

test("ataque custa 1 ação; movimento custa 0 e gasta os metros", () => {
  assert.equal(getActionCost("attack"), 1);
  assert.equal(getActionCost("item"), 1);
  assert.equal(getActionCost("move"), 0);
  assert.equal(ACTION_COSTS.move, 0);

  const moved = applyAction(economy(), "move", 3);
  assert.equal(moved.actionsRemaining, 2, "mover não consome ação");
  assert.equal(moved.movementRemaining, 3);
});

test("orçamentos nunca ficam negativos", () => {
  const spent = applyAction(economy({ actionsRemaining: 0, movementRemaining: 0 }), "attack");
  assert.equal(spent.actionsRemaining, 0);
  const over = applyAction(economy({ movementRemaining: 1 }), "move", 5);
  assert.equal(over.movementRemaining, 0);
});

test("reconhece só os tipos de ação conhecidos", () => {
  assert.ok(isCombatActionType("attack"));
  assert.ok(isCombatActionType("move"));
  assert.ok(!isCombatActionType("fly"));
  assert.ok(!isCombatActionType(null));
  assert.ok(!isCombatActionType(42));
});

// ---------------------------------------------------------------------------
// Validações de autorização (as que o backend executa de verdade)
// ---------------------------------------------------------------------------

test("rejeita quando o combate não começou, terminou ou a iniciativa não rolou", () => {
  assert.equal(request({ combatStatus: null }).ok, false);
  assert.deepEqual(request({ combatStatus: null }), { ok: false, reason: "combat_not_started" });
  assert.deepEqual(request({ combatStatus: "finished" }), { ok: false, reason: "combat_finished" });
  assert.deepEqual(request({ initiativeStarted: false }), { ok: false, reason: "initiative_not_started" });
});

test("jogador não age fora do próprio turno", () => {
  const result = request({ activeCombatantId: "outro-combatente" });
  assert.deepEqual(result, { ok: false, reason: "not_your_turn" });
});

test("jogador não age com combatente de outro jogador", () => {
  const result = request({ actorOwnsCombatant: false });
  assert.deepEqual(result, { ok: false, reason: "not_allowed" });
});

test("GM pode agir por qualquer combatente, inclusive fora de turno", () => {
  const result = request({
    actorRole: "gm",
    actorOwnsCombatant: false,
    activeCombatantId: "outro-combatente",
  });
  assert.deepEqual(result, { ok: true, cost: 1 });
});

test("personagem fora do combate não age", () => {
  const result = request({ combatant: { id: "combatente-1", isDead: true, ...economy() } });
  assert.deepEqual(result, { ok: false, reason: "combatant_defeated" });
});

test("ação desconhecida é rejeitada antes de qualquer outro cálculo", () => {
  const result = request({ actionType: "voar" });
  assert.deepEqual(result, { ok: false, reason: "invalid_action" });
});

test("movimento acima do disponível é recusado", () => {
  const result = request({
    actionType: "move",
    meters: 9,
    combatant: { id: "combatente-1", isDead: false, ...economy({ movementRemaining: 3 }) },
  });
  assert.deepEqual(result, { ok: false, reason: "movement_exhausted" });
});

test("validação não altera o orçamento recebido", () => {
  const original = economy();
  const snapshot = { ...original };
  request({ combatant: { id: "combatente-1", isDead: false, ...original } });
  request({ combatant: { id: "combatente-1", isDead: false, ...original }, actionType: "invalida" });
  assert.deepEqual(original, snapshot, "resolveAction é puro");
});

// ---------------------------------------------------------------------------
// Ordem de iniciativa e virada de turno
// ---------------------------------------------------------------------------

test("ordena por iniciativa decrescente com desempate estável", () => {
  const order = sortByInitiative([
    { id: "b", initiative: 12, isDead: false, sortOrder: 1 },
    { id: "a", initiative: 18, isDead: false, sortOrder: 0 },
    { id: "c", initiative: 12, isDead: false, sortOrder: 2 },
    { id: "d", initiative: null, isDead: false, sortOrder: 3 },
  ]);
  assert.deepEqual(order.map((entry) => entry.id), ["a", "b", "c", "d"]);
  assert.deepEqual(
    sortByInitiative(order).map((entry) => entry.id),
    order.map((entry) => entry.id),
    "ordenar duas vezes dá o mesmo resultado (mesmo HTML em todo navegador)",
  );
});

test("não modifica o array recebido", () => {
  const input = [
    { id: "b", initiative: 1, isDead: false, sortOrder: 0 },
    { id: "a", initiative: 9, isDead: false, sortOrder: 1 },
  ];
  sortByInitiative(input);
  assert.deepEqual(input.map((entry) => entry.id), ["b", "a"]);
});

test("avança o turno dentro da lista", () => {
  const alive = () => true;
  assert.deepEqual(advanceTurn(["a", "b", "c"], "a", 1, alive), {
    kind: "turn",
    activeCombatantId: "b",
    round: 1,
  });
  assert.deepEqual(advanceTurn(["a", "b", "c"], "c", 1, alive), {
    kind: "round",
    activeCombatantId: "a",
    round: 2,
  });
});

test("primeiro turno começa no topo da lista", () => {
  assert.deepEqual(advanceTurn(["a", "b"], null, 1, () => true), {
    kind: "turn",
    activeCombatantId: "a",
    round: 1,
  });
});

test("pula quem está morto e sobe a rodada ao fim", () => {
  const alive = (id: string) => id !== "b";
  assert.deepEqual(advanceTurn(["a", "b", "c"], "a", 1, alive), {
    kind: "turn",
    activeCombatantId: "c",
    round: 1,
  });
  assert.deepEqual(advanceTurn(["a", "b", "c"], "c", 1, alive), {
    kind: "round",
    activeCombatantId: "a",
    round: 2,
  });
});

test("sem ninguém vivo o combate termina", () => {
  assert.deepEqual(advanceTurn(["a", "b"], "b", 3, () => false), { kind: "finished" });
});

// ---------------------------------------------------------------------------
// Iniciativa de inimigo
// ---------------------------------------------------------------------------

test("iniciativa de inimigo usa REF + d10 explodindo", () => {
  // REF 5 + d10 (1..10); 10 soma outro d10, 1 subtrai outro d10.
  const minPossible = 5 + 1 - 10;
  const maxPossible = 5 + 10 + 10;
  for (let i = 0; i < 200; i += 1) {
    const total = rollEnemyInitiative(5);
    assert.ok(total >= minPossible, `valor abaixo do mínimo: ${total}`);
    assert.ok(total <= maxPossible, `valor acima do máximo: ${total}`);
    assert.ok(Number.isInteger(total), "iniciativa é inteira");
  }
});

// ---------------------------------------------------------------------------
// Orçamento de movimento: MOVE × 2 metros por turno
// ---------------------------------------------------------------------------

test("movimento por turno é MOVE × 2 metros", () => {
  assert.equal(METERS_PER_MOVE, 2);
  assert.equal(movementMetersPerTurn(10), 20, "MOVE 10 → 20 metros");
  assert.equal(movementMetersPerTurn(5), 10);
  assert.equal(movementMetersPerTurn(2), 4, "menor MOVE permitido na criação");
});

test("MOVE 0 não anda e valor inválido não vira orçamento", () => {
  assert.equal(movementMetersPerTurn(0), 0, "paralisia: sem movimento");
  assert.equal(movementMetersPerTurn(-3), 0, "lesão não gera orçamento negativo");
  assert.equal(movementMetersPerTurn(Number.NaN), 0);
  assert.equal(movementMetersPerTurn(Number.POSITIVE_INFINITY), 0);
});

test("MOVE fracionário arredonda para baixo", () => {
  assert.equal(movementMetersPerTurn(4.9), 8, "não dá metro extra");
  assert.equal(movementMetersPerTurn(-0.5), 0);
});

test("o orçamento de fallback do servidor é exatamente MOVE 3", () => {
  // `MOVEMENT_PER_TURN` é o default da coluna movement_max (6): tem que bater
  // com o cálculo para inimigo sem MOVE informado não ficar com 6 ≠ MOVE×2.
  assert.equal(MOVEMENT_PER_TURN, 6);
  assert.equal(MOVEMENT_PER_TURN, movementMetersPerTurn(3));
});

test("gastar do orçamento MOVE × 2 não estoura e não consome Action", () => {
  const budget = economy({ movementMax: 20, movementRemaining: 20 });
  const moved = applyAction(budget, "move", 12);
  assert.equal(moved.movementRemaining, 8);
  assert.equal(moved.actionsRemaining, 2, "mover custa 0 Actions");

  const beforeEnd = request({
    actionType: "move",
    meters: 8,
    combatant: { id: "combatente-1", isDead: false, ...moved },
  });
  assert.deepEqual(beforeEnd, { ok: true, cost: 0 });

  const afterEnd = applyAction(moved, "move", 8);
  assert.equal(afterEnd.movementRemaining, 0);

  const denied = request({
    actionType: "move",
    meters: 1,
    combatant: { id: "combatente-1", isDead: false, ...afterEnd },
  });
  assert.deepEqual(denied, { ok: false, reason: "movement_exhausted" });
});
