import assert from "node:assert/strict";
import test from "node:test";

import { shouldMaterializeParticipantInCombat } from "@/lib/mesa/store";

test("GM-only não materializa personagem do Mestre como combatant", () => {
  assert.equal(shouldMaterializeParticipantInCombat("gm", "gm-character", "gm_only"), false);
  assert.equal(shouldMaterializeParticipantInCombat("gm", null, "character"), false);
});

test("modo com personagem preserva o combatant do GM e Players continuam entrando", () => {
  assert.equal(shouldMaterializeParticipantInCombat("gm", "gm-character", "character"), true);
  assert.equal(shouldMaterializeParticipantInCombat("player", "player-character", "gm_only"), true);
});
