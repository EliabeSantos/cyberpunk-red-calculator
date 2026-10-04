import assert from "node:assert/strict";
import test from "node:test";

import { toCombatParticipant } from "../src/lib/combat/adapters.ts";
import { combatParticipantFromRow } from "../src/lib/mesa/store.ts";
import type { EncounterParticipant } from "../src/types/encounter.ts";

function encounter(overrides: Partial<EncounterParticipant> = {}): EncounterParticipant & { id: string } {
  return {
    id: "enemy-instance",
    enemyId: "enemy-template",
    name: "Enemy",
    archetype: "Ganger",
    faction: "gang",
    level: 1,
    threatLevel: "low",
    hp: { current: 20, max: 20 },
    armor: { head: 7, body: 7 },
    conditions: [],
    isPlayer: false,
    weaponName: "Pistol",
    weaponId: "weapon-1",
    weaponAttackType: "ranged",
    weaponSkillId: "handgun",
    weaponSkillName: "Handgun",
    refStat: 6,
    dexStat: 8,
    moveStat: 5,
    skillValue: 10,
    attackBase: 10,
    evasionSkillName: "Evasion",
    evasionSkillLevel: 4,
    evasionSkillStat: "REF",
    damageExpression: "2d6",
    lastAttackRoll: null,
    lastDamageRoll: null,
    lastEvasionRoll: null,
    initiative: null,
    personalityTraits: [],
    ...overrides,
  };
}

test("snapshot defensivo congela DEX e Evasion da origem", () => {
  const source = encounter();
  const snapshot = structuredClone(toCombatParticipant(source));

  source.dexStat = 2;
  source.evasionSkillLevel = 1;

  assert.equal(snapshot.stats?.DEX, 8);
  assert.deepEqual(snapshot.skills?.evasion, { stat: "REF", level: 4 });
});

test("combatParticipantFromRow reconstrói DEX e Evasion do snapshot", () => {
  const snapshot = toCombatParticipant(encounter());
  const row = {
    id: "combatant-row",
    combat_id: "combat-1",
    session_id: "session-1",
    kind: "enemy",
    character_id: null,
    participant_id: null,
    name: "Enemy",
    source_key: "enemy-instance",
    combat_snapshot: snapshot,
    combat_ammo: null,
    initiative: null,
    initiative_detail: null,
    actions_max: 2,
    actions_remaining: 2,
    movement_max: 10,
    movement_remaining: 10,
    hp_current: 20,
    hp_max: 20,
    is_dead: false,
    conditions: [],
    sort_order: 0,
  } as Parameters<typeof combatParticipantFromRow>[0];

  const reconstructed = combatParticipantFromRow(row);
  assert.ok(reconstructed);
  assert.equal(reconstructed.stats?.DEX, 8);
  assert.deepEqual(reconstructed.skills?.evasion, { stat: "REF", level: 4 });
});

test("snapshot sem Evasion preserva a ausência e não usa nível zero", () => {
  const snapshot = toCombatParticipant(encounter({
    evasionSkillName: undefined,
    evasionSkillLevel: undefined,
    evasionSkillStat: undefined,
  }));

  assert.equal(snapshot.stats?.DEX, 8);
  assert.equal(snapshot.skills?.evasion, undefined);
});
