import assert from "node:assert/strict";
import test from "node:test";

// --- ambiente falso de navegador ---
const storage = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  },
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
};

const calls: { url: string; body: unknown }[] = [];
let failNext = false;
(globalThis as unknown as { fetch: unknown }).fetch = async (_url: string, _options: unknown) => {
  const url = String(_url);
  const body = typeof _options === "object" && _options !== null && "body" in _options
    ? JSON.parse(String((_options as { body?: unknown }).body ?? "{}"))
    : null;
  calls.push({ url, body });
  if (failNext) throw new Error("network down");
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

const { rememberMembership, getActiveMembership, removeMembership, clearActiveMembership } =
  await import("../src/lib/mesa/membershipStore.ts");
const {
  publishMesaGmAttack,
  publishMesaGmSkill,
  publishMesaGmEvasion,
  publishMesaGmDamage,
  publishMesaGmInitiative,
} = await import("../src/lib/mesa/gmRollPublish.ts");

function seed(sessionId: string) {
  clearActiveMembership();
  calls.length = 0;
  failNext = false;
  rememberMembership("GM1", {
    sessionId,
    participantId: "gm-1",
    displayName: "Mestre",
    role: "gm",
  });
}

test("sem mesa ativa, nada sai do navegador do GM", () => {
  clearActiveMembership();
  calls.length = 0;
  publishMesaGmAttack("Militante", "Fuzil", "1d10", 14, [7]);
  assert.equal(calls.length, 0);
});

test("ataque do GM entra no POST correto com actor=inimigo", () => {
  seed("sessao-gm-1");
  publishMesaGmAttack("Militante", "Fuzil", "1d10", 14, [7]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/mesa/sessao-gm-1/combat/roll");
  const body = calls[0].body as { roll: { type: string; label: string; expression: string; total: number; rolls: number[] } };
  assert.equal(body.roll.type, "attack");
  assert.equal(body.roll.label, "Fuzil");
  assert.equal(body.roll.expression, "1d10");
  assert.equal(body.roll.total, 14);
  assert.deepEqual(body.roll.rolls, [7]);
  // Catálogo de inimigos / GM de fora: relatório puro, sem chave de inimigo.
  assert.equal("key" in body, false);
});

test("ataque do encontro vinculado manda a chave do inimigo que paga", () => {
  seed("sessao-gm-1");
  publishMesaGmAttack("Militante", "Fuzil", "1d10", 14, [7], "part-9");
  const body = calls[0].body as { roll: { type: string }; key?: string };
  assert.equal(body.roll.type, "attack");
  assert.equal(body.key, "part-9");
});

test("dano e iniciativa do encontro também levam a chave (só o ataque debita)", () => {
  seed("sessao-gm-1");
  publishMesaGmDamage("Militante", "Dano de Fuzil", "2d6", 9, [4, 5], "part-9");
  assert.equal((calls[0].body as { roll: { type: string }; key?: string }).key, "part-9");
  publishMesaGmInitiative("Militante", 17, "part-9");
  assert.equal((calls[1].body as { roll: { type: string }; key?: string }).key, "part-9");
  // Chave vazia/antiga não vai no corpo: o servidor trataria como "sem chave".
  publishMesaGmAttack("Militante", "Fuzil", "1d10", 14, [7], undefined);
  assert.equal("key" in (calls[2].body as Record<string, unknown>), false);
});

test("perícia do GM vai como skill_check", () => {
  seed("sessao-gm-1");
  publishMesaGmSkill("Militante", "Percepção", "INT 5 + Percepção 3 + 1d10", 13, [6]);
  const body = calls[0].body as { roll: { type: string; total: number } };
  assert.equal(body.roll.type, "skill_check");
  assert.equal(body.roll.total, 13);
});

test("evasão do inimigo vai como evasion e leva a chave (paga 1 Action)", () => {
  seed("sessao-gm-1");
  publishMesaGmEvasion("Militante", "Evasão", "REF 7 + Evasion 5 + 1d10", 17, [8], "part-9");
  const body = calls[0].body as {
    roll: { type: string; label: string; expression: string; total: number; rolls: number[] };
    key?: string;
  };
  assert.equal(body.roll.type, "evasion");
  assert.equal(body.roll.label, "Evasão");
  assert.equal(body.roll.expression, "REF 7 + Evasion 5 + 1d10");
  assert.equal(body.roll.total, 17);
  assert.deepEqual(body.roll.rolls, [8]);
  assert.equal(body.key, "part-9");
});

test("dano do GM vai como damage (custo zero)", () => {
  seed("sessao-gm-1");
  publishMesaGmDamage("Militante", "Dano de Fuzil", "2d6+1d6", 9, [4, 5, 6]);
  const body = calls[0].body as { roll: { type: string; label: string; total: number } };
  assert.equal(body.roll.type, "damage");
  assert.equal(body.roll.label, "Dano de Fuzil");
  assert.equal(body.roll.total, 9);
});

test("iniciativa do GM vai como free_roll", () => {
  seed("sessao-gm-1");
  publishMesaGmInitiative("Militante", 17);
  const body = calls[0].body as { roll: { type: string; label: string; total: number; rolls: number[] } };
  assert.equal(body.roll.type, "free_roll");
  assert.equal(body.roll.label, "Iniciativa");
  assert.equal(body.roll.total, 17);
  assert.deepEqual(body.roll.rolls, [17]);
});

test("rede fora do ar não estoura a tela do GM", async () => {
  seed("sessao-gm-1");
  failNext = true;
  publishMesaGmAttack("Militante", "Fuzil", "1d10", 14, [7]);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls.length, 1);
});

test("sair da mesa corta o espelho do GM", () => {
  seed("sessao-gm-1");
  removeMembership("GM1");
  publishMesaGmAttack("Militante", "Fuzil", "1d10", 14, [7]);
  assert.equal(calls.length, 0);
});
