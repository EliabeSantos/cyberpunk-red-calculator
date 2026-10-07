import assert from "node:assert/strict";
import test from "node:test";

import {
  bodyCriticalInjuries,
  headCriticalInjuries,
  rollCriticalInjuryDetail,
  type CriticalInjury,
} from "../src/data/criticalInjuries.ts";
import { getCriticalInjuryModifiers } from "../src/lib/calculations.ts";
import { createTestRandomSource } from "../src/lib/random.ts";

function characterWith(injuries: CriticalInjury[]) {
  return {
    combat: {
      hp: { current: 40, max: 40 },
      stamina: { current: 0, max: 0 },
      armor: { head: 0, body: 0 },
      criticalInjuries: injuries,
      deathSaveDC: 8,
      deathSaveFailures: 0,
      isDead: false,
    },
  } as never;
}

test("o catálogo balanceado contém exatamente as 22 lesões e nenhum modificador extremo", () => {
  const injuries = [...bodyCriticalInjuries, ...headCriticalInjuries];
  assert.equal(injuries.length, 22);
  assert.equal(injuries.some((injury) => injury.modifiers.some((modifier) => Math.abs(modifier.value) >= 99)), false);
  assert.deepEqual(
    injuries.map((injury) => injury.name),
    [
      "Dismembered Arm", "Dismembered Hand", "Collapsed Lung", "Broken Ribs", "Broken Arm",
      "Foreign Object", "Broken Leg", "Torn Muscle", "Spinal Injury", "Crushed Fingers", "Dismembered Leg",
      "Lost Eye", "Brain Injury", "Damaged Eye", "Concussion", "Broken Jaw", "Foreign Object", "Whiplash",
      "Cracked Skull", "Brain Damage", "Crushed Windpipe", "Severed Spinal Cord",
    ],
  );
});

test("cada lesão expõe o efeito principal do novo balanceamento", () => {
  const body = new Map(bodyCriticalInjuries.map((injury) => [injury.name, injury]));
  const head = new Map(headCriticalInjuries.map((injury) => [injury.name, injury]));
  const get = (name: string, source = body) => {
    const injury = source.get(name);
    assert.ok(injury, `lesão ausente: ${name}`);
    return injury;
  };

  assert.equal(get("Dismembered Arm").modifiers.some((m) => m.type === "stat" && m.stat === "REF"), false);
  assert.equal(get("Dismembered Hand").modifiers.some((m) => m.type === "fine_manipulation"), true);
  assert.equal(get("Broken Arm").modifiers.some((m) => m.type === "stat" && m.stat === "REF"), false);
  assert.equal(get("Broken Leg").modifiers.find((m) => m.type === "move")?.value, -2);
  assert.equal(get("Torn Muscle").modifiers.some((m) => m.type === "area"), true);
  assert.equal(get("Spinal Injury").modifiers.some((m) => m.type === "move_zero"), true);
  assert.equal(get("Spinal Injury").modifiers.some((m) => m.type === "all_physical"), false);
  assert.equal(get("Crushed Fingers").modifiers.some((m) => m.type === "stat"), false);
  assert.equal(get("Dismembered Leg").modifiers.find((m) => m.type === "melee")?.value, -2);
  assert.equal(get("Dismembered Leg").modifiers.some((m) => m.type === "move_zero"), true);
  assert.equal(get("Lost Eye", head).modifiers.find((m) => m.type === "ranged")?.value, -2);
  assert.equal(get("Brain Injury", head).modifiers.find((m) => m.type === "stat" && m.stat === "REF")?.value, -1);
  assert.equal(get("Concussion", head).unconsciousRoundsDie, "1d3");
  assert.equal(get("Whiplash", head).modifiers.find((m) => m.type === "move")?.value, -1);
  assert.equal(get("Cracked Skull", head).unconsciousRoundsDie, "1d3");
  assert.equal(get("Brain Damage", head).permanentModifiers?.find((m) => m.stat === "INT")?.value, -1);
  assert.equal(get("Crushed Windpipe", head).modifiers.some((m) => Math.abs(m.value) >= 99), false);
  assert.equal(get("Severed Spinal Cord", head).deathSavePenalty, -2);
});

test("modificadores de Death Save acumulam sem duplicar o estado da lesão", () => {
  const brainDamage = headCriticalInjuries.find((injury) => injury.name === "Brain Damage")!;
  const windpipe = headCriticalInjuries.find((injury) => injury.name === "Crushed Windpipe")!;
  const modifiers = getCriticalInjuryModifiers(characterWith([brainDamage, windpipe]));
  assert.equal(modifiers.deathSaveModifier, -4);
});

test("rolagem de Critical Injury evita repetir o mesmo nome", () => {
  const existing = new Set(["Foreign Object"]);
  const result = rollCriticalInjuryDetail("body", existing, createTestRandomSource([3, 4, 3, 5]));
  assert.notEqual(result.injury.name, "Foreign Object");
  assert.equal(result.injury.name, "Broken Leg");
});

test("Concussion e Cracked Skull materializam duração 1d3", () => {
  const concussion = headCriticalInjuries.find((injury) => injury.name === "Concussion")!;
  const cracked = headCriticalInjuries.find((injury) => injury.name === "Cracked Skull")!;
  const concussionResult = rollCriticalInjuryDetail("head", new Set(["Lost Eye", "Brain Injury"]), createTestRandomSource([2, 3, 2, 1]));
  assert.equal(concussionResult.injury.name, concussion.name);
  assert.equal(concussionResult.injury.unconsciousRounds, 2);
  const crackedResult = rollCriticalInjuryDetail("head", new Set(["Lost Eye", "Brain Injury", "Damaged Eye", "Concussion", "Broken Jaw", "Foreign Object", "Whiplash", "Brain Injury"]), createTestRandomSource([3, 6, 3, 3]));
  assert.equal(crackedResult.injury.name, cracked.name);
  assert.equal(crackedResult.injury.unconsciousRounds, 3);
});
