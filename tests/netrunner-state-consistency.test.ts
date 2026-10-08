import assert from "node:assert/strict";
import test from "node:test";
import { DISCONNECTED_NETRUNNER_STATE, safeJackOutState, unsafeJackOutState } from "../src/lib/mesa/netrunner.ts";

test("Jack Out mantém RAM/programas, mas não mantém recursos de sessão NET", () => {
  const connected = {
    ...DISCONNECTED_NETRUNNER_STATE,
    isJackedIn: true,
    connectedAccessPointId: "ap-1",
    connectionType: "wireless" as const,
    architectureId: "arch-1",
    currentFloor: 3,
    interfaceRank: 4,
    ramMax: 10,
    ramCurrent: 0,
    netActionsMax: 3,
    netActionsRemaining: 2,
    engagedBlackIceIds: ["ice-1"],
    programs: [],
  };
  const safe = safeJackOutState(connected);
  assert.equal(safe.isJackedIn, false);
  assert.equal(safe.currentFloor, null);
  assert.equal(safe.netActionsRemaining, 0);
  assert.deepEqual(safe.engagedBlackIceIds, []);
  assert.equal(safe.ramCurrent, 0);
  assert.equal(unsafeJackOutState(connected).unsafeJackOut, true);
});
