import assert from "node:assert/strict";
import test from "node:test";

import { rollAttack } from "../src/lib/attacks.ts";
import { getSkillBase } from "../src/lib/calculations.ts";
import { getAttributePointsRemaining, getCreationPointSummary, getSkillPointsSpent, validateCharacterCreation } from "../src/lib/characterCreation.ts";
import { skillDefinitions } from "../src/data/skills.ts";
import { statNames, createEmptyCharacter } from "../src/types/character.ts";
import { addMulticlassRole, addPrimaryRole, getCombatAwarenessTotal, getMakerSpecialtyPoints, getMedicineSpecialtyPoints, getMotoSkillBonus, getNetActionsPerTurn, getRoleAbilityIPCost, spendIPOnRoleAbility } from "../src/lib/roles.ts";

function characterWith(ref: number, handgunLevel: number) {
  const character = createEmptyCharacter("test-character");
  character.stats = { ...character.stats, REF: ref };
  character.skills = { ...character.skills, handgun: { ...character.skills.handgun, level: handgunLevel } };
  return character;
}

test("Skill Base combines the associated STAT and Skill Level", () => {
  assert.equal(getSkillBase(characterWith(6, 4), "handgun"), 10);
  assert.equal(getSkillBase(characterWith(7, 4), "handgun"), 11);
  assert.equal(getSkillBase(characterWith(6, 5), "handgun"), 11);
});

test("Complete Package starts with independent 62 STAT and 86 Skill pools", () => {
  const character = createEmptyCharacter("creation-test");
  const summary = getCreationPointSummary(character);
  assert.equal(summary.attributePointsTotal, 62);
  assert.equal(summary.attributePointsSpent, 20);
  assert.equal(getAttributePointsRemaining(character), 42);
  assert.equal(summary.skillPointsTotal, 86);
  assert.equal(summary.skillPointsPreAllocated, 26);
  assert.equal(getSkillPointsSpent(character), 26);
  assert.equal(summary.skillPointsRemaining, 60);
  for (const id of ["athletics", "brawling", "concentration", "conversation", "education", "evasion", "first_aid", "human_perception", "language", "local_expert", "perception", "persuasion", "stealth"]) assert.equal(character.skills[id].level, 2);
});

test("x2 skills spend double points without changing their level", () => {
  const character = createEmptyCharacter("cost-test");
  character.skills = { ...character.skills, autofire: { ...character.skills.autofire, level: 3 }, martial_arts: { ...character.skills.martial_arts, level: 3 } };
  assert.equal(character.skills.autofire.costMultiplier, 2);
  assert.equal(character.skills.autofire.level, 3);
  assert.equal(getSkillPointsSpent(character), 26 + 12);
});

test("creation validates exact pools and STAT limits", () => {
  const character = createEmptyCharacter("validation-test");
  character.identity.name = "V";
  Object.assign(character, addPrimaryRole(character, "solo"));
  character.stats = { INT: 6, REF: 7, DEX: 8, TECH: 5, COOL: 6, WILL: 7, LUCK: 4, MOVE: 6, BODY: 8, EMP: 5 };
  for (const id of Object.keys(character.skills)) character.skills[id].level = 0;
  for (const id of ["athletics", "brawling", "concentration", "conversation", "education", "evasion", "first_aid", "human_perception", "language", "local_expert", "perception", "persuasion", "stealth"]) character.skills[id].level = 2;
  character.skills.accounting.level = 6;
  character.skills.animal_handling.level = 6;
  character.skills.bureaucracy.level = 6;
  character.skills.business.level = 6;
  character.skills.composition.level = 6;
  character.skills.cryptography.level = 6;
  character.skills.deduction.level = 6;
  character.skills.gamble.level = 6;
  character.skills.library_search.level = 6;
  character.skills.science.level = 6;
  assert.equal(getSkillPointsSpent(character), 86);
  assert.equal(validateCharacterCreation(character).valid, true);
  character.stats.REF = 9;
  assert.equal(validateCharacterCreation(character).valid, false);
});

test("the catalog has the 66 official skills in their official categories", () => {
  assert.equal(Object.keys(skillDefinitions).length, 66);
  assert.deepEqual(Object.keys(skillDefinitions).filter((id) => skillDefinitions[id].costMultiplier === 2), ["pilot_air_vehicle", "martial_arts", "autofire", "heavy_weapons", "demolitions", "electronics_security", "paramedic"]);
  assert.equal(skillDefinitions.handgun.category, "ranged_weapon");
  assert.equal(skillDefinitions.paramedic.category, "technique");
});

test("the character has only the ten Cyberpunk RED STATs", () => {
  assert.deepEqual(statNames, ["INT", "REF", "DEX", "TECH", "COOL", "WILL", "LUCK", "MOVE", "BODY", "EMP"]);
});

test("attacks use the centralized Skill Base", () => {
  const character = characterWith(6, 4);
  const random = Math.random;
  Math.random = () => 0.4;
  try {
    const resolution = rollAttack(character, { type: "handgun", skillId: "handgun" });
    assert.ok("result" in resolution);
    if ("result" in resolution) assert.equal(resolution.result.total, 15);
  } finally { Math.random = random; }
});
test("Role starts at Rank 4 without consuming creation pools", () => {
  const base = createEmptyCharacter("role-test");
  const character = addPrimaryRole(base, "solo");
  assert.equal(character.roleAbilities[0].rank, 4);
  assert.equal(getCombatAwarenessTotal(character), 4);
  assert.equal(getCreationPointSummary(character).attributePointsRemaining, 42);
  assert.equal(getCreationPointSummary(character).skillPointsRemaining, 60);
});
test("Role rank rules, multiclass and IP are independent from skills", () => {
  let character = addPrimaryRole(createEmptyCharacter("ip-role-test"), "netrunner");
  assert.equal(getNetActionsPerTurn(4), 3);
  assert.equal(getNetActionsPerTurn(10), 5);
  assert.equal(getMakerSpecialtyPoints(4), 8);
  assert.equal(getMedicineSpecialtyPoints(4), 4);
  assert.equal(getRoleAbilityIPCost(5), 300);
  assert.equal(addMulticlassRole(character, "nomad")?.roleAbilities.at(-1)?.rank, 1);
  character = { ...character, ip: 300, progression: { improvementPoints: 300 } };
  const upgraded = spendIPOnRoleAbility(character, "netrunner");
  assert.equal(upgraded?.roleAbilities[0].rank, 5);
  assert.equal(upgraded?.ip, 0);
  assert.equal(getMotoSkillBonus(addMulticlassRole(addPrimaryRole(createEmptyCharacter("moto"), "nomad"), "solo") ?? addPrimaryRole(createEmptyCharacter("moto2"), "nomad")), 4);
});