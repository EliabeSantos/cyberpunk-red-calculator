/**
 * Cliente HTTP da PARTIDA (navegador): lançamento do combate com encontro e
 * leitura do histórico.
 *
 * O que se prova aqui é o contrato que o servidor valida depois:
 *   • o encontro (id + nome) viaja no POST — é ele que o banco torna único;
 *   • `restart` é pedido explícito (nunca implícito);
 *   • o histórico volta como lista e a migração pendente chega como
 *     `migration_pending`, não como lista vazia.
 */
import assert from "node:assert/strict";
import test from "node:test";

// --- ambiente falso de navegador (precisa existir ANTES das chamadas) --------
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
let response: { status: number; payload: unknown } = { status: 200, payload: { ok: true } };

(globalThis as unknown as { fetch: unknown }).fetch = (url: string, options: Call["options"]) => {
  calls.push({ url, options });
  return Promise.resolve({
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    json: async () => response.payload,
  });
};

const { startCombat, fetchMesaBattles, MesaApiError } = await import("../src/lib/mesa/client.ts");

function reset(payload: unknown = { ok: true }, status = 200): void {
  calls.length = 0;
  response = { status, payload };
}

function body(index: number): Record<string, unknown> {
  return JSON.parse(calls[index].options.body ?? "{}") as Record<string, unknown>;
}

const ENEMIES = [{ name: "Militante", hp: 30, hpMax: 30, ref: 5, move: 6, key: "participante-1" }];

test("iniciar combate com encontro leva id e nome no body", async () => {
  reset();
  await startCombat("sessao-1", ENEMIES, { encounter: { id: "encontro-1", name: "Emboscada" } });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/mesa/sessao-1/combat");
  assert.equal(calls[0].options.method, "POST");
  assert.ok(calls[0].options.headers?.["x-mesa-token"], "o token do navegador acompanha a chamada");

  const sent = body(0);
  assert.deepEqual(sent.encounter, { id: "encontro-1", name: "Emboscada" });
  assert.equal(sent.restart, false, "recomeço nunca é implícito");
  assert.equal((sent.enemies as unknown[]).length, 1);
});

test("combate avulso (sem encontro) continua funcionando", async () => {
  reset();
  await startCombat("sessao-1", ENEMIES);

  const sent = body(0);
  assert.equal(sent.encounter, null, "servidor trata null como 'sem vínculo'");
  assert.equal(sent.restart, false);
});

test("pedido de reinício marca restart = true", async () => {
  reset();
  await startCombat("sessao-1", ENEMIES, {
    encounter: { id: "encontro-1", name: "Emboscada" },
    restart: true,
  });
  assert.equal(body(0).restart, true);
});

test("histórico volta como lista na ordem do servidor", async () => {
  reset({
    ok: true,
    battles: [
      { id: "partida-2", encounterId: "encontro-2", encounterName: "Rua 12", status: "completed" },
      { id: "partida-1", encounterId: "encontro-1", encounterName: "Emboscada", status: "active" },
    ],
  });

  const battles = await fetchMesaBattles("sessao-1");

  assert.equal(calls[0].url, "/api/mesa/sessao-1/battles");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(battles.length, 2);
  assert.equal(battles[0].id, "partida-2");
  assert.equal(battles[1].status, "active");
});

test("migração pendente sobe como migration_pending (nunca como lista vazia)", async () => {
  reset({ ok: false, error: "Rode a migração 20260927000001.", code: "migration_pending" }, 503);

  await assert.rejects(
    () => fetchMesaBattles("sessao-1"),
    (caught: unknown) =>
      caught instanceof MesaApiError && caught.code === "migration_pending" && caught.status === 503,
  );
});
