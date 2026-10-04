import assert from "node:assert/strict";
import test from "node:test";

import {
  authenticate,
  authorizeCombatAttackActor,
  MesaError,
  type Actor,
} from "../src/lib/mesa/store.ts";

function actor(role: "gm" | "player", participantId: string, sessionId = "session-a"): Actor {
  return {
    session: {
      id: sessionId,
      name: "Mesa",
      gmId: role === "gm" ? participantId : "gm-1",
      status: "active",
      joinCode: "ABCDE",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    participant: {
      id: participantId,
      sessionId,
      displayName: participantId,
      characterId: null,
      role,
      connectedAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

function combatant(sessionId = "session-a", participantId: string | null = "player-a") {
  return { session_id: sessionId, participant_id: participantId };
}

function errorOf(callback: () => void): MesaError {
  try {
    callback();
  } catch (caught) {
    assert.ok(caught instanceof MesaError);
    return caught;
  }
  assert.fail("expected authorization error");
}

test("request sem token é rejeitada antes de consultar a Mesa", async () => {
  await assert.rejects(
    () => authenticate("session-a", null),
    (caught: unknown) => caught instanceof MesaError && caught.status === 401 && caught.code === "missing_token",
  );
});

test("GM mantém a política atual para combatants da própria Mesa", () => {
  authorizeCombatAttackActor(actor("gm", "gm-1"), combatant());
});

test("Player pode autorizar somente seu próprio combatant", () => {
  authorizeCombatAttackActor(actor("player", "player-a"), combatant("session-a", "player-a"));
});

test("Player A não pode controlar o combatant de Player B", () => {
  const error = errorOf(() => authorizeCombatAttackActor(actor("player", "player-a"), combatant("session-a", "player-b")));
  assert.equal(error.status, 403);
  assert.equal(error.code, "combatant_not_owned");
});

test("Player não pode controlar inimigo ou combatant sem ownership", () => {
  const error = errorOf(() => authorizeCombatAttackActor(actor("player", "player-a"), combatant("session-a", null)));
  assert.equal(error.status, 403);
  assert.equal(error.code, "combatant_not_owned");
});

test("combatant de outra Mesa é recusado sem revelar ownership", () => {
  const error = errorOf(() => authorizeCombatAttackActor(actor("player", "player-a", "session-a"), combatant("session-b", "player-a")));
  assert.equal(error.status, 404);
  assert.equal(error.code, "combatant_not_found");
});

test("campos forjados actorRole e actorOwnsCombatant não participam da decisão", () => {
  const forgedRequest = {
    ...actor("player", "player-a"),
    actorRole: "gm",
    actorOwnsCombatant: true,
  } as Actor & { actorRole: string; actorOwnsCombatant: boolean };

  const error = errorOf(() => authorizeCombatAttackActor(forgedRequest, combatant("session-a", "player-b")));
  assert.equal(error.status, 403);
  assert.equal(error.code, "combatant_not_owned");
});
