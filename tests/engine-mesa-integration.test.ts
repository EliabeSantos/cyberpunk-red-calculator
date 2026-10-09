import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";

type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {
  mesa_sessions: [],
  mesa_participants: [],
  mesa_combats: [],
  mesa_combatants: [],
};
let patchCount = 0;

function rowsMatching(table: string, params: URLSearchParams): Row[] {
  let rows = tables[table].slice();
  for (const [key, value] of params) {
    if (value.startsWith("eq.")) rows = rows.filter((row) => String(row[key]) === value.slice(3));
  }
  return rows;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(href);
  const table = decodeURIComponent(url.pathname.split("/").pop() ?? "");
  const method = (init?.method ?? "GET").toUpperCase();
  if (!(table in tables)) return json({ message: "table not found", code: "42P01" }, 404);

  if (method === "GET") return json(rowsMatching(table, url.searchParams));
  if (method !== "PATCH") return json({ message: "method not supported", code: "PGRST105" }, 405);

  patchCount += 1;
  const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Row) : {};
  const matched = rowsMatching(table, url.searchParams);
  for (const row of matched) Object.assign(row, body);

  const headers = new Headers(init?.headers);
  if (headers.get("prefer")?.includes("return=representation")) return json(matched);
  return new Response(null, { status: 204 });
}

process.env.SUPABASE_URL = "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-engine-test-0123456789";
const realFetch = globalThis.fetch;
globalThis.fetch = fakeFetch as typeof globalThis.fetch;

const { MesaError, resolveEnemyDamage, combatParticipantFromRow } = await import("../src/lib/mesa/store.ts");
const { engineDamagePatch } = await import("../src/lib/mesa/engineAdapter.ts");
const { engine } = await import("../src/lib/combat/engine.ts");

after(() => {
  globalThis.fetch = realFetch;
});

const SESSION_ID = "session-engine";
const COMBAT_ID = "combat-engine";
const COMBATANT_ID = "combatant-engine";
const TOKEN = "token-gm-0123456789abcdef";

function resetEnemy(hp = 20): void {
  for (const rows of Object.values(tables)) rows.length = 0;
  patchCount = 0;
  tables.mesa_sessions.push({
    id: SESSION_ID,
    name: "Mesa Engine",
    // A Mesa válida aponta gm_id para o id persistido do participante GM.
    // Identidades incompatíveis continuam cobertas pelos testes de autorização.
    gm_id: "gm-participant",
    status: "active",
    join_code: "ENGIN",
    created_at: "2026-10-04T00:00:00.000Z",
  });
  tables.mesa_participants.push({
    id: "gm-participant",
    session_id: SESSION_ID,
    display_name: "GM",
    character_id: null,
    player_token: TOKEN,
    role: "gm",
    connected_at: "2026-10-04T00:00:00.000Z",
    created_at: "2026-10-04T00:00:00.000Z",
  });
  tables.mesa_combats.push({
    id: COMBAT_ID,
    session_id: SESSION_ID,
    status: "active",
    round: 1,
    active_combatant_id: null,
    turn_started_at: null,
    initiative_started: false,
    event_log: [],
    created_at: "2026-10-04T00:00:00.000Z",
  });
  tables.mesa_combatants.push({
    id: COMBATANT_ID,
    combat_id: COMBAT_ID,
    session_id: SESSION_ID,
    kind: "enemy",
    character_id: null,
    participant_id: null,
    name: "Ganger",
    source_key: "enemy-1",
    initiative: null,
    initiative_detail: null,
    actions_max: 2,
    actions_remaining: 2,
    movement_max: 6,
    movement_remaining: 6,
    hp_current: hp,
    hp_max: 20,
    is_dead: false,
    conditions: [],
    sort_order: 0,
  });
}

function row(): Row {
  return tables.mesa_combatants[0];
}

function damage(hpBefore: number, amount: number) {
  return resolveEnemyDamage({
    sessionId: SESSION_ID,
    token: TOKEN,
    key: "enemy-1",
    amount,
    hpBefore,
    armor: { head: 0, body: 0 },
  });
}

beforeEach(() => resetEnemy());

test("1/2 — dano de inimigo: Engine calcula e Mesa recebe exatamente hp_after", async () => {
  const result = await damage(20, 6);

  assert.deepEqual(result, { updated: true, hp: 14, isDead: false });
  assert.equal(row().hp_current, 14);
  assert.equal(row().is_dead, false);
});

test("3 — inimigo a 0 HP persiste is_dead=true vindo de change.after", async () => {
  resetEnemy(5);
  const result = await damage(5, 20);

  assert.deepEqual(result, { updated: true, hp: 0, isDead: true });
  assert.equal(row().hp_current, 0);
  assert.equal(row().is_dead, true);
});

test("4 — inimigo sobrevivente mantém is_dead=false sem derivação no adapter", async () => {
  resetEnemy(5);
  const result = await damage(5, 2);

  assert.equal(result.hp, 3);
  assert.equal(result.isDead, false);
  assert.equal(row().is_dead, false);
});

test("5 — recusa do Engine não persiste nada", async () => {
  await assert.rejects(
    damage(20, 0),
    (error: unknown) => error instanceof MesaError && error.status === 400 && error.code === "invalid_action",
  );
  assert.equal(patchCount, 0);
  assert.equal(row().hp_current, 20);
  assert.equal(row().is_dead, false);
});

test("6/7 — adapter lê change.after e faz um patch único, sem recalcular isDead", () => {
  const resolved = engine.execute(
    {
      id: "combat",
      status: "active",
      round: 1,
      initiativeStarted: false,
      activeParticipantId: null,
      participants: [
        {
          id: "target",
          type: "enemy",
          name: "Target",
          source: { characterId: null, sourceKey: "target", enemyId: null },
          combat: {
            hp: { current: 10, max: 10 },
            armor: { head: 0, body: 0 },
            criticalInjuries: [],
            conditions: [],
            initiative: null,
            isDead: false,
          },
        },
      ],
    },
    { type: "damage", actorId: null, targetId: "target", amount: 3 },
  );
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;

  const changedAfter = {
    ...resolved,
    damageResult: resolved.damageResult ? { ...resolved.damageResult, hpAfter: 99 } : undefined,
    changes: resolved.changes.map((change) =>
      change.type === "hp_changed" ? { ...change, after: 7 } : change,
    ),
  };
  assert.deepEqual(engineDamagePatch(changedAfter, "target"), { hp_current: 7 });

  const withoutDeathChange = {
    ...resolved,
    changes: resolved.changes.filter((change) => change.type !== "is_dead_changed"),
  };
  assert.deepEqual(engineDamagePatch(withoutDeathChange, "target"), { hp_current: 7 });
});

test("8 — mesma resolução reenviada não duplica o dano", async () => {
  await damage(20, 6);
  await assert.rejects(
    damage(20, 6),
    (error: unknown) => error instanceof MesaError && error.status === 409 && error.code === "stale_hp",
  );
  assert.equal(row().hp_current, 14);
  assert.equal(patchCount, 1);
});

test("8b — estado mutável de armor e Critical Injury sobrevive ao adapter e à reconstrução", () => {
  const resolved = engine.execute(
    {
      id: "combat",
      status: "active",
      round: 1,
      initiativeStarted: false,
      activeParticipantId: null,
      participants: [
        {
          id: "target",
          type: "enemy",
          name: "Target",
          source: { characterId: null, sourceKey: "target", enemyId: null },
          combat: {
            hp: { current: 10, max: 10 },
            armor: { head: 0, body: 5 },
            criticalInjuries: [],
            conditions: [],
            initiative: null,
            isDead: false,
          },
          stats: { DEX: 5 },
          skills: { evasion: { stat: "DEX", level: 1 } },
          economy: { actionsMax: 2, actionsRemaining: 2, movementMax: 6, movementRemaining: 6 },
        },
      ],
    },
    { type: "damage", actorId: null, targetId: "target", amount: 10, hitLocation: "body" },
    { roll: () => ({ expression: "1", rolls: [1], total: 1 }), d10: () => 1 },
  );
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;

  const injury = {
    roll: 2,
    name: "Test Injury",
    effect: "test",
    quickFix: "test",
    treatment: "test",
    bonusDamage: 5,
    location: "body" as const,
    modifiers: [],
  };
  const mutable = {
    ...resolved,
    state: {
      ...resolved.state,
      participants: resolved.state.participants.map((participant) =>
        participant.id === "target"
          ? { ...participant, combat: { ...participant.combat, criticalInjuries: [injury] } }
          : participant,
      ),
    },
    changes: [
      ...resolved.changes,
      { type: "armor_changed" as const, participantId: "target", location: "body" as const, before: 5, after: 4 },
      { type: "critical_injury_added" as const, participantId: "target", injury },
    ],
  };
  const patch = engineDamagePatch(mutable, "target");
  assert.deepEqual(patch.combat_armor, { head: 0, body: 4 });
  assert.deepEqual(patch.critical_injuries, [injury]);

  const reconstructed = combatParticipantFromRow({
    id: "target",
    combat_id: "combat",
    session_id: "session",
    kind: "enemy",
    character_id: null,
    participant_id: null,
    name: "Target",
    combat_snapshot: mutable.state.participants[0],
    combat_armor: { head: 0, body: 4 },
    critical_injuries: [injury],
    combat_ammo: null,
    initiative: null,
    initiative_detail: null,
    actions_max: 2,
    actions_remaining: 2,
    movement_max: 6,
    movement_remaining: 6,
    hp_current: 10,
    hp_max: 10,
    is_dead: false,
    conditions: [],
    sort_order: 0,
  });
  assert.deepEqual(reconstructed?.combat.armor, { head: 0, body: 4 });
  assert.deepEqual(reconstructed?.combat.criticalInjuries, [injury]);
});

test("9 — duas resoluções simultâneas perdem por CAS, nunca silenciosamente", async () => {
  const results = await Promise.allSettled([damage(20, 6), damage(20, 4)]);
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(row().hp_current === 14 || row().hp_current === 16, true);
  // A perdedora chega ao UPDATE, mas o WHERE condicional não casa: há duas
  // tentativas físicas e somente uma alteração efetiva.
  assert.equal(patchCount, 2);
  const error = rejected[0].status === "rejected" ? rejected[0].reason : null;
  assert.ok(error instanceof MesaError);
  assert.equal(error.code, "hp_conflict");
});

test("espelho externo com hpBefore obsoleto não sobrescreve o resultado do Engine", async () => {
  await damage(20, 6);
  const { syncCombatHp } = await import("../src/lib/mesa/store.ts");
  const result = await syncCombatHp({
    sessionId: SESSION_ID,
    token: TOKEN,
    key: "enemy-1",
    hp: 17,
    hpBefore: 20,
  });

  assert.deepEqual(result, { updated: false });
  assert.equal(row().hp_current, 14);
  assert.equal(row().is_dead, false);
});
