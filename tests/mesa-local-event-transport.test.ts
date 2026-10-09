import assert from "node:assert/strict";
import test from "node:test";

import { LocalMesaEventTransport } from "../src/lib/mesa/localEventTransport.ts";

test("publica somente invalidação para assinantes da mesma sessão", async () => {
  const transport = new LocalMesaEventTransport();
  const first: unknown[] = [];
  const second: unknown[] = [];
  const other: unknown[] = [];
  const firstSubscription = transport.subscribeInvalidation("session-a", (event) => first.push(event));
  const secondSubscription = transport.subscribeInvalidation("session-a", (event) => second.push(event));
  const otherSubscription = transport.subscribeInvalidation("session-b", (event) => other.push(event));

  await transport.publishInvalidation("session-a");
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(other.length, 0);
  assert.deepEqual(first[0], { sessionId: "session-a", publishedAt: (first[0] as { publishedAt: number }).publishedAt });
  assert.equal(Object.keys(first[0] as object).includes("state"), false);
  firstSubscription?.close();
  secondSubscription?.close();
  otherSubscription?.close();
});

test("cancelamento é idempotente e não deixa listeners acumulados", async () => {
  const transport = new LocalMesaEventTransport();
  let calls = 0;
  const subscription = transport.subscribeInvalidation("session-c", () => { calls += 1; });
  subscription?.close();
  subscription?.close();
  await transport.publishInvalidation("session-c");
  assert.equal(calls, 0);
  const next = transport.subscribeInvalidation("session-c", () => { calls += 1; });
  await transport.publishInvalidation("session-c");
  assert.equal(calls, 1);
  next?.close();
});

test("falha de um listener não impede os demais nem propaga payload privado", async () => {
  const transport = new LocalMesaEventTransport();
  const statuses: string[] = [];
  let delivered = 0;
  transport.subscribeInvalidation("session-d", () => { throw new Error("listener failure"); }, (status) => statuses.push(status));
  const healthy = transport.subscribeInvalidation("session-d", (event) => {
    delivered += 1;
    assert.deepEqual(Object.keys(event).sort(), ["publishedAt", "sessionId"]);
  });

  await transport.publishInvalidation("session-d");
  assert.equal(delivered, 1);
  assert.equal(statuses.includes("CHANNEL_ERROR"), true);
  healthy?.close();
});

test("sessão inválida não cria assinatura nem entrega evento", async () => {
  const transport = new LocalMesaEventTransport();
  assert.equal(transport.subscribeInvalidation("", () => undefined), null);
  await transport.publishInvalidation("");
});
