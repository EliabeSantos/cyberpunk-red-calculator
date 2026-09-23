import assert from "node:assert/strict";
import { after, test } from "node:test";

import { getDiscordConsent, setDiscordConsent } from "../src/lib/discord/consent.ts";
import { notifyDiscordRoll } from "../src/lib/discord/rollNotify.ts";
import { setSessionCode } from "../src/lib/discord/session.ts";
import { createEmptyCharacter, type RollHistoryEntry } from "../src/types/character.ts";

type FakeStorage = { data: Map<string, string> };

const originalWindow = (globalThis as { window?: unknown }).window;
const originalFetch = globalThis.fetch;

function installFakeWindow(): FakeStorage {
  const data = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
    },
  };
  return { data };
}

function installFetchSpy() {
  const calls: string[] = [];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    calls.push(String(init?.body ?? ""));
    return Response.json({ ok: true });
  }) as typeof fetch;
  return calls;
}

function attackEntry(): RollHistoryEntry {
  return {
    id: "roll-consent",
    type: "attack",
    label: "Ataque com Pistola",
    characterId: "char",
    expression: "1d10",
    rolls: [7],
    total: 21,
    timestamp: new Date().toISOString(),
  };
}

after(() => {
  (globalThis as { window?: unknown }).window = originalWindow;
  globalThis.fetch = originalFetch;
});

test("primeira visita: consentimento é null (pedido ainda não respondido)", () => {
  installFakeWindow();
  assert.equal(getDiscordConsent(), null);
});

test("escolha do usuário é persistida e relida", () => {
  installFakeWindow();
  setDiscordConsent("granted");
  assert.equal(getDiscordConsent(), "granted");
  setDiscordConsent("denied");
  assert.equal(getDiscordConsent(), "denied");
});

test("sem consentimento NENHUMA informação é enviada", () => {
  installFakeWindow();
  const calls = installFetchSpy();
  notifyDiscordRoll(attackEntry(), createEmptyCharacter("char"));
  assert.equal(calls.length, 0, "nada deve ser enviado antes da resposta");
});

test("com consentimento NEGADO NENHUMA informação é enviada", () => {
  installFakeWindow();
  setDiscordConsent("denied");
  const calls = installFetchSpy();
  notifyDiscordRoll(attackEntry(), createEmptyCharacter("char"));
  assert.equal(calls.length, 0, "nada deve ser enviado quando o usuário recusa");
});

test("sem código de mesa NENHUMA informação é enviada", () => {
  installFakeWindow();
  setDiscordConsent("granted");
  const calls = installFetchSpy();
  notifyDiscordRoll(attackEntry(), createEmptyCharacter("char"));
  assert.equal(calls.length, 0, "sem mesa não há servidor de destino — não envia");
});

test("com consentimento CONCEDIDO o payload é enviado com o resultado do site", async () => {
  installFakeWindow();
  setDiscordConsent("granted");
  assert.equal(setSessionCode("mesa-teste"), true, "código da mesa deve ser válido");
  const calls = installFetchSpy();

  const character = createEmptyCharacter("char");
  character.identity = { name: "Zuberi Akil", player: "Eliabe", role: "Solo", level: 1 };
  notifyDiscordRoll(attackEntry(), character);

  assert.equal(calls.length, 1, "deve enviar exatamente uma requisição");
  const payload = JSON.parse(calls[0]);
  assert.equal(payload.sessionCode, "mesa-teste", "a rolagem leva o código da mesa");
  assert.equal(payload.playerName, "Eliabe");
  assert.equal(payload.rollType, "Ataque com Pistola");
  assert.deepEqual(payload.rolls, [7]);
  assert.equal(payload.modifier, 14);
  assert.equal(payload.total, 21);

  // Aguarda a promise do fetch fire-and-forget terminar sem erro não tratado.
  await new Promise((resolve) => setTimeout(resolve, 0));
});
