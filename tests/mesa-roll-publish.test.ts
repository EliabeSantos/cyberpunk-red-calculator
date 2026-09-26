/**
 * Espelho de rolagens da ficha para a MESA (o trecho que roda no navegador).
 *
 * O módulo é importado de verdade; o que se stuba é o ambiente do navegador
 * (localStorage/dispatchEvent) e o `fetch`, para o teste provar as três
 * promessas da feature: sem mesa ativa não manda nada, com mesa manda o POST
 * certo, e falha de rede nunca estoura para cima da ficha.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { getActiveMembership, rememberMembership, removeMembership } from "../src/lib/mesa/membershipStore.ts";
import { publishMesaRoll } from "../src/lib/mesa/rollPublish.ts";
import type { RollHistoryEntry } from "../src/types/character.ts";

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
let respond: () => Promise<unknown> = () =>
  Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, registered: true, debited: true }) });

(globalThis as unknown as { fetch: unknown }).fetch = (url: string, options: Call["options"]) => {
  calls.push({ url, options });
  return respond();
};

function entry(overrides: Partial<RollHistoryEntry> = {}): RollHistoryEntry {
  return {
    id: `roll-${Math.random().toString(36).slice(2)}`,
    type: "attack",
    label: "Ataque Pistola",
    characterId: "char-1",
    expression: "REF 6 + 1d10 [7]",
    rolls: [7],
    total: 17,
    timestamp: new Date().toISOString(),
    ...overrides,
  } as RollHistoryEntry;
}

function reset(active: boolean) {
  calls.length = 0;
  storage.clear();
  respond = () =>
    Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, registered: true, debited: true }) });
  if (active) {
    rememberMembership("ABCDE", {
      sessionId: "sessao-1",
      participantId: "part-1",
      displayName: "Jogadora",
      role: "player",
    });
  }
}

test("sem mesa ativa, a rolagem da ficha não sai do navegador", () => {
  reset(false);
  publishMesaRoll(entry());
  assert.equal(getActiveMembership(), null);
  assert.equal(calls.length, 0);
});

test("com mesa ativa, manda um POST para /combat/roll com o resumo do dado", () => {
  reset(true);
  publishMesaRoll(entry({ type: "attack", label: "Ataque Pistola", total: 17 }));

  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.url, "/api/mesa/sessao-1/combat/roll");
  assert.equal(call.options.method, "POST");
  assert.ok(call.options.headers?.["x-mesa-token"], "o token do navegador acompanha a chamada");

  const body = JSON.parse(call.options.body ?? "{}") as { roll: { type: string; total: number; rolls: number[] } };
  assert.equal(body.roll.type, "attack");
  assert.equal(body.roll.total, 17);
  assert.deepEqual(body.roll.rolls, [7]);
});

test("rolagem que não tem significado na mesa nem é enviada", () => {
  reset(true);
  publishMesaRoll(entry({ type: "humanity_loss" }));
  assert.equal(calls.length, 0);
});

test("sair da mesa corta o espelho na hora", () => {
  reset(true);
  removeMembership("ABCDE");
  publishMesaRoll(entry());
  assert.equal(calls.length, 0);
});

test("servidor fora do ar não estoura para cima da ficha", async () => {
  reset(true);
  respond = () => Promise.reject(new Error("fetch failed"));
  // Uma rejeição sem tratamento derruba o teste do Node — é exatamente o que
  // o `.catch` do publishMesaRoll evita.
  publishMesaRoll(entry());
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls.length, 1);
});
