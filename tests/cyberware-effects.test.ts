import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyCharacter } from "../src/types/character.ts";
import { installCyberware, removeCyberware } from "../src/lib/cyberware.ts";
import { equipInventoryItem } from "../src/lib/inventory.ts";
import { rollSkillCheck } from "../src/lib/skills.ts";
import { rollAttack } from "../src/lib/attacks.ts";
import { applyReceivedDamage, rollFirstAid } from "../src/lib/damage.ts";
import { catalogItems, getCatalogItem } from "../src/data/items.ts";
import {
  getCyberwareBodySP,
  getCyberwareEvasionModifiers,
  getCyberwareInitiativeModifiers,
  getCyberwareMoveModifier,
  getInstalledCyberwareControls,
  ignoresWoundPenalty,
  runCyberwareAction,
  toggleCyberwareActivation,
  validateCyberwareInstall,
} from "../src/lib/cyberwareEffects.ts";
import type { Character, InventoryItem } from "../src/types/character.ts";

function cyberwareInventoryItem(catalogId: string): InventoryItem {
  const item = getCatalogItem(catalogId);
  assert.ok(item, `Item de catálogo inexistente: ${catalogId}`);
  return { id: crypto.randomUUID(), catalogItemId: item.id, name: item.name, category: "cyberware", quantity: 1 };
}

function withCatalog(catalogId: string): Character {
  const character = createEmptyCharacter(`char-${catalogId}`);
  const item = cyberwareInventoryItem(catalogId);
  return installCyberware(character, item).character;
}

/** Instala direto (sem passar pela validação de requisitos) para montar cenários. */
function installAll(character: Character, catalogIds: string[]): Character {
  return catalogIds.reduce(
    (current, catalogId) => installCyberware(current, cyberwareInventoryItem(catalogId)).character,
    character,
  );
}

function equippableInventoryItem(catalogId: string, category: "cyberware" | "weapon"): InventoryItem {
  const item = getCatalogItem(catalogId);
  assert.ok(item, `Item de catálogo inexistente: ${catalogId}`);
  return { id: crypto.randomUUID(), catalogItemId: item.id, name: item.name, category, quantity: 1 };
}

test("installCyberware guarda a referência ao catálogo do item instalado", () => {
  const character = withCatalog("gorilla_arms");
  assert.strictEqual(character.cyberware[0].catalogItemId, "gorilla_arms");
  assert.strictEqual(character.cyberware[0].isBorgware, false);
});

test("remover e reinstalar cyberware repete a Humanity Loss e mantém o catálogo", () => {
  const originalRandom = Math.random;
  Math.random = () => 0.5; // 2d6 → 4+4 = 8 de HL por instalação
  try {
    let character = createEmptyCharacter("reinstall");
    character.stats = { ...character.stats, EMP: 8 };
    character.humanity = { current: 80, max: 80 };

    character = installCyberware(character, cyberwareInventoryItem("skin_weave")).character;
    assert.strictEqual(character.humanity.max, 78);
    assert.strictEqual(character.humanity.current, 72); // 80 - 8

    character = removeCyberware(character, character.cyberware[0].id);
    assert.strictEqual(character.humanity.max, 80);
    assert.strictEqual(character.humanity.current, 72); // HL não é devolvida
    const backInInventory = character.inventory.find((item) => item.name === "Skin Weave");
    assert.ok(backInInventory, "Cyberware removido deve voltar ao inventário");
    assert.strictEqual(backInInventory!.catalogItemId, "skin_weave");

    character = installCyberware(character, backInInventory!).character;
    assert.strictEqual(character.humanity.max, 78); // uma peça instalada: -2
    assert.strictEqual(character.humanity.current, 64); // e a HL rola de novo (80 - 8 - 8)
  } finally {
    Math.random = originalRandom;
  }
});

test("cyberwares integrados viram arma na instalação e saem na remoção", () => {
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    let character = withCatalog("mantis_blades");
    assert.strictEqual(character.weapons.length, 1);
    const weapon = character.weapons[0];
    assert.strictEqual(weapon.name, "Mantis Blades");
    assert.strictEqual(weapon.damage, "3d6");
    assert.strictEqual(weapon.rateOfFire, 2);
    assert.strictEqual(weapon.skill, "melee_weapon");
    assert.strictEqual(weapon.attackType, "melee");
    assert.strictEqual(character.cyberware[0].integratedWeaponIds?.[0], weapon.id);

    character = removeCyberware(character, character.cyberware[0].id);
    assert.strictEqual(character.weapons.length, 0, "A arma integrada deve ser removida junto");
    assert.strictEqual(character.inventory[0].catalogItemId, "mantis_blades");
  } finally {
    Math.random = originalRandom;
  }
});

test("não instala cyberware que exige um pré-requisito ausente", () => {
  const character = createEmptyCharacter("requires");
  const inventoryItem = equippableInventoryItem("targeting_scope", "cyberware");
  character.inventory = [inventoryItem];

  const blocked = equipInventoryItem(character, inventoryItem.id);
  assert.ok(blocked && "error" in blocked, "Sem Cybereye a instalação deve falhar");
  assert.match(blocked!.error, /Cybereye/);
  assert.strictEqual(character.cyberware.length, 0);

  const withEye = installAll(character, ["cybereye"]);
  const inventoryItemAfter = withEye.inventory.find((item) => item.catalogItemId === "targeting_scope");
  assert.ok(inventoryItemAfter, "O item deve continuar no inventário quando a instalação falha");
  const allowed = equipInventoryItem(withEye, inventoryItemAfter!.id);
  assert.ok(allowed && "character" in allowed);
  assert.strictEqual(allowed!.character.cyberware.length, 2);
});

test("Cybereye aceita no máximo 2 aprimoramentos ópticos", () => {
  let character = createEmptyCharacter("slots");
  character = installAll(character, ["cybereye", "night_vision", "thermal_optics"]);

  const inventoryItem = equippableInventoryItem("targeting_scope", "cyberware");
  character.inventory = [inventoryItem];
  const blocked = equipInventoryItem(character, inventoryItem.id);
  assert.ok(blocked && "error" in blocked);
  assert.match(blocked!.error, /2 aprimoramentos/);
});

test("cyberware neural exige Neural Link instalado", () => {
  const character = createEmptyCharacter("neural");
  const inventoryItem = equippableInventoryItem("sandevistan", "cyberware");
  character.inventory = [inventoryItem];

  const blocked = equipInventoryItem(character, inventoryItem.id);
  assert.ok(blocked && "error" in blocked);
  assert.match(blocked!.error, /Neural Link/);

  const withLink = installAll(character, ["neural_link"]);
  const sandbox = withLink.inventory.find((item) => item.catalogItemId === "sandevistan");
  assert.ok(sandbox);
  const allowed = equipInventoryItem(withLink, sandbox!.id);
  assert.ok(allowed && "character" in allowed);
  assert.strictEqual(allowed!.character.cyberware.length, 2);
});

test("armas Smart só podem ser equipadas com Smart Weapon Link instalado", () => {
  const character = createEmptyCharacter("smart");
  const inventoryItem = equippableInventoryItem("smart_pistol", "weapon");
  character.inventory = [inventoryItem];

  const blocked = equipInventoryItem(character, inventoryItem.id);
  assert.ok(blocked && "error" in blocked);
  assert.match(blocked!.error, /Smart Weapon Link/);
  assert.strictEqual(character.weapons.length, 0);

  const withLink = installAll(character, ["smart_link"]);
  const pistol = withLink.inventory.find((item) => item.catalogItemId === "smart_pistol");
  assert.ok(pistol);
  const allowed = equipInventoryItem(withLink, pistol!.id);
  assert.ok(allowed && "character" in allowed);
  assert.strictEqual(allowed!.character.weapons.length, 1);
});

test("Gorilla Arms aplica +2 em Brawling e +1d6 no ataque desarmado", () => {
  const character = withCatalog("gorilla_arms");
  character.stats = { ...character.stats, DEX: 5 };
  character.skills.brawling.level = 3;

  const check = rollSkillCheck(character, "brawling");
  assert.ok("result" in check);
  assert.strictEqual(check.result.totalModifier, 2, "Bônus do cyberware deve entrar no total");
  assert.ok(
    check.result.totalModifier > 0 &&
      check.character.rollHistory[0].modifiers?.some((modifier) => modifier.source === "Cyberware (Gorilla Arms)"),
    "O histórico deve creditar o bônus ao cyberware",
  );

  const attack = rollAttack(character, { type: "brawling", skillId: "brawling" });
  assert.ok("result" in attack);
  assert.strictEqual(attack.result.damageDice, "2d6", "BODY 2 (1d6) + Gorilla Arms (+1d6)");
  assert.ok(attack.result.modifiers.some((modifier) => modifier.source === "Gorilla Arms (brawling)"));
});

test("Audio Filter aplica +2 em Percepção", () => {
  const character = withCatalog("audio_filter");
  character.stats = { ...character.stats, INT: 5 };
  const resolution = rollSkillCheck(character, "perception");
  assert.ok("result" in resolution);
  assert.strictEqual(resolution.result.totalModifier, 2);
  assert.ok(resolution.character.rollHistory[0].modifiers?.some((modifier) => modifier.source === "Cyberware (Audio Filter)"));
});

test("Reinforced Tendons aplica +2 em Athletics (testes de salto)", () => {
  const character = withCatalog("reinforced_tendons");
  character.stats = { ...character.stats, DEX: 5 };
  const resolution = rollSkillCheck(character, "athletics");
  assert.ok("result" in resolution);
  assert.strictEqual(resolution.result.totalModifier, 2);

  // Efeito é específico de salto: outras perícias não recebem nada
  const unrelated = rollSkillCheck(character, "stealth");
  assert.ok("result" in unrelated);
  assert.strictEqual(unrelated.result.totalModifier, 0);
});

test("Targeting Scope dá +1 em ataques à distância", () => {
  const character = withCatalog("targeting_scope");
  character.stats = { ...character.stats, REF: 6 };
  character.weapons = [{ id: "w1", catalogItemId: "heavy_pistol", name: "Heavy Pistol", damage: "3d6", skill: "handgun", attackType: "handgun" }];

  const resolution = rollAttack(character, { type: "handgun", weaponId: "w1" });
  assert.ok("result" in resolution);
  assert.ok(resolution.result.modifiers.some((modifier) => modifier.source === "Targeting Scope (longa distância)" && modifier.value === 1));

  const unarmed = rollAttack(character, { type: "brawling", skillId: "brawling" });
  assert.ok("result" in unarmed);
  assert.ok(
    !unarmed.result.modifiers.some((modifier) => modifier.source.includes("Targeting Scope")),
    "Ataque corpo a corpo não deve receber o bônus de mira",
  );
});

test("Subdermal Armor protege o corpo mesmo com armadura equipada (não acumula)", () => {
  let character = createEmptyCharacter("subdermal");
  character.combat.hp = { current: 40, max: 40 };
  character.combat.armor = { head: 0, body: 5 };
  character = installAll(character, ["subdermal_armor"]);

  assert.strictEqual(getCyberwareBodySP(character), 11);

  const resolution = applyReceivedDamage(character, 10, "body");
  assert.ok("character" in resolution);
  assert.strictEqual(resolution.result.damageAbsorbed, 10);
  assert.strictEqual(resolution.result.damageToHP, 0);
  assert.strictEqual(resolution.character.combat.hp.current, 40, "Nenhum dano deve passar");
  assert.strictEqual(resolution.character.combat.armor.body, 5, "Só a armadura equipada abate");
});

test("Skin Weave protege o corpo quando não há armadura", () => {
  let character = createEmptyCharacter("skin");
  character.combat.hp = { current: 40, max: 40 };
  character.combat.armor = { head: 0, body: 0 };
  character = installAll(character, ["skin_weave"]);

  const resolution = applyReceivedDamage(character, 6, "body");
  assert.ok("character" in resolution);
  assert.strictEqual(resolution.result.damageAbsorbed, 6);
  assert.strictEqual(resolution.character.combat.hp.current, 40);
  assert.strictEqual(resolution.character.combat.armor.body, 0);

  const penetration = applyReceivedDamage(character, 12, "body");
  assert.ok("character" in penetration);
  assert.strictEqual(penetration.result.damageToHP, 5);
  assert.strictEqual(penetration.character.combat.hp.current, 35);
});

test("validateCyberwareInstall deixa passar cyberware sem pré-requisito", () => {
  const character = createEmptyCharacter("plain");
  assert.strictEqual(validateCyberwareInstall(character, getCatalogItem("cyberarm")!), null);
});

test("todo cyberware com sp no catálogo declara o mesmo valor em body_sp", () => {
  const cyberwareWithSP = catalogItems.filter((item) => item.category === "cyberware" && typeof item.sp === "number");
  assert.ok(cyberwareWithSP.length > 0, "Esperávamos cyberware de proteção no catálogo");
  for (const item of cyberwareWithSP) {
    const modifier = item.modifiers?.find((entry) => entry.type === "body_sp");
    assert.ok(modifier, `${item.id} tem sp mas nenhum modificador body_sp`);
    assert.strictEqual(modifier!.value, item.sp, `${item.id}: sp e body_sp divergem`);
  }
});

/* ------------------------------- Fase 2: ativação ------------------------------- */

test("toggle de ativação percorre os estágios e volta para inativo", () => {
  const character = withCatalog("adrenaline_booster");
  const cyberwareId = character.cyberware[0].id;

  assert.strictEqual(character.cyberware[0].activeStage, undefined);
  const first = toggleCyberwareActivation(character, cyberwareId);
  assert.strictEqual(first.cyberware[0].activeStage, 0);
  const second = toggleCyberwareActivation(first, cyberwareId);
  assert.strictEqual(second.cyberware[0].activeStage, 1);
  const back = toggleCyberwareActivation(second, cyberwareId);
  assert.strictEqual(back.cyberware[0].activeStage, undefined);
});

test("cyberware ativado sem efeito não muda nada enquanto está inativo", () => {
  const character = withCatalog("sandevistan");
  assert.strictEqual(getCyberwareInitiativeModifiers(character).length, 0);
  assert.strictEqual(getCyberwareEvasionModifiers(character).length, 0);

  const active = toggleCyberwareActivation(character, character.cyberware[0].id);
  const initiative = getCyberwareInitiativeModifiers(active).reduce((sum, item) => sum + item.value, 0);
  const evasion = getCyberwareEvasionModifiers(active).reduce((sum, item) => sum + item.value, 0);
  assert.strictEqual(initiative, 4, "Sandevistan ativo: +4 Iniciativa");
  assert.strictEqual(evasion, 1, "Sandevistan ativo: +1 em testes de reação (Evasão)");
});

test("Combat Awareness Processor dá +2 Percepção só enquanto ativado", () => {
  const character = withCatalog("combat_awareness");
  character.stats = { ...character.stats, INT: 5 };

  const off = rollSkillCheck(character, "perception");
  assert.ok("result" in off);
  assert.strictEqual(off.result.totalModifier, 0);

  const active = toggleCyberwareActivation(character, character.cyberware[0].id);
  const on = rollSkillCheck(active, "perception");
  assert.ok("result" in on);
  assert.strictEqual(on.result.totalModifier, 2);
  assert.ok(on.character.rollHistory[0].modifiers?.some((modifier) => modifier.source === "Cyberware (Combat Awareness Processor)"));
});

test("Adrenaline Booster: impulso dá MOVE +2 e rescaldo aplica -1 em testes físicos", () => {
  const character = withCatalog("adrenaline_booster");
  character.stats = { ...character.stats, DEX: 5, INT: 5 };
  const cyberwareId = character.cyberware[0].id;

  assert.strictEqual(getCyberwareMoveModifier(character), 0, "Inativo: MOVE base");

  const boost = toggleCyberwareActivation(character, cyberwareId);
  assert.strictEqual(getCyberwareMoveModifier(boost), 2, "Estágio 1: +2 MOVE");
  const boostPhysical = rollSkillCheck(boost, "athletics");
  assert.ok("result" in boostPhysical);
  assert.strictEqual(boostPhysical.result.totalModifier, 0, "O rescaldo ainda não está ativo");

  const drawback = toggleCyberwareActivation(boost, cyberwareId);
  assert.strictEqual(getCyberwareMoveModifier(drawback), 0, "Estágio 2: MOVE volta ao normal");
  const physical = rollSkillCheck(drawback, "athletics");
  assert.ok("result" in physical);
  assert.strictEqual(physical.result.totalModifier, -1, "Rescaldo: -1 em teste físico");
  const mental = rollSkillCheck(drawback, "perception");
  assert.ok("result" in mental);
  assert.strictEqual(mental.result.totalModifier, 0, "Rescaldo não afeta teste não físico");
});

test("Pain Editor ativo ignora a penalidade de ferimento no First Aid", () => {
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const character = withCatalog("pain_editor");
    character.combat.hp = { current: 0, max: 40 };
    character.combat.isDead = false;

    assert.strictEqual(ignoresWoundPenalty(character), false);
    const wounded = rollFirstAid(character, 0);
    assert.ok("result" in wounded);

    const active = toggleCyberwareActivation(character, character.cyberware[0].id);
    assert.strictEqual(ignoresWoundPenalty(active), true);
    const ignoring = rollFirstAid(active, 0);
    assert.ok("result" in ignoring);

    assert.strictEqual(ignoring.result.total - wounded.result.total, 2, "O -2 de ferimento deve sumir enquanto ativo");
  } finally {
    Math.random = originalRandom;
  }
});

test("Nano Repair: ação bloqueada enquanto inativo e cura 2 HP", () => {
  const character = withCatalog("nano_repair");
  const cyberwareId = character.cyberware[0].id;

  const blocked = runCyberwareAction(character, cyberwareId);
  assert.ok("error" in blocked, "Sem ativar não pode curar");
  assert.match(blocked!.error, /Ative/);

  const active = toggleCyberwareActivation(character, cyberwareId);
  const hurt = { ...active, combat: { ...active.combat, hp: { current: 10, max: 32 } } };
  const healed = runCyberwareAction(hurt, cyberwareId);
  assert.ok("healed" in healed);
  assert.strictEqual(healed.healed, 2);
  assert.strictEqual(healed.character.combat.hp.current, 12);

  const nearlyFull = { ...active, combat: { ...active.combat, hp: { current: 31, max: 32 } } };
  const capped = runCyberwareAction(nearlyFull, cyberwareId);
  assert.ok("healed" in capped);
  assert.strictEqual(capped.healed, 1, "Não pode curar acima do máximo");
  assert.strictEqual(capped.character.combat.hp.current, 32);
});

test("Reflex Tuner expõe a ação de repetir Iniciativa só enquanto ativado", () => {
  const character = withCatalog("reflex_tuner");
  const [off] = getInstalledCyberwareControls(character);
  assert.strictEqual(off.action?.type, "reroll_initiative");
  assert.strictEqual(off.actionEnabled, false);

  const active = toggleCyberwareActivation(character, character.cyberware[0].id);
  const [on] = getInstalledCyberwareControls(active);
  assert.strictEqual(on.actionEnabled, true);
});

test("todo cyberware com activation declara estágios com nome", () => {
  const withActivation = catalogItems.filter((item) => item.category === "cyberware" && item.activation);
  assert.ok(withActivation.length >= 8, "Esperávamos pelo menos 8 cyberwares ativáveis");
  for (const item of withActivation) {
    assert.ok(item.activation!.stages.length > 0, `${item.id}: activation sem estágios`);
    for (const stage of item.activation!.stages) {
      assert.ok(stage.name.trim().length > 0, `${item.id}: estágio sem nome`);
    }
  }
});
