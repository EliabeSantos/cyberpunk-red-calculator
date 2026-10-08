import assert from "node:assert/strict";
import test from "node:test";

import { execute } from "../src/lib/combat/engine.ts";
import { rollWeaponDamage } from "../src/lib/combat/weaponDamage.ts";
import type { CombatParticipant, CombatState } from "../src/lib/combat/contract.ts";
import { createTestRandomSource } from "../src/lib/random.ts";

const target = (id = "target"): CombatParticipant => ({
  id,
  type: "enemy",
  name: "Gangoon",
  source: { characterId: null, sourceKey: id, enemyId: "gangoon" },
  stats: { DEX: 6 },
  skills: { evasion: { stat: "DEX", level: 4 } },
  combat: { hp: { current: 30, max: 30 }, armor: { head: 0, body: 0 }, criticalInjuries: [], conditions: [], initiative: null, isDead: false },
});

const state = (attacker: CombatParticipant, defender = target()): CombatState => ({
  id: "melee-test",
  status: "active",
  round: 1,
  initiativeStarted: true,
  activeParticipantId: attacker.id,
  participants: [attacker, defender],
});

const character = (overrides: Partial<CombatParticipant> = {}): CombatParticipant => ({
  id: "attacker",
  type: "character",
  name: "Marbas",
  source: { characterId: "character", sourceKey: null, enemyId: null },
  stats: { DEX: 8, BODY: 6 },
  skills: { brawling: { stat: "DEX", level: 4 }, martial_arts: { stat: "DEX", level: 4 } },
  combat: { hp: { current: 30, max: 30 }, armor: { head: 0, body: 0 }, criticalInjuries: [], conditions: [], initiative: null, isDead: false },
  ...overrides,
});

function attack(attacker: CombatParticipant, attackType: "melee" | "brawling" | "martial_arts" | "unarmed", weaponId?: string) {
  return execute(
    state(attacker),
    {
      type: "attack",
      actorId: attacker.id,
      targetId: "target",
      ...(weaponId ? { weaponId } : {}),
      skillId: weaponId ? undefined : attackType === "martial_arts" ? "martial_arts" : "brawling",
      attackType,
      attackMode: "normal",
      defense: { type: "dv", value: 0, source: "range_table" },
    },
    createTestRandomSource([5]),
  );
}

test("melee weapon without magazine uses the weapon catalog and does not require ammo", () => {
  const attacker = character({
    weapons: [{ id: "katana", name: "Katana", damage: "2d6", skill: "melee_weapon", attackType: "melee" }],
    skills: { melee_weapon: { stat: "DEX", level: 5 } },
  });
  const result = attack(attacker, "melee", "katana");
  assert.equal(result.ok, true);
  assert.equal(result.attackResult?.attackType, "melee");
  assert.equal(result.changes.some((change) => change.type === "ammo_changed"), false);
  assert.equal(result.attackResult?.hit, true);
});

test("Brawling and Weaponless resolve through the same attack and damage pipeline", () => {
  for (const attackType of ["brawling", "unarmed"] as const) {
    const attacker = character();
    const result = attack(attacker, attackType);
    assert.equal(result.ok, true);
    assert.equal(result.attackResult?.hit, true);
    const damage = rollWeaponDamage(attacker, result.attackResult!, createTestRandomSource([4, 4]));
    assert.equal(damage.ok, true);
    if (!damage.ok) continue;
    assert.equal(damage.roll.expression, "2d6");
    const applied = execute(result.state, {
      type: "damage",
      actorId: attacker.id,
      targetId: "target",
      amount: damage.roll.total,
      damageRolls: damage.roll.rolls,
    }, createTestRandomSource([3, 4]));
    assert.equal(applied.ok, true);
    assert.equal(applied.damageResult?.rawDamage, damage.roll.total);
  }
});

test("Martial Arts preserves the existing half-SP damage rule after a hit", () => {
  const attacker = character();
  const defender = target();
  defender.combat.armor.body = 11;
  const result = attack(attacker, "martial_arts");
  assert.equal(result.ok, true);
  const damage = rollWeaponDamage(attacker, result.attackResult!, createTestRandomSource([6, 6]));
  assert.equal(damage.ok, true);
  if (!damage.ok) return;
  const applied = execute({ ...state(attacker, defender), participants: [attacker, defender] }, {
    type: "damage",
    actorId: attacker.id,
    targetId: "target",
    amount: damage.roll.total,
    damageRolls: damage.roll.rolls,
    armorRule: "martial_arts_half",
  }, createTestRandomSource([3, 4]));
  assert.equal(applied.ok, true);
  assert.equal(applied.damageResult?.armorValue, 6);
});

test("a weapon attack cannot change its melee/ranged type in the action", () => {
  const attacker = character({
    weapons: [{ id: "katana", name: "Katana", damage: "2d6", skill: "melee_weapon", attackType: "melee" }],
    skills: { melee_weapon: { stat: "DEX", level: 5 } },
  });
  const result = execute(state(attacker), {
    type: "attack",
    actorId: attacker.id,
    targetId: "target",
    weaponId: "katana",
    attackType: "handgun",
    attackMode: "normal",
    defense: { type: "dv", value: 0, source: "range_table" },
  }, createTestRandomSource([5]));
  assert.equal(result.ok, false);
  assert.match(result.errors?.[0]?.message ?? "", /attackType inconsistente/);
});
