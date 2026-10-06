import assert from "node:assert/strict";
import test from "node:test";
import { resolveAction } from "../src/lib/combatEngine.ts";

const combatant = {
  id: "player-a",
  isDead: false,
  actionsMax: 2,
  actionsRemaining: 2,
  movementMax: 12,
  movementRemaining: 12,
};

test("resolveAction exige o combatant ativo e não aceita turno declarado pelo cliente", () => {
  assert.deepEqual(resolveAction({
    combatStatus: "active",
    initiativeStarted: true,
    activeCombatantId: "player-b",
    actorRole: "player",
    actorOwnsCombatant: true,
    combatant,
    actionType: "attack",
  }), { ok: false, reason: "not_your_turn" });
});

test("ação válida só passa com iniciativa e turno server-side ativos", () => {
  assert.deepEqual(resolveAction({
    combatStatus: "active",
    initiativeStarted: true,
    activeCombatantId: "player-a",
    actorRole: "player",
    actorOwnsCombatant: true,
    combatant,
    actionType: "attack",
  }), { ok: true, cost: 1 });
  assert.deepEqual(resolveAction({
    combatStatus: "active",
    initiativeStarted: false,
    activeCombatantId: "player-a",
    actorRole: "player",
    actorOwnsCombatant: true,
    combatant,
    actionType: "attack",
  }), { ok: false, reason: "initiative_not_started" });
});

test("movimento usa o orçamento server-side sem consumir Action", () => {
  assert.deepEqual(resolveAction({
    combatStatus: "active",
    initiativeStarted: true,
    activeCombatantId: "player-a",
    actorRole: "player",
    actorOwnsCombatant: true,
    combatant,
    actionType: "move",
    meters: 6,
  }), { ok: true, cost: 0 });
});
