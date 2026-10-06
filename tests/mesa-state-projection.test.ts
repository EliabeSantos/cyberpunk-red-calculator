import assert from "node:assert/strict";
import test from "node:test";
import { shouldAcceptMesaSnapshot } from "../src/lib/mesa/useMesaState.ts";

const session = { id: "mesa-a" };

test("projeção rejeita snapshot de outra Mesa", () => {
  assert.equal(shouldAcceptMesaSnapshot({ session: { id: "mesa-b" }, stateVersion: "2" }, "mesa-a", "1"), false);
});

test("projeção não recua para snapshot antigo", () => {
  assert.equal(shouldAcceptMesaSnapshot({ session, stateVersion: "2026-10-01T10:00:00.000Z" }, "mesa-a", "2026-10-01T10:00:01.000Z"), false);
  assert.equal(shouldAcceptMesaSnapshot({ session, stateVersion: "2026-10-01T10:00:02.000Z" }, "mesa-a", "2026-10-01T10:00:01.000Z"), true);
});

test("snapshot sem versão só é aceito antes de conhecer uma versão", () => {
  assert.equal(shouldAcceptMesaSnapshot({ session, stateVersion: undefined }, "mesa-a", null), true);
  assert.equal(shouldAcceptMesaSnapshot({ session, stateVersion: undefined }, "mesa-a", "2026-10-01T10:00:01.000Z"), false);
});
