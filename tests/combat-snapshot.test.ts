import assert from "node:assert/strict";
import test from "node:test";

import { toCombatParticipant } from "@/lib/combat/adapters";
import type { EncounterParticipant } from "@/types/encounter";

function enemy(): EncounterParticipant & { id: string } {
  return {
    id: "instance-1",
    enemyId: "enemy-template",
    name: "Ganger",
    archetype: "Ganger",
    faction: "gang",
    level: 1,
    threatLevel: "low",
    hp: { current: 20, max: 20 },
    armor: { head: 7, body: 7 },
    conditions: [],
    isPlayer: false,
    weaponName: "Pistol",
    weaponId: "weapon-pistol",
    weaponAttackType: "ranged",
    weaponSkillId: "handgun",
    weaponSkillName: "Handgun",
    refStat: 6,
    dexStat: 8,
    moveStat: 5,
    skillValue: 10,
    attackBase: 10,
    evasionSkillLevel: 2,
    evasionSkillStat: "REF",
    damageExpression: "2d6",
    lastAttackRoll: null,
    lastDamageRoll: null,
    lastEvasionRoll: null,
    initiative: null,
    personalityTraits: [],
  };
}

test("enemy snapshot preserves instance and stable weapon identity", () => {
  const snapshot = toCombatParticipant(enemy());

  assert.equal(snapshot.id, "instance-1");
  assert.equal(snapshot.source.enemyId, "enemy-template");
  assert.equal(snapshot.source.sourceKey, "instance-1");
  assert.equal(snapshot.weapons?.[0]?.id, "weapon-pistol");
  assert.equal(snapshot.weapons?.[0]?.attackType, "weapon");
  assert.equal(snapshot.stats?.REF, 6);
  assert.equal(snapshot.stats?.DEX, 8);
  assert.equal(snapshot.skills?.handgun?.level, 4);
  assert.deepEqual(snapshot.skills?.evasion, { stat: "REF", level: 2 });
});

test("snapshot is independent from later encounter object mutation", () => {
  const source = enemy();
  const snapshot = structuredClone(toCombatParticipant(source));

  source.name = "Changed later";
  source.weaponName = "Different weapon";
  source.hp.current = 1;

  assert.equal(snapshot.name, "Ganger");
  assert.equal(snapshot.weapons?.[0]?.name, "Pistol");
  assert.equal(snapshot.combat.hp.current, 20);
});

test("enemy snapshot sem Evasion não inventa skill defensiva", () => {
  const source = enemy();
  source.evasionSkillLevel = undefined;
  source.evasionSkillName = undefined;
  source.evasionSkillStat = undefined;
  const snapshot = toCombatParticipant(source);

  assert.equal(snapshot.stats?.DEX, 8);
  assert.equal(snapshot.skills?.evasion, undefined);
});

test("enemy snapshot sem DEX mantém a defesa estruturalmente incompleta", () => {
  const source = enemy();
  source.dexStat = undefined;
  const snapshot = toCombatParticipant(source);

  assert.equal(snapshot.stats?.DEX, undefined);
  assert.deepEqual(snapshot.skills?.evasion, { stat: "REF", level: 2 });
});
