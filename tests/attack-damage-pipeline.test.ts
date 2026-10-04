import assert from "node:assert/strict";
import test from "node:test";

import { createTestRandomSource } from "../src/lib/random.ts";
import { execute } from "../src/lib/combat/engine.ts";
import { resolveHitLocation } from "../src/lib/combat/hitLocation.ts";
import { rollWeaponDamage } from "../src/lib/combat/weaponDamage.ts";
import type { AttackAction, CombatParticipant, CombatState, DamageAction } from "../src/lib/combat/contract.ts";

function participant(id: string, type: "character" | "enemy"): CombatParticipant {
  return {
    id,
    type,
    name: id,
    source: { characterId: type === "character" ? id : null, sourceKey: type === "enemy" ? id : null, enemyId: null },
    stats: type === "character" ? { DEX: 4 } : { REF: 8 },
    skills: type === "character"
      ? { evasion: { stat: "DEX", level: 2 } }
      : { handgun: { stat: "REF", level: 4 } },
    weapons: type === "enemy"
      ? [{ id: "pistol", name: "Pistol", damage: "2d6", skill: "handgun", attackType: "handgun", ammo: 3 }]
      : [],
    combat: {
      hp: { current: 30, max: 30 },
      armor: { head: 7, body: 7 },
      criticalInjuries: [],
      conditions: [],
      initiative: 10,
      isDead: false,
    },
  };
}

function state(): CombatState {
  return {
    id: "combat-1",
    status: "active",
    round: 1,
    initiativeStarted: true,
    activeParticipantId: "enemy-1",
    participants: [participant("enemy-1", "enemy"), participant("target-1", "character")],
  };
}

test("hit percorre AttackResult → weapon damage → DamageResult sem rolar ataque de novo", () => {
  const rng = createTestRandomSource([8, 2, 6, 6, 6]);
  const attack: AttackAction = {
    type: "attack",
    actorId: "enemy-1",
    targetId: "target-1",
    weaponId: "pistol",
    attackType: "handgun",
    attackMode: "aimed",
    aimedTarget: "head",
    defense: { type: "evasion" },
  };

  const attackResult = execute(state(), attack, rng);
  assert.equal(attackResult.ok, true);
  if (!attackResult.ok || !attackResult.attackResult) return;
  assert.equal(attackResult.attackResult.hit, true);

  const actor = attackResult.state.participants[0];
  const weaponDamage = rollWeaponDamage(actor, attackResult.attackResult, rng);
  assert.equal(weaponDamage.ok, true);
  if (!weaponDamage.ok) return;

  const location = resolveHitLocation(attackResult.attackResult);
  assert.deepEqual(location, { ok: true, location: "head" });
  if (!location.ok) return;

  const damageAction: DamageAction = {
    type: "damage",
    actorId: "enemy-1",
    targetId: "target-1",
    amount: weaponDamage.roll.total,
    hitLocation: location.location,
  };
  const damageResult = execute(attackResult.state, damageAction, rng);
  assert.equal(damageResult.ok, true);
  if (!damageResult.ok || !damageResult.damageResult) return;

  assert.equal(damageResult.damageResult.rawDamage, weaponDamage.roll.total);
  assert.equal(damageResult.damageResult.hitLocation, "head");
  assert.equal(damageResult.damageResult.hpBefore, 30);
  assert.equal(damageResult.damageResult.hpAfter, 20);
});

test("miss não rola weapon damage nem produz DamageResult", () => {
  const rng = createTestRandomSource([1, 10, 10, 2]);
  const attackResult = execute(
    state(),
    {
      type: "attack",
      actorId: "enemy-1",
      targetId: "target-1",
      weaponId: "pistol",
      attackType: "handgun",
      attackMode: "normal",
      defense: { type: "evasion" },
    },
    rng,
  );
  assert.equal(attackResult.ok, true);
  if (!attackResult.ok || !attackResult.attackResult) return;
  assert.equal(attackResult.attackResult.hit, false);
  assert.equal(rollWeaponDamage(state().participants[0], attackResult.attackResult, rng).ok, false);
  assert.equal(attackResult.attackResult.ammoConsumed, 1);
  assert.equal(attackResult.changes.some((change) => change.type === "ammo_changed"), true);
});
