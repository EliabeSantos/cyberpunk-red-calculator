import assert from "node:assert/strict";
import test from "node:test";

const values = new Map<string, string>();
(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  },
  dispatchEvent: () => true,
};
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: "Electron/37.0" } });

const {
  getConfiguredMesaServerUrl,
  isElectronRenderer,
  normalizeMesaServerUrl,
  setConfiguredMesaServerUrl,
} = await import("../src/lib/mesa/remoteServer.ts");

test("servidor remoto é uma configuração explícita e normalizada", () => {
  assert.equal(normalizeMesaServerUrl(" http://26.50.194.224:3001/ "), "http://26.50.194.224:3001");
  assert.equal(normalizeMesaServerUrl("https://mesa.example.test/app"), "https://mesa.example.test/app");
  assert.equal(normalizeMesaServerUrl("postgresql://127.0.0.1/db"), null);
  assert.equal(normalizeMesaServerUrl("https://user:pass@example.test"), null);
  assert.equal(isElectronRenderer(), true);
  assert.equal(setConfiguredMesaServerUrl("http://26.50.194.224:3001"), "http://26.50.194.224:3001");
  assert.equal(getConfiguredMesaServerUrl(), "http://26.50.194.224:3001");
  assert.equal(setConfiguredMesaServerUrl(""), null);
  assert.equal(getConfiguredMesaServerUrl(), null);
});

test("join pelo Electron usa o servidor configurado, sem consultar o Postgres local", async () => {
  setConfiguredMesaServerUrl("http://26.50.194.224:3001");
  const calls: string[] = [];
  globalThis.fetch = (async (input) => {
    calls.push(String(input));
    return Response.json({
      ok: true,
      session: { id: "0d6f2b3a-1c4d-4e5f-8a9b-0c1d2e3f4a5b", joinCode: "78GCJ", status: "active" },
      participant: { id: "participant", displayName: "Player", role: "player" },
    });
  }) as typeof fetch;

  const { joinMesa } = await import("../src/lib/mesa/client.ts");
  await joinMesa({ joinCode: "78GCJ", displayName: "Player" });
  assert.deepEqual(calls, ["http://26.50.194.224:3001/api/mesa/join"]);
});
