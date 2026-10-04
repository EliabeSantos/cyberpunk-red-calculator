import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

try {
  process.loadEnvFile(".env");
} catch {
  // CI sem secrets executa os testes locais, mas marca este suite como skip.
}

const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const db: SupabaseClient | null = configured
  ? createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  : null;
const sessionId = randomUUID();
const combatId = randomUUID();
const actorId = randomUUID();
const actor2Id = randomUUID();
const targetId = randomUUID();
const target2Id = randomUUID();
const combatantIds: string[] = [actorId, actor2Id, targetId, target2Id];
const resolution = (label: string) => `e2e-${label}-${randomUUID()}`;

async function rpc<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
  const response = await db!.rpc(name, args);
  if (response.error) throw new Error(`${name}: ${response.error.message}`);
  return response.data as T;
}

async function combatant(id: string, actions: number, ammo = 1, hp = 20): Promise<void> {
  const { error } = await db!.from("mesa_combatants").insert({
    id,
    combat_id: combatId,
    session_id: sessionId,
    kind: "character",
    name: id.slice(0, 8),
    actions_max: 2,
    actions_remaining: actions,
    movement_max: 6,
    movement_remaining: 6,
    hp_current: hp,
    hp_max: hp,
    is_dead: false,
    conditions: [],
    sort_order: combatantIds.indexOf(id),
    combat_ammo: { weapon: ammo },
    combat_armor: { head: 0, body: 0 },
    critical_injuries: [],
  });
  if (error) throw error;
}

async function readCombatant(id: string): Promise<{ actions_remaining: number; combat_ammo: { weapon: number }; hp_current: number }> {
  const { data, error } = await db!.from("mesa_combatants").select("actions_remaining,combat_ammo,hp_current").eq("id", id).single();
  if (error || !data) throw error ?? new Error("combatant not found");
  return data as { actions_remaining: number; combat_ammo: { weapon: number }; hp_current: number };
}

async function claim(resolutionId: string): Promise<{ claimed: boolean; status: string; claim_token: string; result: unknown }> {
  const rows = await rpc<Array<{ claimed: boolean; status: string; claim_token: string; result: unknown }>>(
    "claim_mesa_attack_resolution",
    { p_session_id: sessionId, p_combat_id: combatId, p_resolution_id: resolutionId },
  );
  return rows[0];
}

function commitArgs(
  resolutionId: string,
  claimToken: string,
  actor: string,
  target: string,
  actionsBefore: number,
  actionsAfter: number,
  ammoBefore: number,
  ammoAfter: number,
  hpBefore = 20,
  targetPatch: Record<string, unknown> = {},
  result: Record<string, unknown> = { attackResult: { attackId: resolutionId } },
) {
  return {
    p_session_id: sessionId,
    p_combat_id: combatId,
    p_resolution_id: resolutionId,
    p_claim_token: claimToken,
    p_actor_id: actor,
    p_target_id: target,
    p_actions_before: actionsBefore,
    p_actions_after: actionsAfter,
    p_ammo_before: { weapon: ammoBefore },
    p_ammo_after: { weapon: ammoAfter },
    p_target_hp_before: hpBefore,
    p_target_dead_before: false,
    p_target_patch: targetPatch,
    p_result: result,
    p_event_text: `E2E ${resolutionId}`,
  };
}

const postgresTest = configured ? test : test.skip;

postgresTest("Attack resolution RPC: idempotência, concorrência, rollback e recovery reais", async () => {
  const { error: sessionError } = await db!.from("mesa_sessions").insert({
    id: sessionId,
    name: "E2E Attack Resolution",
    gm_id: null,
    status: "active",
    join_code: `E${sessionId.slice(0, 4).toUpperCase()}`,
  });
  assert.ifError(sessionError);
  const { error: combatError } = await db!.from("mesa_combats").insert({
    id: combatId,
    session_id: sessionId,
    status: "active",
    round: 1,
    initiative_started: true,
    event_log: [],
  });
  assert.ifError(combatError);
  await Promise.all([combatant(actorId, 2), combatant(actor2Id, 2), combatant(targetId, 2), combatant(target2Id, 2)]);

  const sameId = resolution("same");
  const sameClaims = await Promise.all([claim(sameId), claim(sameId)]);
  assert.equal(sameClaims.filter((item) => item.claimed).length, 1);
  const owner = sameClaims.find((item) => item.claimed)!;
  const persisted = { attackResult: { attackId: sameId }, damageResult: { hpAfter: 20 } };
  const mutableTarget = {
    hp_current: 19,
    is_dead: false,
    combat_armor: { head: 0, body: 0 },
    critical_injuries: [{ roll: 2, name: "E2E Injury", location: "body" }],
  };
  await rpc("commit_mesa_attack_resolution", commitArgs(sameId, owner.claim_token, actorId, targetId, 2, 1, 1, 0, 20, mutableTarget, persisted));
  const retry = await rpc<{ attackResult: { attackId: string }; damageResult: { hpAfter: number } }>(
    "commit_mesa_attack_resolution",
    commitArgs(sameId, owner.claim_token, actorId, targetId, 2, 1, 1, 0, 20, {}, { attackResult: { changed: true } }),
  );
  assert.equal(retry.attackResult.attackId, sameId);
  assert.equal(retry.damageResult.hpAfter, 20);
  assert.deepEqual(await readCombatant(actorId), { actions_remaining: 1, combat_ammo: { weapon: 0 }, hp_current: 20 });
  const { data: sameTarget } = await db!.from("mesa_combatants").select("hp_current,combat_armor,critical_injuries").eq("id", targetId).single();
  assert.equal(sameTarget?.hp_current, 19);
  assert.deepEqual(sameTarget?.combat_armor, mutableTarget.combat_armor);
  assert.deepEqual(sameTarget?.critical_injuries, mutableTarget.critical_injuries);
  const { data: sameCombat } = await db!.from("mesa_combats").select("event_log").eq("id", combatId).single();
  assert.equal((sameCombat?.event_log as Array<{ text: string }>).filter((event) => event.text === `E2E ${sameId}`).length, 1);

  const actionA = resolution("action-a");
  const actionB = resolution("action-b");
  const [claimA, claimB] = await Promise.all([claim(actionA), claim(actionB)]);
  const actionResults = await Promise.allSettled([
    rpc("commit_mesa_attack_resolution", commitArgs(actionA, claimA.claim_token, actor2Id, targetId, 2, 1, 1, 0)),
    rpc("commit_mesa_attack_resolution", commitArgs(actionB, claimB.claim_token, actor2Id, targetId, 2, 1, 1, 0)),
  ]);
  assert.equal(actionResults.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(actionResults.filter((item) => item.status === "rejected").length, 1);
  assert.equal((await readCombatant(actor2Id)).actions_remaining, 1);

  const ammoA = resolution("ammo-a");
  const ammoB = resolution("ammo-b");
  const [claimAmmoA, claimAmmoB] = await Promise.all([claim(ammoA), claim(ammoB)]);
  const ammoResults = await Promise.allSettled([
    rpc("commit_mesa_attack_resolution", commitArgs(ammoA, claimAmmoA.claim_token, target2Id, actorId, 2, 1, 1, 0)),
    rpc("commit_mesa_attack_resolution", commitArgs(ammoB, claimAmmoB.claim_token, target2Id, actorId, 2, 1, 1, 0)),
  ]);
  assert.equal(ammoResults.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal((await readCombatant(target2Id)).combat_ammo.weapon, 0);

  const hpA = resolution("hp-a");
  const hpB = resolution("hp-b");
  const [claimHpA, claimHpB] = await Promise.all([claim(hpA), claim(hpB)]);
  const hpPatchA = { hp_current: 15, is_dead: false, combat_armor: { head: 0, body: 0 }, critical_injuries: [] };
  const hpPatchB = { hp_current: 12, is_dead: false, combat_armor: { head: 0, body: 0 }, critical_injuries: [] };
  const hpResults = await Promise.allSettled([
    rpc("commit_mesa_attack_resolution", commitArgs(hpA, claimHpA.claim_token, actorId, target2Id, 1, 0, 0, 0, 20, hpPatchA)),
    rpc("commit_mesa_attack_resolution", commitArgs(hpB, claimHpB.claim_token, actor2Id, target2Id, 1, 0, 0, 0, 20, hpPatchB)),
  ]);
  assert.equal(hpResults.filter((item) => item.status === "fulfilled").length, 1);
  assert.ok([12, 15].includes((await readCombatant(target2Id)).hp_current));

  const rollbackId = resolution("rollback");
  const rollbackClaim = await claim(rollbackId);
  const rollback = await db!.rpc("commit_mesa_attack_resolution", commitArgs(rollbackId, rollbackClaim.claim_token, targetId, target2Id, 2, 1, 1, 0, 999, { hp_current: 1 }));
  assert.ok(rollback.error);
  assert.equal((await readCombatant(targetId)).actions_remaining, 2);
  const { data: rollbackRow } = await db!.from("mesa_attack_resolutions").select("status").eq("resolution_id", rollbackId).single();
  assert.equal(rollbackRow?.status, "processing");
  await rpc("release_mesa_attack_resolution", { p_session_id: sessionId, p_combat_id: combatId, p_resolution_id: rollbackId, p_claim_token: rollbackClaim.claim_token });

  const recoveryId = resolution("recovery");
  const recoveryClaim = await claim(recoveryId);
  const { error: ageError } = await db!.from("mesa_attack_resolutions").update({ updated_at: new Date(Date.now() - 120_000).toISOString() }).eq("resolution_id", recoveryId);
  assert.ifError(ageError);
  const recovered = await rpc<Array<{ status: string }>>("recover_mesa_attack_resolution", { p_session_id: sessionId, p_combat_id: combatId, p_resolution_id: recoveryId });
  assert.equal(recovered[0].status, "failed");
  const failedRetry = await db!.rpc("commit_mesa_attack_resolution", commitArgs(recoveryId, recoveryClaim.claim_token, targetId, target2Id, 2, 1, 1, 0));
  assert.match(failedRetry.error?.message ?? "", /resolution_failed/);

  const committedRecoveryId = resolution("recovery-committed");
  const committedRecoveryClaim = await claim(committedRecoveryId);
  const committedResult = { attackResult: { attackId: committedRecoveryId }, marker: "persisted" };
  await rpc("commit_mesa_attack_resolution", commitArgs(committedRecoveryId, committedRecoveryClaim.claim_token, targetId, target2Id, 2, 1, 1, 0, 20, {}, committedResult));
  const committedState = await rpc<Array<{ status: string; result: typeof committedResult }>>(
    "recover_mesa_attack_resolution",
    { p_session_id: sessionId, p_combat_id: combatId, p_resolution_id: committedRecoveryId },
  );
  assert.equal(committedState[0].status, "committed");
  assert.equal(committedState[0].result.marker, "persisted");
});

after(async () => {
  if (!db) return;
  await db.from("mesa_combatants").delete().in("id", combatantIds);
  await db.from("mesa_combats").delete().eq("id", combatId);
  await db.from("mesa_sessions").delete().eq("id", sessionId);
});
