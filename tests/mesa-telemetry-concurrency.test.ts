import assert from "node:assert/strict";
import test from "node:test";
import { markMesaLocalStage, markMesaPostCommitStage, measureMesaDb, runMesaGatewayTelemetry } from "../src/lib/mesa/telemetryServer.ts";
import { listMesaTelemetry, markMesaRefresh, markMesaVisualConfirmation, startMesaTelemetry } from "../src/lib/mesa/telemetry.ts";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("telemetria DB mantém traces isolados em operações concorrentes", async () => {
  const originalDebug = console.debug;
  const lines: string[] = [];
  console.debug = (...args: unknown[]) => {
    const line = args.map(String).join(" ");
    if (line.includes("[mesa-telemetry]")) lines.push(line);
  };
  const traceA = "telemetry-concurrency-a";
  const traceB = "telemetry-concurrency-b";
  try {
    const request = (traceId: string) => new Request("http://localhost/api/mesa/test/combat/attack", {
      headers: { "x-mesa-telemetry-id": traceId },
    });
    const results = await Promise.allSettled([
      runMesaGatewayTelemetry({
        action: "attack",
        request: request(traceA),
        handler: async () => {
          await wait(8);
          await measureMesaDb(Promise.resolve("a-1"), "operation.a.1");
          await wait(2);
          await measureMesaDb(Promise.resolve("a-2"), "operation.a.2");
        },
      }),
      runMesaGatewayTelemetry({
        action: "movement",
        request: request(traceB),
        handler: async () => {
          await measureMesaDb(Promise.resolve("b-1"), "operation.b.1");
          await wait(12);
          await assert.rejects(() => measureMesaDb(Promise.reject(new Error("expected test failure")), "operation.b.failure"));
          throw new Error("expected gateway failure");
        },
      }),
    ]);

    assert.equal(results[0].status, "fulfilled");
    assert.equal(results[1].status, "rejected");
    const events = lines
      .map((line) => line.match(/\[mesa-telemetry\]\s*(\{.*\})$/)?.[1])
      .filter((value): value is string => Boolean(value))
      .map((value) => JSON.parse(value) as Record<string, unknown>);
    const dbEvents = events.filter((event) => event.stage === "DB_OP");
    assert.deepEqual(
      dbEvents.filter((event) => event.traceId === traceA).map((event) => event.operation).sort(),
      ["operation.a.1", "operation.a.2"],
    );
    assert.deepEqual(
      dbEvents.filter((event) => event.traceId === traceB).map((event) => event.operation).sort(),
      ["operation.b.1", "operation.b.failure"],
    );
    assert.equal(dbEvents.some((event) => event.traceId === traceA && String(event.operation).startsWith("operation.b")), false);
    assert.equal(dbEvents.some((event) => event.traceId === traceB && String(event.operation).startsWith("operation.a")), false);
    assert.equal(dbEvents.find((event) => event.operation === "operation.b.failure")?.success, false);
  } finally {
    console.debug = originalDebug;
  }
});

test("telemetria separa durações local, DB e pós-commit", async () => {
  const originalDebug = console.debug;
  const lines: string[] = [];
  console.debug = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  try {
    await runMesaGatewayTelemetry({
      action: "attack",
      request: new Request("http://localhost/api/mesa/test/combat/attack", {
        headers: { "x-mesa-telemetry-id": "telemetry-metrics" },
      }),
      handler: async () => {
        markMesaLocalStage("LOCAL.test", 1.25);
        await measureMesaDb(Promise.resolve("ok"), "operation.test");
        markMesaPostCommitStage(2.5);
      },
    });
    const events = lines
      .map((line) => line.match(/\[mesa-telemetry\]\s*(\{.*\})$/)?.[1])
      .filter((value): value is string => Boolean(value))
      .map((value) => JSON.parse(value) as Record<string, unknown>);
    const local = events.find((event) => event.stage === "LOCAL.test");
    const db = events.find((event) => event.stage === "DB_OP");
    const postCommit = events.find((event) => event.stage === "POST_COMMIT");
    const gateway = events.find((event) => event.stage === "gateway");
    assert.equal(local?.local_duration_ms, 1.25);
    assert.equal(db?.db_op_duration_ms, db?.durationMs);
    assert.equal(db?.measurement, "external_call_wall_time");
    assert.equal(postCommit?.post_commit_duration_ms, 2.5);
    assert.equal(gateway?.gateway_duration_ms, gateway?.durationMs);
  } finally {
    console.debug = originalDebug;
  }
});

test("telemetria marca confirmação visual pela mesma resolutionId", () => {
  const sessionId = "visual-session";
  const resolutionId = "visual-resolution";
  const traceId = startMesaTelemetry({ action: "movement", sessionId, resolutionId });
  markMesaVisualConfirmation({ sessionId, resolutionId });
  const event = listMesaTelemetry().find((entry) => entry.traceId === traceId && entry.stage === "visual_confirmed");
  assert.equal(event?.resolutionId, resolutionId);
  assert.equal(event?.action, "movement");
});

test("GET de reconciliação não substitui a ação visual pendente", () => {
  const sessionId = "visual-refresh-session";
  const resolutionId = "visual-refresh-resolution";
  const traceId = startMesaTelemetry({ action: "attack", sessionId, resolutionId });
  startMesaTelemetry({ action: "mesa", sessionId });
  markMesaVisualConfirmation({ sessionId, resolutionId });
  const event = listMesaTelemetry().find((entry) => entry.traceId === traceId && entry.stage === "visual_confirmed");
  assert.equal(event?.resolutionId, resolutionId);
  assert.equal(event?.action, "attack");
});

test("T13 confirma ataque somente depois do snapshot reconciliado", () => {
  const sessionId = "visual-t13-session";
  const resolutionId = "visual-t13-resolution";
  const traceId = startMesaTelemetry({ action: "attack", sessionId, resolutionId });
  markMesaRefresh({ sessionId, stage: "T13", stateVersion: "version-1" });
  const event = listMesaTelemetry().find((entry) => entry.traceId === traceId && entry.stage === "visual_confirmed");
  assert.equal(event?.resolutionId, resolutionId);
  assert.equal(event?.stateVersion, undefined);
});
