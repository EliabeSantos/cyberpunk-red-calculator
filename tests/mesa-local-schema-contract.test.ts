/**
 * Contrato de paridade do schema usado pelo modo PostgreSQL local.
 *
 * Este teste consulta os catálogos reais do PostgreSQL. Não usa mocks e nunca
 * executa migrations: o banco descartável deve ser preparado previamente por
 * scripts/migrate-local.mjs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";

const localUrl = process.env.MESA_LOCAL_TEST_DATABASE_URL;

function databaseName(url: string): string | null {
  const withoutQuery = url.split(/[?#]/, 1)[0];
  const socket = withoutQuery.match(/^(?:postgres|postgresql):\/\/(?:[^/@]*@)?\/([^/]+)$/);
  const remote = withoutQuery.match(/^(?:postgres|postgresql):\/\/(?:[^/@]*@)?[^/]+\/([^/]+)$/);
  const name = socket?.[1] ?? remote?.[1] ?? null;
  return name && /(contract|test|tmp|disposable)/i.test(name) ? name : null;
}

function poolConfig(url: string): { host?: string; database?: string; connectionString?: string } {
  const socket = url.match(/^(?:postgres|postgresql):\/\/(?:[^/@]*@)?\/([^?#]+)/);
  return socket
    ? { host: process.env.MESA_LOCAL_PG_SOCKET_DIR || "/var/run/postgresql", database: socket[1] }
    : { connectionString: url };
}

function isLocalUrl(url: string): boolean {
  return /^(?:postgres|postgresql):\/\/(?:[^/@]*@)?(?:localhost|127\.0\.0\.1|\[::1\])\//.test(url)
    || /^(?:postgres|postgresql):\/\/(?:[^/@]*@)?\//.test(url);
}

const tables = {
  mesa_sessions: [
    "id", "name", "gm_id", "status", "join_code", "created_at", "updated_at",
    "tactical_map", "net_architectures",
  ],
  mesa_participants: [
    "id", "session_id", "player_token", "display_name", "character_id", "role",
    "created_at", "connected_at",
  ],
  mesa_characters: ["id", "owner_token", "display_name", "sheet", "updated_at"],
  mesa_combats: [
    "id", "session_id", "status", "round", "active_combatant_id", "turn_started_at",
    "initiative_started", "event_log", "created_at", "updated_at",
  ],
  mesa_combatants: [
    "id", "combat_id", "session_id", "kind", "character_id", "participant_id", "name",
    "initiative", "initiative_detail", "actions_max", "actions_remaining", "movement_max",
    "movement_remaining", "hp_current", "hp_max", "is_dead", "conditions", "sort_order",
    "created_at", "source_key", "supplies", "combat_snapshot", "combat_ammo", "combat_armor",
    "critical_injuries", "death_save_dc", "death_save_failures", "position",
    "avatar_url", "stealth_state", "detected_by", "netrunner_state", "net_effects",
    "net_discovery", "net_ice_state", "brain_damage",
  ],
  mesa_battles: [
    "id", "session_id", "join_code", "encounter_id", "encounter_name", "status", "started_at",
    "ended_at", "final_round", "combatants", "event_log",
  ],
  mesa_attack_resolutions: [
    "id", "session_id", "combat_id", "resolution_id", "claim_token", "status", "result",
    "created_at", "updated_at", "committed_at",
  ],
  mesa_reload_resolutions: [
    "id", "session_id", "combat_id", "resolution_id", "claim_token", "status", "result",
    "created_at", "updated_at", "committed_at",
  ],
  mesa_item_consume_resolutions: [
    "id", "session_id", "combat_id", "resolution_id", "claim_token", "status", "result",
    "created_at", "updated_at", "committed_at",
  ],
} as const;

const indexes = [
  "mesa_participants_session_idx",
  "mesa_characters_owner_idx",
  "mesa_combatants_combat_idx",
  "mesa_battles_session_idx",
  "mesa_attack_resolutions_lookup_idx",
  "mesa_reload_resolutions_lookup_idx",
  "mesa_item_consume_resolutions_lookup_idx",
];

const constraints = [
  "mesa_combatants_kind_check",
  "mesa_combatants_position_valid",
  "mesa_attack_resolutions_status_check",
];

const functions = [
  ["claim_mesa_attack_resolution", 3],
  ["recover_mesa_attack_resolution", 3],
  ["commit_mesa_attack_resolution", 15],
  ["release_mesa_attack_resolution", 4],
  ["claim_mesa_reload_resolution", 3],
  ["recover_mesa_reload_resolution", 3],
  ["commit_mesa_reload_resolution", 15],
  ["release_mesa_reload_resolution", 4],
  ["claim_mesa_item_consume_resolution", 3],
  ["commit_mesa_item_consume_resolution", 13],
  ["release_mesa_item_consume_resolution", 4],
  ["commit_mesa_item_heal_resolution", 15],
  ["commit_mesa_death_save_resolution", 13],
  ["commit_mesa_attack_cover_resolution", 15],
  ["commit_mesa_quickhack_resolution", 19],
  ["commit_mesa_net_action_resolution", 16],
  ["commit_mesa_move_resolution_atomic", 12],
];

test("schema local contém tabelas, colunas, índices, constraints e funções dos adapters", {
  skip: !localUrl,
}, async () => {
  assert.ok(localUrl);
  const name = databaseName(localUrl);
  assert.ok(name, "MESA_LOCAL_TEST_DATABASE_URL deve apontar para banco descartável");
  assert.ok(isLocalUrl(localUrl), "MESA_LOCAL_TEST_DATABASE_URL deve apontar para PostgreSQL local");

  const pool = new Pool(poolConfig(localUrl));
  try {
    const relationRows = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name = any($1::text[])`,
      [Object.keys(tables)],
    );
    assert.deepEqual(
      new Set(relationRows.rows.map((row) => row.table_name)),
      new Set(Object.keys(tables)),
    );

    for (const [table, expectedColumns] of Object.entries(tables)) {
      const result = await pool.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = $1`,
        [table],
      );
      const actual = new Set(result.rows.map((row) => row.column_name));
      for (const column of expectedColumns) {
        assert.ok(actual.has(column), `${table}.${column} ausente`);
      }
    }

    const indexRows = await pool.query<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname = 'public' and indexname = any($1::text[])`,
      [indexes],
    );
    assert.deepEqual(new Set(indexRows.rows.map((row) => row.indexname)), new Set(indexes));

    const constraintRows = await pool.query<{ conname: string }>(
      `select conname from pg_constraint c
       join pg_namespace n on n.oid = c.connamespace
       where n.nspname = 'public' and c.conname = any($1::text[])`,
      [constraints],
    );
    assert.deepEqual(new Set(constraintRows.rows.map((row) => row.conname)), new Set(constraints));

    for (const [name, argumentCount] of functions) {
      const result = await pool.query<{ count: string }>(
        `select count(*)::text as count from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = $1 and p.pronargs = $2`,
        [name, argumentCount],
      );
      assert.equal(result.rows[0]?.count, "1", `${name}/${argumentCount} não encontrada exatamente uma vez`);
    }

    const obsoleteQuickhack = await pool.query<{ count: string }>(
      `select count(*)::text as count from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'commit_mesa_quickhack_resolution' and p.pronargs = 17`,
    );
    assert.equal(obsoleteQuickhack.rows[0]?.count, "0", "sobrecarga obsoleta de Quickhack ainda existe");
  } finally {
    await pool.end();
  }
});
