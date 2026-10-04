import assert from "node:assert/strict";
import test from "node:test";

import { applyCombatantState } from "../src/lib/mesa/characterSync.ts";
import { createEmptyCharacter } from "../src/types/character.ts";
import type { MesaCombatant } from "../src/lib/mesa/types.ts";

test("estado autoritativo da Mesa converge HP, morte, armor, CI e munição na ficha", () => {
  const character = createEmptyCharacter("char-sync");
  character.weapons = [{ id: "weapon-1", name: "Pistola", damage: "2d6", ammo: 6, magazine: 12 }];
  const combatant: MesaCombatant = {
    id: "combatant-1", combatId: "combat-1", sessionId: "session-1", kind: "character",
    characterId: character.id, participantId: "participant-1", name: "Solo", sourceKey: null,
    supplies: null, armor: { head: 4, body: 7 }, criticalInjuries: [], ammoByWeapon: { "weapon-1": 2 },
    initiative: 10, initiativeDetail: null, actionsMax: 2, actionsRemaining: 1,
    movementMax: 10, movementRemaining: 8, hpCurrent: 10, hpMax: 40, isDead: false,
    conditions: [], sortOrder: 0,
  };
  const synced = applyCombatantState(character, combatant);
  assert.equal(synced.combat.hp.current, 10);
  assert.deepEqual(synced.combat.armor, { head: 4, body: 7 });
  assert.equal(synced.weapons[0].ammo, 2);
});

test("aplicar o mesmo snapshot novamente é idempotente", () => {
  const character = createEmptyCharacter("char-sync");
  const combatant: MesaCombatant = {
    id: "combatant-1", combatId: "combat-1", sessionId: "session-1", kind: "character",
    characterId: character.id, participantId: "participant-1", name: "Solo", sourceKey: null,
    supplies: null, armor: null, criticalInjuries: [], ammoByWeapon: null,
    initiative: null, initiativeDetail: null, actionsMax: 2, actionsRemaining: 2,
    movementMax: 6, movementRemaining: 6, hpCurrent: character.combat.hp.current,
    hpMax: character.combat.hp.max, isDead: character.combat.isDead, conditions: [], sortOrder: 0,
  };
  assert.equal(applyCombatantState(character, combatant), character);
});
