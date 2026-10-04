/**
 * F0.1 — `event_log` é histórico APPEND-ONLY durante operações normais da Mesa.
 *
 * O bug coberto aqui: `addEnemies` passava `[]` para `appendEvent`, então o
 * UPDATE gravava `[eventA, eventB] → []` e destruía o histórico do combate.
 * A correção faz `appendEvent` reler o log do banco na hora de gravar, de modo
 * que nenhum chamador consegue substituir o histórico por uma lista vazia ou
 * antiga.
 *
 * As coberturas rodam contra um PostgREST falso em memória instalado em
 * `globalThis.fetch` — exatamente o caminho que o cliente Supabase usa (o
 * `global.fetch` do client é resolvido a cada chamada). O que é lido de volta
 * vem de um SELECT pelo caminho real de leitura (`getMesaState` → `toCombat`),
 * não do objeto em memória usado na escrita.
 *
 * LIMITAÇÃO: não há Postgres real, RLS, Realtime nem transação aqui; a
 * concorrência entre duas gravações simultâneas não é exercitada por este
 * arquivo. A atomicidade do append (RPC/transação) segue como pendência
 * documentada — esta tarefa só garante que a operação normal não apague log.
 */
import assert from "node:assert/strict";
import test, { after } from "node:test";

import type { MesaEvent } from "../src/lib/mesa/types.ts";

// ---------------------------------------------------------------------------
// PostgREST falso (in-memory) — precisa existir ANTES de o store ser usado
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {
  mesa_sessions: [],
  mesa_participants: [],
  mesa_combats: [],
  mesa_combatants: [],
};

let sequence = 0;
function nextId(table: string): string {
  sequence += 1;
  return `${table.slice("mesa_".length)}-gerado-${String(sequence).padStart(4, "0")}`;
}

/** Colunas que o Postgres preenche sozinho quando o INSERT não as traz. */
const INSERT_DEFAULTS: Record<string, Row> = {
  mesa_combatants: {
    character_id: null,
    participant_id: null,
    initiative: null,
    initiative_detail: null,
    conditions: [],
    is_dead: false,
    source_key: null,
    supplies: null,
  },
};

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

/** `?select=`, `?col=eq.v`, `?order=` e `?limit=` — só o que o store usa. */
function rowsMatching(table: string, params: URLSearchParams): Row[] {
  let out = tables[table].slice();
  for (const [key, value] of params) {
    if (!value.startsWith("eq.")) continue;
    const expected = value.slice(3);
    out = out.filter((row) => String(row[key]) === expected);
  }
  const order = params.get("order");
  if (order) {
    const [column = "", direction = "asc"] = order.split(".");
    out = out.sort((a, b) => compareValues(a[column], b[column]));
    if (direction === "desc") out.reverse();
  }
  const limit = params.get("limit");
  if (limit !== null) out = out.slice(0, Number(limit));
  return out;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ message, details: "", hint: "", code }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(href);
  const table = decodeURIComponent(url.pathname.split("/").pop() ?? "");
  const method = (init?.method ?? "GET").toUpperCase();

  if (!(table in tables)) {
    return errorResponse(404, "42P01", `relation "${table}" does not exist`);
  }

  if (method === "GET") return jsonResponse(rowsMatching(table, url.searchParams));

  const body: unknown = typeof init?.body === "string" && init.body.length > 0 ? JSON.parse(init.body) : null;

  if (method === "POST") {
    const entries = Array.isArray(body) ? body : [body];
    for (const entry of entries) {
      if (entry === null || typeof entry !== "object") continue;
      tables[table].push({ id: nextId(table), ...INSERT_DEFAULTS[table], ...(entry as Row) });
    }
    // `Prefer: return=minimal` → corpo vazio (201).
    return new Response("", { status: 201 });
  }

  const matched = rowsMatching(table, url.searchParams);

  if (method === "PATCH" || method === "PUT") {
    const patch = (body ?? {}) as Row;
    for (const row of matched) Object.assign(row, patch);
    return new Response(null, { status: 204 });
  }

  if (method === "DELETE") {
    tables[table] = tables[table].filter((row) => !matched.includes(row));
    return new Response(null, { status: 204 });
  }

  return errorResponse(405, "PGRST105", `método ${method} não previsto no falso PostgREST`);
}

// ---------------------------------------------------------------------------
// Env + stub (antes de importar o store: o client é criado sob demanda)
// ---------------------------------------------------------------------------

process.env.SUPABASE_URL = "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-teste-0123456789";

const realFetch = globalThis.fetch;
globalThis.fetch = fakeFetch as typeof globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});

const store = await import("../src/lib/mesa/store.ts");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SESSION_ID = "sess-0001";
const PARTICIPANT_ID = "part-0001";
const COMBAT_ID = "comb-0001";
const GM_TOKEN = "gm-token-de-teste-0123456789"; // requireToken: mínimo 16 chars

const eventA: MesaEvent = { at: "2026-10-01T10:00:00.000Z", kind: "action", text: "eventA" };
const eventB: MesaEvent = { at: "2026-10-01T10:00:01.000Z", kind: "roll", text: "eventB" };

const ADDED_1 = "1 inimigo(s) adicionado(s)";
const ADDED_2 = "2 inimigo(s) adicionado(s)";

/** Estado de partida: combate ativo com DOIS eventos já históricos. */
function seed(): void {
  sequence = 0;
  tables.mesa_sessions = [
    {
      id: SESSION_ID,
      name: "Mesa de teste",
      gm_id: PARTICIPANT_ID,
      status: "active",
      join_code: "ABCDE",
      created_at: "2026-10-01T09:00:00.000Z",
      updated_at: "2026-10-01T09:00:00.000Z",
    },
  ];
  tables.mesa_participants = [
    {
      id: PARTICIPANT_ID,
      session_id: SESSION_ID,
      player_token: GM_TOKEN,
      display_name: "Mestre",
      character_id: null,
      role: "gm",
      created_at: "2026-10-01T09:00:00.000Z",
      connected_at: "2026-10-01T09:00:00.000Z",
    },
  ];
  tables.mesa_combats = [
    {
      id: COMBAT_ID,
      session_id: SESSION_ID,
      status: "active",
      round: 1,
      active_combatant_id: null,
      turn_started_at: null,
      initiative_started: true,
      event_log: [structuredClone(eventA), structuredClone(eventB)],
      created_at: "2026-10-01T09:05:00.000Z",
      updated_at: "2026-10-01T09:05:00.000Z",
    },
  ];
  tables.mesa_combatants = [];
}

/** O log GRAVADO no banco falso (estado persistido, não o objeto em memória). */
function persistedLog(): MesaEvent[] {
  const row = tables.mesa_combats.find((combat) => combat.id === COMBAT_ID);
  assert.ok(row, "a linha de combate deve existir no banco falso");
  const log = row.event_log;
  assert.ok(Array.isArray(log), "event_log persistido deve ser uma lista");
  return log as MesaEvent[];
}

function enemy(name: string): { name: string; hp: number; hpMax: number; ref: number } {
  return { name, hp: 30, hpMax: 30, ref: 5 };
}

function addEnemies(names: string[]): Promise<void> {
  return store.addEnemies({
    sessionId: SESSION_ID,
    token: GM_TOKEN,
    enemies: names.map(enemy),
  });
}

function seedCombatant(): void {
  tables.mesa_combatants = [
    {
      id: "enem-0001",
      combat_id: COMBAT_ID,
      session_id: SESSION_ID,
      kind: "enemy",
      character_id: null,
      participant_id: null,
      name: "Militante",
      source_key: null,
      supplies: null,
      initiative: 12,
      initiative_detail: { refBonus: 5 },
      actions_max: 2,
      actions_remaining: 2,
      movement_max: 6,
      movement_remaining: 6,
      hp_current: 30,
      hp_max: 30,
      is_dead: false,
      conditions: [],
      sort_order: 0,
    },
  ];
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

test("Teste 1 — adicionar inimigo preserva o event_log existente", async () => {
  seed();

  await addEnemies(["Militante"]);

  const log = persistedLog();
  assert.notDeepEqual(log, [], "o histórico nunca pode virar []");
  assert.equal(log.length, 3, "dois eventos anteriores + um novo");
  assert.deepEqual(log.slice(0, 2), [eventA, eventB], "eventA e eventB seguem intactos");
  assert.equal(log[2].kind, "enemy");
  assert.equal(log[2].text, ADDED_1, "a operação registra um novo evento no FIM");
  assert.equal(log[2].at.length > 0, true, "o evento novo carrega timestamp");
});

test("Teste 2 — múltiplas adições preservam o histórico", async () => {
  seed();

  await addEnemies(["Militante"]);
  await addEnemies(["Segurança", "Tecnocrata"]);
  await addEnemies(["Médico de Campo"]);

  const log = persistedLog();
  assert.equal(log.length, 5, "2 anteriores + 1 evento por operação");
  assert.deepEqual(log.slice(0, 2), [eventA, eventB], "o histórico inicial continua presente");
  assert.deepEqual(
    log.slice(2).map((event) => event.text),
    [ADDED_1, ADDED_2, "1 inimigo(s) adicionado(s)"],
    "cada adição acrescenta UM evento, na ordem",
  );
});

test("Teste 3 — histórico cresce sem duplicação indevida", async () => {
  seed();

  await addEnemies(["Militante"]);

  let log = persistedLog();
  assert.equal(
    log.filter((event) => event.text === ADDED_1).length,
    1,
    "a primeira operação grava o evento uma única vez",
  );
  assert.equal(log.filter((event) => event.text === "eventA").length, 1, "eventA não duplica");
  assert.equal(log.filter((event) => event.text === "eventB").length, 1, "eventB não duplica");

  await addEnemies(["Segurança", "Tecnocrata"]);

  log = persistedLog();
  assert.equal(log.filter((event) => event.kind === "enemy").length, 2, "dois eventos de adição ao todo");
  assert.equal(log.filter((event) => event.text === "eventA").length, 1, "eventA segue duplicado zero vezes");
  assert.equal(log.filter((event) => event.text === ADDED_2).length, 1, "a segunda operação também é única");
});

test("Teste 4 — operação sem evento não altera o histórico", async () => {
  seed();
  seedCombatant();

  const before = structuredClone(persistedLog());

  await store.updateCombatant({
    sessionId: SESSION_ID,
    token: GM_TOKEN,
    combatantId: "enem-0001",
    patch: { hpCurrent: 12 },
  });

  const combatant = tables.mesa_combatants.find((row) => row.id === "enem-0001");
  assert.ok(combatant, "o combatente deve continuar no banco");
  assert.equal(combatant.hp_current, 12, "a operação de fato executou a atualização");
  assert.deepEqual(persistedLog(), before, "o event_log permanece exatamente igual");
});

test("Teste 5 — persistência: o histórico recuperado do banco é o correto", async () => {
  seed();

  await addEnemies(["Militante", "Segurança"]);

  const state = await store.getMesaState(SESSION_ID, PARTICIPANT_ID);

  assert.ok(state.combat, "a leitura devolve combate");
  assert.equal(state.combat.eventLog.length, 3, "a leitura devolve os 2 anteriores + o novo");
  assert.deepEqual(state.combat.eventLog.slice(0, 2), [eventA, eventB], "histórico preservado na leitura");
  assert.deepEqual(state.combat.eventLog, persistedLog(), "a leitura bate com o que está GRAVADO");
  assert.equal(state.combatants.length, 2, "os dois inimigos entraram");
  assert.equal(state.combatants[0].name, "Militante");
});
