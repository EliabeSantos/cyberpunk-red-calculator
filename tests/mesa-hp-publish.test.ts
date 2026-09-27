/**
 * Espelho de VIDA (HP) da origem para a MESA (o trecho que roda no navegador).
 *
 * Prova as promessas da feature: sem mesa ativa nada sai do navegador; vida
 * que não mudou não gera requisição; vida mudada vira POST /combat/hp com o
 * valor novo (e a chave do inimigo, quando é o Mestre); falha de rede nunca
 * estoura para cima da ficha nem da tela de encontros.
 */
import assert from "node:assert/strict";
import test from "node:test";

// --- ambiente falso de navegador (precisa existir ANTES das chamadas) ---------
const storage = new Map<string, string>();

(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  },
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
};

interface Call {
  url: string;
  options: { method?: string; headers?: Record<string, string>; body?: string };
}
const calls: Call[] = [];
let failNext = false;

(globalThis as unknown as { fetch: unknown }).fetch = (url: string, options: Call["options"]) => {
  calls.push({ url, options });
  if (failNext) return Promise.reject(new Error("fetch failed"));
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, updated: true }) });
};

const { rememberMembership, removeMembership, clearActiveMembership } = await import(
  "../src/lib/mesa/membershipStore.ts"
);
const { publishMesaHp, publishMesaEnemyHp } = await import("../src/lib/mesa/hpPublish.ts");

interface FakeSheet {
  combat: { hp: { current: number; max: number }; isDead: boolean };
}

function sheet(hp: number, options: { max?: number; dead?: boolean } = {}): FakeSheet {
  return { combat: { hp: { current: hp, max: options.max ?? 40 }, isDead: options.dead ?? false } };
}

function body(index: number): Record<string, unknown> {
  return JSON.parse(calls[index].options.body ?? "{}") as Record<string, unknown>;
}

function reset(active: boolean): void {
  calls.length = 0;
  storage.clear();
  failNext = false;
  clearActiveMembership();
  if (active) {
    rememberMembership("ABCDE", {
      sessionId: "sessao-1",
      participantId: "part-1",
      displayName: "Jogadora",
      role: "player",
    });
  }
}

test("sem mesa ativa, a vida da ficha não sai do navegador", () => {
  reset(false);
  publishMesaHp(sheet(30) as never, sheet(25) as never);
  publishMesaEnemyHp("inimigo-1", 7);
  assert.equal(calls.length, 0);
});

test("vida que não mudou não gera requisição", () => {
  reset(true);
  publishMesaHp(sheet(30) as never, sheet(30) as never);
  assert.equal(calls.length, 0);
});

test("dano na ficha manda o HP novo para /combat/hp", () => {
  reset(true);
  publishMesaHp(sheet(30) as never, sheet(24) as never);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/mesa/sessao-1/combat/hp");
  assert.equal(calls[0].options.method, "POST");
  assert.ok(calls[0].options.headers?.["x-mesa-token"], "o token do navegador acompanha a chamada");

  const sent = body(0);
  assert.equal(sent.hp, 24);
  assert.equal(sent.hpMax, 40);
  assert.equal(sent.isDead, false);
  assert.equal(sent.key, undefined, "o jogador nunca manda chave de inimigo");
});

test("cura e morte também são espelhadas", () => {
  reset(true);
  publishMesaHp(sheet(24) as never, sheet(31) as never);
  assert.equal(body(0).hp, 31);

  publishMesaHp(sheet(1) as never, sheet(0, { dead: true }) as never);
  assert.equal(body(1).hp, 0);
  assert.equal(body(1).isDead, true);
});

test("sem estado anterior (personagem novo) empurra a vida atual", () => {
  reset(true);
  publishMesaHp(null, sheet(40) as never);
  assert.equal(calls.length, 1);
  assert.equal(body(0).hp, 40);
});

test("o primeiro empurrão não acontece duas vezes seguidas", () => {
  reset(true);
  publishMesaHp(sheet(30) as never, sheet(24) as never);
  publishMesaHp(sheet(24) as never, sheet(24) as never);
  assert.equal(calls.length, 1);
});

test("dano do Mestre no encontro vai com a chave do inimigo", () => {
  reset(true);
  publishMesaEnemyHp("inimigo-uuid-1", 7);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/mesa/sessao-1/combat/hp");
  const sent = body(0);
  assert.equal(sent.key, "inimigo-uuid-1");
  assert.equal(sent.hp, 7);
  assert.equal(sent.hpMax, undefined, "inimigo não renegoocia o máximo");
  assert.equal(sent.isDead, undefined, "o servidor decide morte pelo HP do inimigo");
});

test("inimigo sem chave estável não é enviado (evita atualizar a linha errada)", () => {
  reset(true);
  publishMesaEnemyHp(null, 7);
  publishMesaEnemyHp(undefined, 7);
  publishMesaEnemyHp("", 7);
  assert.equal(calls.length, 0);
});

test("sair da mesa corta o espelho na hora", () => {
  reset(true);
  removeMembership("ABCDE");
  publishMesaHp(sheet(30) as never, sheet(25) as never);
  publishMesaEnemyHp("inimigo-uuid-1", 7);
  assert.equal(calls.length, 0);
});

test("servidor fora do ar não estoura para cima da ficha", async () => {
  reset(true);
  failNext = true;
  publishMesaHp(sheet(30) as never, sheet(25) as never);
  publishMesaEnemyHp("inimigo-uuid-1", 7);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls.length, 2);
});
