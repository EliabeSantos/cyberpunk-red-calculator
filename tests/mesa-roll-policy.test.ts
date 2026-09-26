import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIONS_PER_TURN,
  applyAction,
  getActionCost,
  resolveAction,
  type ActionEconomy,
} from "../src/lib/combatEngine.ts";
import {
  MESA_ROLL_ACTION,
  formatRollEvent,
  isMesaRollKind,
  parseMesaRoll,
  rollDenialNote,
  summarizeRoll,
  type MesaRollSummary,
} from "../src/lib/mesa/rollPolicy.ts";
import type { RollHistoryEntry } from "../src/types/character.ts";

function entry(overrides: Partial<RollHistoryEntry> = {}): RollHistoryEntry {
  return {
    id: "roll-1",
    type: "attack",
    label: "Ataque Pistola",
    characterId: "char-1",
    expression: "REF 6 + 1d10 [7]",
    rolls: [7],
    total: 13,
    timestamp: "2026-09-26T12:00:00.000Z",
    ...overrides,
  } as RollHistoryEntry;
}

function economy(overrides: Partial<ActionEconomy> = {}): ActionEconomy {
  return {
    actionsMax: ACTIONS_PER_TURN,
    actionsRemaining: ACTIONS_PER_TURN,
    movementMax: 6,
    movementRemaining: 6,
    ...overrides,
  };
}

/** O caminho do servidor: valida com o motor e aplica o custo da política. */
function spendFor(kind: keyof typeof MESA_ROLL_ACTION, state: ActionEconomy) {
  const actionType = MESA_ROLL_ACTION[kind];
  if (!actionType) return { state, debited: false as const };
  const result = resolveAction({
    combatStatus: "active",
    initiativeStarted: true,
    activeCombatantId: "combatente-1",
    actorRole: "player",
    actorOwnsCombatant: true,
    combatant: { id: "combatente-1", isDead: false, ...state },
    actionType,
    meters: 0,
  });
  if (!result.ok) return { state, debited: false as const, reason: result.reason };
  return { state: applyAction(state, actionType, 0), debited: true as const };
}

test("tipos que vão para a mesa", () => {
  assert.equal(isMesaRollKind("attack"), true);
  assert.equal(isMesaRollKind("evasion"), true);
  assert.equal(isMesaRollKind("free_roll"), true);
  assert.equal(isMesaRollKind("humanity_loss"), false);
  assert.equal(isMesaRollKind(42), false);
});

test("summarizeRoll guarda o que a mesa precisa exibir", () => {
  const roll = summarizeRoll(entry());
  assert.ok(roll);
  assert.equal(roll.type, "attack");
  assert.equal(roll.label, "Ataque Pistola");
  assert.equal(roll.expression, "REF 6 + 1d10 [7]");
  assert.equal(roll.total, 13);
  assert.deepEqual(roll.rolls, [7]);
});

test("summarizeRoll recusa o que não é rolagem de mesa", () => {
  assert.equal(summarizeRoll(entry({ type: "humanity_loss" })), null);
  assert.equal(summarizeRoll(null), null);
  assert.equal(summarizeRoll(undefined), null);
});

test("summarizeRoll normaliza valores sujos sem lançar erro", () => {
  const roll = summarizeRoll({
    type: "free_roll",
    label: "   ",
    expression: "2d6",
    total: 7.6,
    rolls: [3, 4, Number.NaN, "x"] as unknown as number[],
  });
  assert.ok(roll);
  assert.equal(roll.label, "Rolagem");
  assert.equal(roll.total, 8);
  assert.deepEqual(roll.rolls, [3, 4]);
});

test("a política de custo bate com o Combat Engine", () => {
  assert.equal(getActionCost(MESA_ROLL_ACTION.attack!), 1);
  assert.equal(getActionCost(MESA_ROLL_ACTION.skill_check!), 1);
  assert.equal(getActionCost(MESA_ROLL_ACTION.evasion!), 1);

  // Dano, dano recebido e rolagem livre não podem comer Action.
  assert.equal(MESA_ROLL_ACTION.damage, null);
  assert.equal(MESA_ROLL_ACTION.received_damage, null);
  assert.equal(MESA_ROLL_ACTION.free_roll, null);
});

test("ataque rola na ficha e debita 1 Action da mesa", () => {
  const before = economy();
  const after = spendFor("attack", before);
  assert.equal(after.debited, true);
  assert.equal(after.state.actionsRemaining, before.actionsRemaining - 1);
  // O orçamento de movimento não é afetado por um ataque.
  assert.equal(after.state.movementRemaining, before.movementRemaining);
});

test("perícia e Evasion também custam 1 Action", () => {
  for (const kind of ["skill_check", "evasion"] as const) {
    const result = spendFor(kind, economy());
    assert.equal(result.debited, true, kind);
    assert.equal(result.state.actionsRemaining, ACTIONS_PER_TURN - 1, kind);
  }
});

test("dano e rolagem livre não mexem no orçamento", () => {
  const before = economy({ actionsRemaining: 1, movementRemaining: 3 });
  for (const kind of ["damage", "received_damage", "free_roll"] as const) {
    const result = spendFor(kind, before);
    assert.equal(result.debited, false, kind);
    assert.deepEqual(result.state, before, kind);
  }
});

test("fora do turno a rolagem não debita, mas o motivo fica registrado", () => {
  const result = resolveAction({
    combatStatus: "active",
    initiativeStarted: true,
    activeCombatantId: "outro-combatente",
    actorRole: "player",
    actorOwnsCombatant: true,
    combatant: { id: "combatente-1", isDead: false, ...economy() },
    actionType: MESA_ROLL_ACTION.attack!,
    meters: 0,
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.reason : "", "not_your_turn");
  assert.equal(rollDenialNote("not_your_turn"), "fora do seu turno");
});

test("o motivo vira um sufixo curto no registro", () => {
  assert.equal(rollDenialNote("not_your_turn"), "fora do seu turno");
  assert.equal(rollDenialNote("insufficient_actions"), "sem Actions sobrando");
  assert.equal(rollDenialNote("not_allowed"), "sem combatente vinculado");
  assert.equal(rollDenialNote(null), "");
  assert.equal(rollDenialNote(undefined), "");
  assert.equal(rollDenialNote("qualquer-coisa"), "não contou");
});

test("parseMesaRoll valida o que vem do navegador", () => {
  const valid = parseMesaRoll({ type: "attack", label: "Ataque", expression: "1d10+6", total: 15, rolls: [9] });
  assert.equal(valid.ok, true);
  if (valid.ok) assert.equal(valid.roll.total, 15);

  assert.equal(parseMesaRoll({ type: "humanity_loss", total: 3 }).ok, false);
  assert.equal(parseMesaRoll({ label: "sem tipo", total: 3 }).ok, false);
  assert.equal(parseMesaRoll({ type: "attack", total: 99999 }).ok, false);
  assert.equal(parseMesaRoll(null).ok, false);
  assert.equal(parseMesaRoll("ataque").ok, false);
  assert.equal(parseMesaRoll([1, 2, 3]).ok, false);
});

test("formatRollEvent escreve a linha do Registro do combate", () => {
  const roll: MesaRollSummary = {
    type: "attack",
    label: "Ataque Pistola",
    expression: "REF 6 + 1d10 [7]",
    total: 13,
    rolls: [7],
  };

  assert.equal(formatRollEvent("Zuberi", roll), "Zuberi: Ataque Pistola 13 (REF 6 + 1d10 [7])");
  assert.equal(
    formatRollEvent("Zuberi", roll, rollDenialNote("not_your_turn")),
    "Zuberi: Ataque Pistola 13 (REF 6 + 1d10 [7]) · fora do seu turno",
  );
  // Sem expressão não sobra parêntese vazio.
  assert.equal(formatRollEvent("Zuberi", { ...roll, expression: "" }), "Zuberi: Ataque Pistola 13");
  // Nome vazio cai em um rótulo genérico em vez de começar com ":".
  assert.equal(formatRollEvent("   ", { ...roll, expression: "" }), "Jogador: Ataque Pistola 13");
});

test("formatRollEvent nunca passa do tamanho de um evento", () => {
  const roll: MesaRollSummary = {
    type: "attack",
    label: "A".repeat(200),
    expression: "B".repeat(200),
    total: 10,
    rolls: [],
  };
  assert.ok(formatRollEvent("Zuberi", roll, "fora do seu turno").length <= 200);
});
