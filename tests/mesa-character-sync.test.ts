import assert from "node:assert/strict";
import test from "node:test";

import { applyCombatantState, syncMesaCharacterState } from "../src/lib/mesa/characterSync.ts";
import { createEmptyCharacter } from "../src/types/character.ts";
import type { MesaCombatant, MesaState } from "../src/lib/mesa/types.ts";

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

// ---------------------------------------------------------------------------
// F1.12.1 — o gateway de dano externo depende do MESMO sync já existente.
// ---------------------------------------------------------------------------

function combatantFor(characterId: string, patch: Partial<MesaCombatant>): MesaCombatant {
  const character = createEmptyCharacter(characterId);
  return {
    id: "combatant-1", combatId: "combat-1", sessionId: "session-1", kind: "character",
    characterId, participantId: "participant-1", name: "Solo", sourceKey: null,
    supplies: null, armor: null, criticalInjuries: [], ammoByWeapon: null,
    initiative: null, initiativeDetail: null, actionsMax: 2, actionsRemaining: 2,
    movementMax: 6, movementRemaining: 6, hpCurrent: character.combat.hp.current,
    hpMax: character.combat.hp.max, isDead: character.combat.isDead, conditions: [], sortOrder: 0,
    ...patch,
  };
}

test("sem Mesa (estado null) a ficha continua funcionando localmente", () => {
  const character = createEmptyCharacter("char-offline");
  character.combat.hp = { current: 17, max: 40 };
  const offline = syncMesaCharacterState(character, null);
  assert.equal(offline, character, "modo local-first intacto: nada é sobrescrito");
  assert.equal(offline.combat.hp.current, 17);
});

test("Mesa sem viewer/participantId não projeta nada na ficha", () => {
  const character = createEmptyCharacter("char-no-viewer");
  const state = {
    viewer: { participantId: null, role: null, displayName: null },
    combatants: [combatantFor(character.id, { hpCurrent: 3 })],
  } as unknown as MesaState;
  assert.equal(syncMesaCharacterState(character, state), character);
});

test("HP ≤ 0 (Mortal Wound) chega à ficha sem virar morte nem mexer no Death Save", () => {
  const character = createEmptyCharacter("char-mortal");
  character.combat.hp = { current: 30, max: 40 };
  character.combat.deathSaveDC = 0;
  const combatant = combatantFor(character.id, { hpCurrent: -5, hpMax: 40, isDead: false });
  const synced = applyCombatantState(character, combatant);
  assert.equal(synced.combat.hp.current, -5, "dano do gateway com HP ≤ 0 alcança a ficha");
  assert.equal(synced.combat.isDead, false, "política player: dano não mata");
  assert.equal(synced.combat.deathSaveDC, 0, "Death Save intocado (fora do escopo)");
});

test("Critical Injury da Mesa entra na ficha uma vez só, sem duplicação", () => {
  const character = createEmptyCharacter("char-ci");
  character.combat.hp = { current: 30, max: 40 };
  const injury = { id: "ci-1", name: "Perfuração pulmonar" } as unknown as { id: string; name: string };
  const combatant = combatantFor(character.id, {
    hpCurrent: 20,
    criticalInjuries: [injury] as never,
  });
  const once = applyCombatantState(character, combatant);
  assert.equal(once.combat.criticalInjuries.length, 1, "Mesa CI = ficha CI");
  const twice = applyCombatantState(once, combatant);
  assert.equal(twice, once, "reaplicar não duplica a lesão nem recria a ficha");
});
