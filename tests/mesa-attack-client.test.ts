import assert from "node:assert/strict";
import test from "node:test";

const storage = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  },
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
};

let request: { url: string; body: Record<string, unknown> } | null = null;
let responseStatus = 200;
let responsePayload: unknown = { ok: true, attackResult: {} };
(globalThis as unknown as { fetch: unknown }).fetch = (url: string, options: { body?: string }) => {
  request = { url, body: JSON.parse(options.body ?? "{}") as Record<string, unknown> };
  return Promise.resolve({ ok: responseStatus >= 200 && responseStatus < 300, status: responseStatus, json: async () => responsePayload });
};

const { attackMesa, reloadMesa, MesaApiError } = await import("../src/lib/mesa/client.ts");

test("reload envia somente intenção e resolutionId", async () => {
  responseStatus = 200;
  responsePayload = { ok: true, weaponId: "weapon-1", ammoAfter: 8, actionsAfter: 1 };
  await reloadMesa({ sessionId: "session-1", weaponId: "weapon-1", resolutionId: "reload-1" });

  assert.equal(request?.url, "/api/mesa/session-1/combat/reload");
  assert.deepEqual(request?.body, {
    resolutionId: "reload-1",
    weaponId: "weapon-1",
  });
  assert.equal("ammoAfter" in (request?.body ?? {}), false);
  assert.equal("reserveAfter" in (request?.body ?? {}), false);
  assert.equal("reloadAmount" in (request?.body ?? {}), false);
});

test("reload gera uma resolutionId nova quando a UI não fornece uma", async () => {
  responseStatus = 200;
  responsePayload = { ok: true, weaponId: "weapon-1" };
  await reloadMesa({ sessionId: "session-1", weaponId: "weapon-1" });

  assert.match(String(request?.body.resolutionId), /^[0-9a-f-]{36}$/i);
  assert.deepEqual(request?.body, {
    resolutionId: request?.body.resolutionId,
    weaponId: "weapon-1",
  });
});

test("ataque integrado envia intenção, nunca resultado ou defesa calculada", async () => {
  await attackMesa({
    sessionId: "session-1",
    actorId: "actor-1",
    targetId: "target-1",
    weaponId: "weapon-1",
    attackType: "weapon",
    attackMode: "normal",
  });

  assert.equal(request?.url, "/api/mesa/session-1/combat/attack");
  assert.deepEqual(request?.body, {
    resolutionId: request?.body.resolutionId,
    actorId: "actor-1",
    targetId: "target-1",
    weaponId: "weapon-1",
    attackType: "weapon",
    attackMode: "normal",
  });
  assert.equal(typeof request?.body.resolutionId, "string");
  assert.equal("total" in (request?.body ?? {}), false);
  assert.equal("roll" in (request?.body ?? {}), false);
  assert.equal("defense" in (request?.body ?? {}), false);
});

test("Aimed Head chega como intenção explícita", async () => {
  responseStatus = 200;
  responsePayload = { ok: true, attackResult: {} };

  await attackMesa({ sessionId: "s", actorId: "a", targetId: "t", weaponId: "w", attackMode: "aimed", aimedTarget: "head" });
  assert.equal(request?.body.aimedTarget, "head");

  await attackMesa({ sessionId: "s", actorId: "a", targetId: "t", weaponId: "w", attackMode: "aimed", aimedTarget: "head" });
  assert.equal(request?.body.aimedTarget, "head");
});

test("retry reutiliza o resolutionId fornecido e nunca envia resultado do Engine", async () => {
  responseStatus = 200;
  responsePayload = { ok: true, attackResult: {} };
  await attackMesa({ sessionId: "s", actorId: "a", targetId: "t", resolutionId: "resolution-retry-1", attackMode: "aimed", aimedTarget: "head" });
  assert.equal(request?.body.resolutionId, "resolution-retry-1");
  assert.equal("damageResult" in (request?.body ?? {}), false);
  assert.equal("ammoAfter" in (request?.body ?? {}), false);
});

test("erro server-side preserva código/status para a UI", async () => {
  responseStatus = 409;
  responsePayload = { ok: false, code: "hp_conflict", error: "O HP mudou." };

  await assert.rejects(
    () => attackMesa({ sessionId: "s", actorId: "a", targetId: "t", weaponId: "w", attackMode: "aimed", aimedTarget: "head" }),
    (caught: unknown) => caught instanceof MesaApiError && caught.code === "hp_conflict" && caught.status === 409,
  );

  responseStatus = 200;
  responsePayload = { ok: true, attackResult: {} };
});

test("Player recebe o AttackResult e ammoAfter do servidor sem recalcular localmente", async () => {
  responseStatus = 200;
  const attackResult = { attackId: "server-attack", total: 18, hit: true };
  responsePayload = { ok: true, attackResult, ammoAfter: 5 };

  const result = await attackMesa({
    sessionId: "session-player",
    actorId: "actor-player",
    targetId: "target-enemy",
    weaponId: "weapon-player",
    skillId: "handgun",
    attackType: "handgun",
    attackMode: "normal",
  });

  assert.deepEqual(result.attackResult, attackResult);
  assert.equal(result.ammoAfter, 5);
  assert.equal("roll" in (request?.body ?? {}), false);
  assert.equal("defense" in (request?.body ?? {}), false);
  assert.equal("ammoAfter" in (request?.body ?? {}), false);
});

test("Player recebe DamageResult do mesmo endpoint sem enviar dano ao servidor", async () => {
  responseStatus = 200;
  responsePayload = {
    ok: true,
    attackResult: { attackId: "a", hit: true },
    weaponDamage: { rolls: [6, 4], total: 10 },
    damageResult: { targetId: "target-enemy", rawDamage: 10, hpBefore: 20, hpAfter: 14 },
  };

  const result = await attackMesa({ sessionId: "s", actorId: "a", targetId: "t", weaponId: "w", attackMode: "aimed", aimedTarget: "head" });
  assert.deepEqual(result.weaponDamage, { rolls: [6, 4], total: 10 });
  assert.deepEqual(result.damageResult, { targetId: "target-enemy", rawDamage: 10, hpBefore: 20, hpAfter: 14 });
  assert.equal("rawDamage" in (request?.body ?? {}), false);
  assert.equal("damageResult" in (request?.body ?? {}), false);
});
