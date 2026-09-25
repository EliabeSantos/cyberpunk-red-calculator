import assert from "node:assert/strict";
import test from "node:test";

import { getAvailableAttacks, rollAttack, rollEvasion } from "../src/lib/attacks.ts";
import { applyReceivedDamage, rollDamage } from "../src/lib/damage.ts";
import { getSkillBase } from "../src/lib/calculations.ts";
import { getAttributePointsRemaining, getCreationPointSummary, getSkillPointsSpent, validateCharacterCreation, validateCharacterEdit } from "../src/lib/characterCreation.ts";
import { skillDefinitions, MARTIAL_ARTS_FORMS, isPhysicalSkill } from "../src/data/skills.ts";
import { statNames, createEmptyCharacter } from "../src/types/character.ts";
import { catalogItems } from "../src/data/items.ts";
import { getItemForFree, getSellPrice, purchaseItem, sellInventoryItem } from "../src/lib/store.ts";
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

test("the catalog has the 66 official skills, the known extra and the 4 Martial Arts forms", () => {
  // 66 oficiais + `interface` (ainda em aberto na pendência nº 5) + as 4 formas de Martial Arts.
  const KNOWN_EXTRA_SKILLS = ["interface"];
  const MARTIAL_ARTS_FORM_SKILLS = 4;
  assert.equal(Object.keys(skillDefinitions).length, 66 + KNOWN_EXTRA_SKILLS.length + MARTIAL_ARTS_FORM_SKILLS);
  assert.deepEqual(Object.keys(skillDefinitions).filter((id) => skillDefinitions[id].costMultiplier === 2), ["pilot_air_vehicle", "martial_arts", "martial_arts_karate", "martial_arts_taekwondo", "martial_arts_judo", "martial_arts_aikido", "autofire", "heavy_weapons", "demolitions", "electronics_security", "paramedic"]);
  assert.equal(skillDefinitions.handgun.category, "ranged_weapon");
  assert.equal(skillDefinitions.paramedic.category, "technique");
  // As formas são perícias próprias de combate, físicas e não obrigatórias na criação.
  for (const form of MARTIAL_ARTS_FORMS) {
    assert.equal(skillDefinitions[form.skillId].category, "fighting");
    assert.equal(skillDefinitions[form.skillId].stat, "DEX");
    assert.equal(skillDefinitions[form.skillId].costMultiplier, 2);
    assert.equal(skillDefinitions[form.skillId].creation.required, false);
    assert.equal(isPhysicalSkill(form.skillId), true);
  }
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
test("Brawling is an unarmed attack only when its level is positive", () => {
  const character = createEmptyCharacter("brawling-test");
  character.skills.brawling.level = 0;
  assert.equal(getAvailableAttacks(character).some((attack) => attack.context.type === "brawling"), false);
  character.stats.DEX = 6;
  character.skills.brawling.level = 3;
  const brawling = getAvailableAttacks(character).find((attack) => attack.context.type === "brawling");
  assert.ok(brawling);
  const random = Math.random; Math.random = () => 0.4;
  try {
    const result = rollAttack(character, brawling!.context);
    assert.ok("result" in result);
    if ("result" in result) { assert.equal(result.result.total, 14); assert.equal(result.result.damageDice, "1d6"); assert.ok(!("error" in rollDamage(result.result))); }
  } finally { Math.random = random; }
});

test("Evasion uses Skill Base, records history, and does not alter HP", () => {
  const character = createEmptyCharacter("evasion-test");
  character.stats.DEX = 6; character.skills.evasion.level = 4;
  const hp = character.combat.hp.current;
  const random = Math.random; Math.random = () => 0.4;
  try {
    const result = rollEvasion(character);
    assert.ok("result" in result);
    if ("result" in result) { assert.equal(result.result.skillBase, 10); assert.equal(result.result.total, 15); assert.equal(result.character.combat.hp.current, hp); assert.equal(result.character.rollHistory[0].type, "evasion"); }
  } finally { Math.random = random; }
});

test("received damage allows negative HP and records before/after without rolling", () => {
  const character = createEmptyCharacter("damage-test");
  character.combat.hp = { current: 10, max: 40 };
  const result = applyReceivedDamage(character, 12);
  assert.ok("character" in result);
  if ("character" in result) { assert.equal(result.character.combat.hp.current, -2); assert.equal(result.character.combat.hp.max, 40); assert.deepEqual([result.character.rollHistory[0].amount, result.character.rollHistory[0].hpBefore, result.character.rollHistory[0].hpAfter], [12, 10, -2]); }
  assert.ok("error" in applyReceivedDamage(character, 0));
  assert.ok("error" in applyReceivedDamage(character, -5));
  assert.ok("error" in applyReceivedDamage(character, Number.NaN));
});
test("Martial Arts supplies central damage dice without a weapon", () => {
  const character = createEmptyCharacter("martial-test");
  character.skills.martial_arts.level = 4;
  const martial = getAvailableAttacks(character).find((attack) => attack.context.type === "martial_arts");
  assert.ok(martial); const result = rollAttack(character, martial!.context);
  // Escala oficial por BODY: createEmptyCharacter nasce com BODY 2 → 1d6
  // (pendência nº 6 resolvida: era a expectativa do teste que estava errada).
  assert.ok("result" in result); if ("result" in result) assert.equal(result.result.damageDice, "1d6");
});

test("localized armor absorbs damage and loses one SP only on penetration", () => {
  const character = createEmptyCharacter("armor-test"); character.combat.hp = { current: 40, max: 40 }; character.combat.armor = { head: 11, body: 11 };
  const absorbed = applyReceivedDamage(character, 8, "body"); assert.ok("character" in absorbed);
  if ("character" in absorbed) { assert.equal(absorbed.character.combat.hp.current, 40); assert.equal(absorbed.character.combat.armor.body, 11); }
  const penetrated = applyReceivedDamage(character, 15, "head"); assert.ok("character" in penetrated);
  if ("character" in penetrated) { assert.equal(penetrated.character.combat.hp.current, 36); assert.equal(penetrated.character.combat.armor.head, 10); assert.equal(penetrated.character.rollHistory[0].hitLocation, "head"); assert.equal(penetrated.character.rollHistory[0].damageAbsorbed, 11); assert.equal(penetrated.character.rollHistory[0].damageToHP, 4); }
});
test("creation retains the level-six Skill cap while edit accepts IP-evolved levels", () => {
  const character = addPrimaryRole(createEmptyCharacter("edit-validation"), "solo");
  character.identity.name = "V";
  character.skills.handgun.level = 7;
  assert.equal(validateCharacterCreation(character).errors.some((error) => error.includes("Handgun ultrapassou")), true);
  character.skills.handgun.level = 10;
  assert.equal(validateCharacterEdit(character).errors.some((error) => error.includes("Handgun")), false);
});

test("Evasion result exposes DEX, Skill Level, d10 and total for the UI", () => {
  const character = createEmptyCharacter("evasion-ui");
  character.stats.DEX = 7; character.skills.evasion.level = 6;
  const random = Math.random; Math.random = () => 0.7;
  try {
    const result = rollEvasion(character);
    assert.ok("result" in result);
    if ("result" in result) { assert.deepEqual(result.result.stat, { id: "DEX", value: 7 }); assert.deepEqual(result.result.skill, { id: "evasion", value: 6 }); assert.equal(result.result.naturalRoll, 8); assert.equal(result.result.total, 21); }
  } finally { Math.random = random; }
});
test("paid, free, and sale inventory flows share catalog prices safely", () => {
  const item = catalogItems.find((candidate) => candidate.price === 100) ?? catalogItems.find((candidate) => candidate.price > 0)!;
  const paidCharacter = createEmptyCharacter("paid-store"); paidCharacter.wallet.eurodollars = item.price;
  const purchase = purchaseItem(paidCharacter, item.id); assert.ok("character" in purchase);
  if ("character" in purchase) { assert.equal(purchase.character.wallet.eurodollars, 0); assert.equal(purchase.character.inventory[0].quantity, item.quantity ?? 1); }
  const freeCharacter = createEmptyCharacter("free-store"); freeCharacter.wallet.eurodollars = 100;
  const free = getItemForFree(freeCharacter, item.id); assert.ok("character" in free);
  if ("character" in free) { assert.equal(free.character.wallet.eurodollars, 100); assert.equal(free.character.inventory[0].quantity, item.quantity ?? 1); }
  const sellCharacter = free.character;
  const sold = sellInventoryItem(sellCharacter, sellCharacter.inventory[0].id); assert.ok("character" in sold);
  if ("character" in sold) { assert.equal(sold.character.wallet.eurodollars, 100 + getSellPrice(item.price)); assert.equal(sold.character.inventory.length, 0); }
});

test("sale validates quantity and never allows negative inventory", () => {
  const item = catalogItems.find((candidate) => candidate.price > 0)!;
  const character = getItemForFree(createEmptyCharacter("sale-quantity"), item.id); assert.ok("character" in character);
  if ("character" in character) { const failed = sellInventoryItem(character.character, character.character.inventory[0].id, character.character.inventory[0].quantity + 1); assert.deepEqual(failed, { error: "invalid-quantity" }); assert.equal(character.character.inventory[0].quantity, item.quantity ?? 1); }
  assert.equal(getSellPrice(50), 5); assert.equal(getSellPrice(100), 10); assert.equal(getSellPrice(500), 50); assert.equal(getSellPrice(1000), 100);
});