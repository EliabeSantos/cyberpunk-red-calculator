import assert from "node:assert/strict";
import test from "node:test";
import { IMPLEMENTED_NET_ACTIONS, NET_ACTION_AUDIT, isImplementedNetAction } from "../src/lib/mesa/netActions.ts";

test("F1.57 mantém um único catálogo para os NET Actions implementados", () => {
  assert.deepEqual([...IMPLEMENTED_NET_ACTIONS], ["pathfinder", "backdoor", "control", "zap", "slide"]);
  for (const action of IMPLEMENTED_NET_ACTIONS) {
    assert.equal(NET_ACTION_AUDIT[action].status, "implemented");
    assert.equal(NET_ACTION_AUDIT[action].gateway, "executeNetAction");
    assert.equal(isImplementedNetAction(action), true);
  }
});

test("F1.57 não expõe Actions sem regra confirmada", () => {
  for (const action of ["scanner", "eye_on_target", "target_backpack", "virus"] as const) {
    assert.equal(NET_ACTION_AUDIT[action].status, "unresolved");
    assert.equal(isImplementedNetAction(action), false);
    assert.ok("reason" in NET_ACTION_AUDIT[action] && NET_ACTION_AUDIT[action].reason.length > 0);
  }
});
