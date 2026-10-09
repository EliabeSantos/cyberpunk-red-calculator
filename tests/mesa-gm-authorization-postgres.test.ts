import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

try {
  process.loadEnvFile(".env");
} catch {
  // Ambiente sem Supabase: o teste fica explicitamente skipped.
}

const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const db: SupabaseClient | null = configured
  ? createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  : null;
const postgresTest = configured ? test : test.skip;
const sessionIds: string[] = [];
type JsonRecord = Record<string, unknown>;

function stringField(record: JsonRecord, key: string): string {
  const value = record[key];
  assert.equal(typeof value, "string", `${key} deve ser string`);
  return value as string;
}

async function createMesa(token: string, name: string, displayName: string) {
  const { POST } = await import("../src/app/api/mesa/route.ts");
  const response = await POST(new Request("http://localhost/api/mesa", {
    method: "POST",
    headers: { "content-type": "application/json", "x-mesa-token": token },
    body: JSON.stringify({ name, displayName }),
  }));
  return { response, payload: await response.json() as JsonRecord };
}

async function joinMesa(token: string, joinCode: string) {
  const { POST } = await import("../src/app/api/mesa/join/route.ts");
  const response = await POST(new Request("http://localhost/api/mesa/join", {
    method: "POST",
    headers: { "content-type": "application/json", "x-mesa-token": token },
    body: JSON.stringify({ joinCode, displayName: "Player" }),
  }));
  return { response, payload: await response.json() as JsonRecord };
}

async function patchMap(sessionId: string, token: string) {
  const { PATCH } = await import("../src/app/api/mesa/[id]/tactical-map/route.ts");
  const response = await PATCH(new Request(`http://localhost/api/mesa/${sessionId}/tactical-map`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-mesa-token": token,
    },
    // Campos de identidade enviados pelo cliente não participam da decisão.
    body: JSON.stringify({ role: "gm", participantId: randomUUID(), map: {} }),
  }), { params: Promise.resolve({ id: sessionId }) });
  return { response, payload: await response.json() as JsonRecord };
}

postgresTest("criação persiste o Mestre por Mesa e rejeita privilégios forjados", async () => {
  const gmToken = `gm-${randomUUID()}-token`;
  const playerToken = `player-${randomUUID()}-token`;
  const otherGmToken = `other-gm-${randomUUID()}-token`;

  const created = await createMesa(gmToken, `F1652 ${randomUUID()}`, "Mestre");
  assert.equal(created.response.status, 200);
  assert.equal(created.payload.ok, true);
  const firstSession = created.payload.session as JsonRecord;
  const firstParticipant = created.payload.participant as JsonRecord;
  sessionIds.push(stringField(firstSession, "id"));
  assert.equal(firstSession.gmId, firstParticipant.id);
  assert.equal(firstParticipant.role, "gm");

  const joined = await joinMesa(playerToken, stringField(firstSession, "joinCode"));
  assert.equal(joined.response.status, 200);
  assert.equal((joined.payload.participant as JsonRecord).role, "player");

  const playerAttempt = await patchMap(stringField(firstSession, "id"), playerToken);
  assert.equal(playerAttempt.response.status, 403);
  assert.equal(playerAttempt.payload.code, "gm_only");

  const otherCreated = await createMesa(otherGmToken, `F1652 other ${randomUUID()}`, "Outro Mestre");
  assert.equal(otherCreated.response.status, 200);
  const otherSession = otherCreated.payload.session as JsonRecord;
  sessionIds.push(stringField(otherSession, "id"));

  const crossMesaAttempt = await patchMap(stringField(otherSession, "id"), gmToken);
  assert.equal(crossMesaAttempt.response.status, 403);
  assert.equal(crossMesaAttempt.payload.code, "not_participant");

  const realGmAttempt = await patchMap(stringField(firstSession, "id"), gmToken);
  assert.notEqual(realGmAttempt.response.status, 403);
});

after(async () => {
  if (!db || sessionIds.length === 0) return;
  const { error } = await db.from("mesa_sessions").delete().in("id", sessionIds);
  assert.ifError(error);
});
