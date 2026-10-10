import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import test from "node:test";

const databaseUrl = process.env.MESA_LOCAL_TEST_DATABASE_URL;
const postgresTest = databaseUrl ? test : test.skip;

function poolConfig(url: string): { host?: string; database?: string; connectionString?: string } {
  const socket = url.match(/^(?:postgres|postgresql):\/\/(?:[^/@]*@)?\/([^?#]+)/);
  return socket
    ? { host: process.env.MESA_LOCAL_PG_SOCKET_DIR || "/var/run/postgresql", database: socket[1] }
    : { connectionString: url };
}

postgresTest("inicia combate local e persiste o snapshot JSON da partida", async () => {
  if (!databaseUrl) return;
  process.env.MESA_HOSTING_MODE = "local";
  process.env.MESA_LOCAL_DATABASE_URL = databaseUrl;
  const pool = new Pool(poolConfig(databaseUrl));
  const sessionId = randomUUID();
  const participantId = randomUUID();
  const token = `gm-local-${randomUUID()}`;

  try {
    await pool.query(
      "insert into public.mesa_sessions (id,name,gm_id,status,join_code) values ($1,$2,$3,'active',$4)",
      [sessionId, "Local combat test", participantId, sessionId.replaceAll("-", "").slice(0, 5).toUpperCase()],
    );
    await pool.query(
      "insert into public.mesa_participants (id,session_id,player_token,display_name,role) values ($1,$2,$3,'GM','gm')",
      [participantId, sessionId, token],
    );

    const { POST } = await import("../src/app/api/mesa/[id]/combat/route.ts");
    const response = await POST(new Request(`http://localhost/api/mesa/${sessionId}/combat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-mesa-token": token },
      body: JSON.stringify({ enemies: [{ name: "Alvo local", hp: 20 }] }),
    }), { params: Promise.resolve({ id: sessionId }) });

    assert.equal(response.status, 200, JSON.stringify(await response.json()));
    const result = await pool.query(
      `select s.status, c.status as combat_status, count(cb.id)::int as combatants,
              jsonb_array_length(b.combatants) as snapshot_size
         from public.mesa_sessions s
         join public.mesa_combats c on c.session_id = s.id
         join public.mesa_battles b on b.session_id = s.id
         left join public.mesa_combatants cb on cb.combat_id = c.id
        where s.id = $1
        group by s.status, c.status, b.combatants`,
      [sessionId],
    );
    assert.deepEqual(result.rows[0], {
      status: "active",
      combat_status: "active",
      combatants: 1,
      snapshot_size: 1,
    });
  } finally {
    await pool.query("delete from public.mesa_sessions where id = $1", [sessionId]);
    await pool.end();
  }
});
