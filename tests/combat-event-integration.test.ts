/**
 * F1.6 — `CombatResult.events` → `store.appendEvent` (adapter de integração).
 *
 * O fluxo do objetivo, no ponto em que ele existe HOJE:
 *
 *     engine.execute(state, action, rng) → CombatResult
 *                ↓
 *     persistCombatResult(combatId, result)   src/lib/mesa/combatEvents.ts
 *                ↓
 *     store.appendEvent → mesa_combats.event_log
 *
 * As oito coberturas obrigatórias da tarefa:
 *
 *   1. conversão de CADA tipo de evento suportado (os 9 kinds do `MesaEvent`);
 *   2. preservação dos dados relevantes (kind/texto verbatim, `at` só do
 *      store);
 *   3. `events: []` não produz eventos inventados — nem quando `changes` tem
 *      conteúdo (mudança de estado ≠ evento);
 *   4. o engine continua sem dependência do store/adapter;
 *   5. a integração não modifica o `CombatResult` recebido;
 *   6. falha de persistência é PROPAGADA (e o parcial fica documentado);
 *   7. o adapter não duplica o que grava; a REPETIÇÃO da chamada é coberta
 *      como a limitação conhecida (sem idempotência);
 *   8. regressão de `appendEvent` (mesma assinatura, mesmo comportamento F0.1).
 *
 * As coberturas de banco rodam contra o mesmo PostgREST falso em memória de
 * `mesa-event-log.test.ts` — o caminho real do client Supabase. LIMITAÇÃO: não
 * há Postgres real, RLS, Realtime nem transação aqui; a concorrência entre
 * gravações simultâneas não é exercitada (a janela de corrida do
 * read-modify-write é pendência documentada do F0.1).
 */
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { engine } from "../src/lib/combat/engine.ts";
import { DatabaseQueryError } from "../src/lib/supabaseAdmin.ts";
import type { CombatEvent, CombatResult, CombatState } from "../src/lib/combat/contract.ts";
import type { MesaEvent } from "../src/lib/mesa/types.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/* -------------------------------------------------------------------------- *
 * PostgREST falso (in-memory) — o mesmo desenho do F0.1, reduzido ao que o
 * `appendEvent` usa: GET (SELECT) e PATCH (UPDATE) em `mesa_combats`.
 * -------------------------------------------------------------------------- */

type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {
  mesa_combats: [],
};

/** Contador total de idas ao banco — prova de que lista vazia não consulta. */
let fetchCount = 0;
/** Quantos PATCH já passaram (para injetar falha em ponto exato). */
let patchCount = 0;
/** Quando não nulo, PATCH a partir desta ordem devolve erro de banco. */
let failPatchFrom: number | null = null;

function rowsMatching(table: string, params: URLSearchParams): Row[] {
  let out = tables[table].slice();
  for (const [key, value] of params) {
    if (!value.startsWith("eq.")) continue;
    const expected = value.slice(3);
    out = out.filter((row) => String(row[key]) === expected);
  }
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
  fetchCount += 1;
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(href);
  const table = decodeURIComponent(url.pathname.split("/").pop() ?? "");
  const method = (init?.method ?? "GET").toUpperCase();

  if (!(table in tables)) {
    return errorResponse(404, "42P01", `relation "${table}" does not exist`);
  }

  if (method === "GET") return jsonResponse(rowsMatching(table, url.searchParams));

  if (method === "PATCH") {
    patchCount += 1;
    if (failPatchFrom !== null && patchCount >= failPatchFrom) {
      return errorResponse(500, "XX000", "falha de escrita proposital");
    }
    const body: unknown = typeof init?.body === "string" && init.body.length > 0 ? JSON.parse(init.body) : null;
    const matched = rowsMatching(table, url.searchParams);
    for (const row of matched) Object.assign(row, (body ?? {}) as Row);
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
const { persistCombatResult, toPersistedEvents } = await import("../src/lib/mesa/combatEvents.ts");

/* -------------------------------------------------------------------------- *
 * Fixtures
 * -------------------------------------------------------------------------- */

const COMBAT_ID = "comb-f16";

/** Os 9 kinds que o formato persistido comporta (`src/lib/mesa/types.ts`). */
const KINDS: ReadonlyArray<MesaEvent["kind"]> = [
  "combat_started",
  "combat_finished",
  "initiative",
  "action",
  "turn",
  "round",
  "enemy",
  "join",
  "roll",
];

const eventA: MesaEvent = { at: "2026-10-01T10:00:00.000Z", kind: "action", text: "eventA" };
const eventB: MesaEvent = { at: "2026-10-01T10:00:01.000Z", kind: "roll", text: "eventB" };

/** Combate ativo com DOIS eventos já históricos; zera os contadores. */
function seed(): void {
  tables.mesa_combats = [
    {
      id: COMBAT_ID,
      session_id: "sess-f16",
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
  fetchCount = 0;
  patchCount = 0;
  failPatchFrom = null;
}

/** O log GRAVADO no banco falso (estado persistido, não objeto em memória). */
function persistedLog(): MesaEvent[] {
  const row = tables.mesa_combats.find((combat) => combat.id === COMBAT_ID);
  assert.ok(row, "a linha de combate deve existir no banco falso");
  const log = row.event_log;
  assert.ok(Array.isArray(log), "event_log persistido deve ser uma lista");
  return log as MesaEvent[];
}

const PC_ID = "f16-pc";
const INIMIGO_ID = "f16-inimigo";

/** Estado mínimo real (mesmos campos obrigatórios do F1.5). */
function estado(): CombatState {
  return {
    id: "f16-combat",
    status: "active",
    round: 1,
    initiativeStarted: true,
    activeParticipantId: PC_ID,
    participants: [
      {
        id: PC_ID,
        type: "character",
        name: "V",
        source: { characterId: "f16-char", sourceKey: null, enemyId: null },
        combat: {
          hp: { current: 30, max: 40 },
          armor: { head: 0, body: 11 },
          criticalInjuries: [],
          conditions: [],
          deathSave: { dc: 10, failures: 0 },
          initiative: 15,
          isDead: false,
        },
      },
      {
        id: INIMIGO_ID,
        type: "enemy",
        name: "Scrappy",
        source: { characterId: null, sourceKey: INIMIGO_ID, enemyId: "scrapper" },
        combat: {
          hp: { current: 40, max: 40 },
          armor: { head: 0, body: 11 },
          criticalInjuries: [],
          conditions: [],
          initiative: 10,
          isDead: false,
        },
      },
    ],
  };
}

/** `CombatResult` de teste com os eventos dados (estado real por trás). */
function resultado(events: CombatEvent[]): CombatResult {
  return { ok: true, state: estado(), changes: [], rolls: [], events };
}

/* -------------------------------------------------------------------------- *
 * 1 e 2 — conversão de cada tipo + preservação dos dados
 * -------------------------------------------------------------------------- */

test("conversão: cada kind suportado sai idêntico, sem carimbo de tempo", () => {
  for (const kind of KINDS) {
    const original: CombatEvent = { kind, text: `evento ${kind}` };
    const [convertido] = toPersistedEvents([original]);

    assert.ok(convertido, `kind ${kind} convertido`);
    assert.deepEqual(convertido, { kind, text: `evento ${kind}` }, `kind ${kind} preservado`);
    assert.equal("at" in convertido, false, "o `at` é do store, nunca do resultado");
    assert.notEqual(convertido, original, "a conversão devolve um objeto NOVO");
  }

  // Timestamp vindo de um resultado montado à mão não pode passar adiante:
  // quem carimba é `appendEvent`, sempre.
  const comAt = { kind: "roll", text: "x", at: "1999-01-01T00:00:00.000Z" } as unknown as CombatEvent;
  const [semAt] = toPersistedEvents([comAt]);
  assert.ok(semAt);
  assert.equal("at" in semAt, false, "estranho `at` é descartado na conversão");
});

test("integração: os eventos persistem em ordem, com `at` carimbado pelo store", async () => {
  seed();
  const eventos: CombatEvent[] = KINDS.map((kind, index) => ({ kind, text: `#${index} ${kind}` }));

  await persistCombatResult(COMBAT_ID, resultado(eventos));

  const log = persistedLog();
  assert.equal(log.length, 2 + KINDS.length, "os 2 do histórico + 1 por evento do resultado");
  assert.deepEqual(log.slice(0, 2), [eventA, eventB], "o histórico anterior fica intacto");

  const novos = log.slice(2);
  assert.deepEqual(
    novos.map((evento) => evento.kind),
    KINDS,
    "na MESMA ordem do CombatResult",
  );
  assert.deepEqual(
    novos.map((evento) => evento.text),
    eventos.map((evento) => evento.text),
    "texto preservado verbatim",
  );
  for (const evento of novos) {
    assert.equal(typeof evento.at, "string", "todo evento persistido tem `at`");
    assert.equal(Number.isNaN(Date.parse(evento.at)), false, "`at` é ISO válido — e veio do store");
  }
});

/* -------------------------------------------------------------------------- *
 * 3 — `events: []` não produz eventos inventados
 * -------------------------------------------------------------------------- */

test("events: [] não produz eventos inventados — nem a partir dos `changes`", async () => {
  seed();
  const antes = structuredClone(persistedLog());

  // Fluxo REAL do diagrama: motor roda dano de verdade…
  const sucesso = engine.execute(estado(), {
    type: "damage",
    actorId: PC_ID,
    targetId: INIMIGO_ID,
    amount: 20,
  });
  assert.equal(sucesso.ok, true);
  assert.ok(sucesso.changes.length > 0, "o dano produz changes de verdade (hp + armadura)");
  assert.deepEqual(sucesso.events, [], "…mas NENHUM evento: changes ≠ eventos");

  await persistCombatResult(COMBAT_ID, sucesso);
  assert.equal(fetchCount, 0, "lista vazia = nem uma ida ao banco");
  assert.deepEqual(persistedLog(), antes, "o log fica byte a byte igual");

  // Resultado de FALHA do motor também não tem eventos a persistir.
  const falha = engine.execute(estado(), {
    type: "damage",
    actorId: PC_ID,
    targetId: INIMIGO_ID,
    amount: 0,
  });
  assert.equal(falha.ok, false);
  assert.deepEqual(falha.events, [], "resultado falho também vem sem eventos");

  await persistCombatResult(COMBAT_ID, falha);
  assert.equal(fetchCount, 0, "falha do motor não vira consulta nenhuma");
  assert.deepEqual(persistedLog(), antes);
});

/* -------------------------------------------------------------------------- *
 * 4 — o engine continua sem dependência do store/adapter
 * -------------------------------------------------------------------------- */

test("o engine não conhece o store nem o adapter (continua puro)", () => {
  const engineFile = resolve(ROOT, "src", "lib", "combat", "engine.ts");
  const fonte = readFileSync(engineFile, "utf8");

  assert.equal(fonte.includes('from "@/lib/mesa/store'), false, "engine.ts não importa o store");
  assert.equal(fonte.includes("combatEvents"), false, "engine.ts não conhece o adapter");
  assert.equal(fonte.includes("@supabase"), false, "engine.ts não conhece o Supabase");

  // O adapter mora FORA do núcleo de combate — a direção é uma só:
  // adapters → combate; nunca combate → persistência.
  assert.equal(
    existsSync(resolve(ROOT, "src", "lib", "combat", "combatEvents.ts")),
    false,
    "o adapter fica fora de src/lib/combat/",
  );

  // A rede de pureza completa (grafo de runtime + AST) segue em
  // `tests/combat-purity.test.ts`, que já cobre `engine.ts` desde o F1.5.
});

/* -------------------------------------------------------------------------- *
 * 5 — a integração não modifica o CombatResult
 * -------------------------------------------------------------------------- */

test("a integração não modifica o CombatResult recebido", async () => {
  seed();
  const result = resultado([{ kind: "roll", text: "V: Lesão Crítica 9 (2d6)" }]);
  const snapshot = structuredClone(result);

  await persistCombatResult(COMBAT_ID, result);

  assert.deepEqual(result, snapshot, "o resultado fica byte a byte igual ao snapshot");
  assert.equal("at" in result.events[0], false, "o store não escreve `at` de volta no resultado");
  assert.deepEqual(result.state, snapshot.state, "o estado também não é tocado");
});

/* -------------------------------------------------------------------------- *
 * 6 — falha de persistência é propagada (sem transação: parcial documentado)
 * -------------------------------------------------------------------------- */

test("falha de persistência é propagada; o que já gravou fica gravado (sem transação)", async () => {
  seed();
  failPatchFrom = 2; // o 1º evento grava; o 2º cai na falha injetada
  const result = resultado([
    { kind: "action", text: "primeiro" },
    { kind: "roll", text: "segundo" },
  ]);

  await assert.rejects(
    () => persistCombatResult(COMBAT_ID, result),
    DatabaseQueryError,
    "o erro do store propaga — nunca vira sucesso silencioso",
  );

  const log = persistedLog();
  assert.equal(log.length, 3, "2 do histórico + o primeiro evento");
  assert.equal(log[2].text, "primeiro", "o evento que já gravou permanece");
  assert.equal(
    log.some((evento) => evento.text === "segundo"),
    false,
    "o que falhou NÃO foi gravado — e não há rollback (limitação documentada)",
  );
});

/* -------------------------------------------------------------------------- *
 * 7 — sem duplicação por chamada; repetição da chamada é a limitação
 * -------------------------------------------------------------------------- */

test("o adapter grava cada evento UMA vez por chamada (repetição = limitação conhecida)", async () => {
  seed();
  const result = resultado([{ kind: "roll", text: "rolagem única" }]);

  await persistCombatResult(COMBAT_ID, result);
  let log = persistedLog();
  assert.equal(
    log.filter((evento) => evento.text === "rolagem única").length,
    1,
    "uma chamada = um registro, sem duplicação silenciosa",
  );

  // LIMITAÇÃO documentada (não é bug): o adapter não tem token de
  // deduplicação e `appendEvent` não deduplica — repetir a chamada repete o
  // evento. O contrato do F1.6 manda registrar, não prometer idempotência.
  await persistCombatResult(COMBAT_ID, result);
  log = persistedLog();
  assert.equal(
    log.filter((evento) => evento.text === "rolagem única").length,
    2,
    "chamada repetida DUPLICA — sem idempotência por design",
  );
});

/* -------------------------------------------------------------------------- *
 * 8 — regressão de `appendEvent`
 * -------------------------------------------------------------------------- */

test("regressão: appendEvent mantém a assinatura e o comportamento F0.1", async () => {
  seed();

  await store.appendEvent(COMBAT_ID, { kind: "enemy", text: "1 inimigo(s) adicionado(s)" });

  const log = persistedLog();
  assert.equal(log.length, 3, "dois históricos + o novo");
  assert.deepEqual(log.slice(0, 2), [eventA, eventB], "histórico preservado (append-only)");
  assert.equal(log[2].kind, "enemy");
  assert.equal(log[2].text, "1 inimigo(s) adicionado(s)");
  assert.equal(typeof log[2].at, "string", "o store segue carimbando o `at`");
});
