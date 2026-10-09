import assert from "node:assert/strict";
import test from "node:test";

import { shouldReconcileAfterAction } from "../src/lib/mesa/useMesaState.ts";
import { listMesaTelemetry, startMesaTelemetry } from "../src/lib/mesa/telemetry.ts";

test("ação não faz GET adicional quando um snapshot já foi aplicado", () => {
  assert.equal(shouldReconcileAfterAction(10, 11), false);
  assert.equal(shouldReconcileAfterAction(10, 10), true);
});

test("telemetria identifica a ação sem expor token ou estado da Mesa", () => {
  const traceId = startMesaTelemetry({ action: "attack", sessionId: "session-secret-value", resolutionId: "resolution-123456" });
  const event = listMesaTelemetry().find((entry) => entry.traceId === traceId && entry.stage === "T0");
  assert.ok(event);
  assert.equal(event.sessionId, "session-");
  assert.equal("token" in event, false);
  assert.equal("state" in event, false);
  assert.equal(event.action, "attack");
});
