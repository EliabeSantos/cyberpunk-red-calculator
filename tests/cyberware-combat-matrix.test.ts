import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyCharacter } from "../src/types/character.ts";
import { installCyberware } from "../src/lib/cyberware.ts";
import { rollAttack } from "../src/lib/attacks.ts";
import { rollDamage } from "../src/lib/damage.ts";
import { rollSkillCheck } from "../src/lib/skills.ts";
import { getCatalogItem } from "../src/data/items.ts";
import { toggleCyberwareActivation } from "../src/lib/cyberwareEffects.ts";
import type { AttackContext } from "../src/types/attack.ts";
import type { Character, Weapon } from "../src/types/character.ts";

type WeaponSpec = Weapon;

/** Monta o cenário: atributos fixos, implantes instalados direto (sem validação de requisito) e armas. */
function buildCharacter(implants: string[], body: number, weapons: WeaponSpec[] = []): Character {
  const base = createEmptyCharacter(`matrix-${implants.join("-") || "plain"}`);
  let character: Character = { ...base, stats: { ...base.stats, INT: 5, REF: 5, DEX: 5, BODY: body } };
  for (const catalogId of implants) {
    const item = getCatalogItem(catalogId);
    assert.ok(item, `Item de catálogo inexistente: ${catalogId}`);
    character = installCyberware(character, {
      id: crypto.randomUUID(),
      catalogItemId: item.id,
      name: item.name,
      category: "cyberware",
      quantity: 1,
    }).character;
  }
  character.weapons = [...character.weapons, ...weapons];
  return character;
}

type Scenario = {
  name: string;
  implants: string[];
  body: number;
  weapon?: WeaponSpec;
  context: AttackContext;
  /** Expressão de dano esperada no resultado do ataque (é ela que o botão "Rolar Dano" usa). */
  expectedDamage: string;
  /** Modificadores esperados NO ATAQUE. Nenhum bônus de dano pode aparecer aqui. */
  expectedAttackModifiers: { source: string; value: number }[];
};

const SCENARIOS: Scenario[] = [
  {
    name: "Gorilla Arms → ataque de Brawling",
    implants: ["gorilla_arms"],
    body: 5,
    context: { type: "brawling", skillId: "brawling" },
    expectedDamage: "3d6", // BODY 5 = 2d6 base + 1d6 do Gorilla Arms
    expectedAttackModifiers: [{ source: "Gorilla Arms (brawling)", value: 2 }],
  },
  {
    name: "Gorilla Arms → ataque de Martial Arts",
    implants: ["gorilla_arms"],
    body: 5,
    context: { type: "martial_arts", skillId: "martial_arts" },
    expectedDamage: "3d6", // o +1d6 é de ataque desarmado, não da perícia
    expectedAttackModifiers: [], // o efeito declarado é "+2 Brawling": Martial Arts é outra perícia
  },
  {
    name: "sem implante → Brawling (linha de base)",
    implants: [],
    body: 5,
    context: { type: "brawling", skillId: "brawling" },
    expectedDamage: "2d6",
    expectedAttackModifiers: [],
  },
  {
    name: "Gorilla Arms → arma corpo a corpo",
    implants: ["gorilla_arms"],
    body: 5,
    weapon: { id: "w-melee", name: "Faca de Combate", damage: "2d6", skill: "melee_weapon", attackType: "melee" },
    context: { type: "weapon", weaponId: "w-melee" },
    expectedDamage: "2d6", // bônus desarmado não entra em arma
    expectedAttackModifiers: [],
  },
  {
    name: "Gorilla Arms → arma cuja perícia é Brawling",
    implants: ["gorilla_arms"],
    body: 5,
    weapon: { id: "w-brawl", name: "Cajado Pesado", damage: "2d6", skill: "brawling", attackType: "brawling" },
    context: { type: "weapon", weaponId: "w-brawl" },
    expectedDamage: "2d6", // o +2 é de perícia; o +1d6 é só de ataque desarmado
    expectedAttackModifiers: [{ source: "Gorilla Arms (brawling)", value: 2 }],
  },
  {
    name: "Targeting Scope → pistola",
    implants: ["targeting_scope"],
    body: 5,
    weapon: { id: "w-gun", name: "Heavy Pistol", damage: "3d6", skill: "handgun", attackType: "handgun" },
    context: { type: "weapon", weaponId: "w-gun" },
    expectedDamage: "3d6", // bônus de mira é só de ataque
    expectedAttackModifiers: [{ source: "Targeting Scope (longa distância)", value: 1 }],
  },
  {
    name: "Smart Weapon Link → arma smart",
    implants: ["smart_link"],
    body: 5,
    weapon: { id: "w-smart", catalogItemId: "smart_pistol", name: "Smart Pistol", damage: "2d6", skill: "handgun", attackType: "handgun" },
    context: { type: "weapon", weaponId: "w-smart" },
    expectedDamage: "2d6",
    expectedAttackModifiers: [{ source: "Smart Weapon Link (arma smart)", value: 1 }],
  },
  {
    name: "Targeting Scope + Gorilla Arms → pistola",
    implants: ["targeting_scope", "gorilla_arms"],
    body: 5,
    weapon: { id: "w-gun-2", name: "Heavy Pistol", damage: "3d6", skill: "handgun", attackType: "handgun" },
    context: { type: "weapon", weaponId: "w-gun-2" },
    expectedDamage: "3d6",
    expectedAttackModifiers: [{ source: "Targeting Scope (longa distância)", value: 1 }],
    // Gorilla Arms não pode aparecer: a arma não usa Brawling
  },
];

for (const scenario of SCENARIOS) {
  test(`ataque × dano: ${scenario.name}`, () => {
    const character = buildCharacter(scenario.implants, scenario.body, scenario.weapon ? [scenario.weapon] : []);
    const resolution = rollAttack(character, scenario.context);
    assert.ok("result" in resolution, `${scenario.name}: ${("error" in resolution && resolution.error) || "erro"}`);
    const result = resolution.result;

    // 1) O dano esperado é exatamente a expressão declarada — nada de bônus vaza para cá.
    assert.strictEqual(result.damageDice, scenario.expectedDamage, `${scenario.name}: expressão de dano`);

    // 1b) Decomposição do dano: existe só no ataque desarmado (é lá que entra bônus de cyberware).
    if (scenario.weapon) {
      assert.strictEqual(result.damageSources, undefined, `${scenario.name}: arma não tem decomposição`);
    } else {
      assert.ok(result.damageSources && result.damageSources.length > 0, `${scenario.name}: faltou a decomposição`);
    }

    // 2) Os modificadores do ATAQUE são exatamente os esperados — nada de dado de dano vaza para cá.
    assert.deepStrictEqual(result.modifiers, scenario.expectedAttackModifiers, `${scenario.name}: modificadores do ataque`);

    // 3) Cada bônus conta UMA vez no total (stat + perícia + d10 + modificadores).
    const expectedTotal =
      result.stat.value +
      result.skill.value +
      result.roll.total +
      scenario.expectedAttackModifiers.reduce((sum, modifier) => sum + modifier.value, 0);
    assert.strictEqual(result.total, expectedTotal, `${scenario.name}: o bônus deve entrar uma única vez no total`);

    // 4) "Rolar Dano" rola os dados declarados de verdade — o +1d6 chega ao dano, não só ao rótulo.
    const damage = rollDamage(result);
    assert.ok(!("error" in damage), `${scenario.name}: rolagem de dano falhou`);
    const declaredDice = Number(scenario.expectedDamage.split("d")[0]);
    assert.strictEqual(damage.roll.rolls.length, declaredDice, `${scenario.name}: quantidade de dados do dano`);
    assert.strictEqual(damage.damageDice, scenario.expectedDamage, `${scenario.name}: dano usa a expressão do ataque`);
  });
}

test("Gorilla Arms: +2 de perícia entra no teste de perícia e não no dano", () => {
  const character = buildCharacter(["gorilla_arms"], 5);
  const check = rollSkillCheck(character, "brawling");
  assert.ok("result" in check);
  assert.strictEqual(check.result.totalModifier, 2);

  const resolution = rollAttack(character, { type: "brawling", skillId: "brawling" });
  assert.ok("result" in resolution);
  assert.ok(
    !resolution.result.modifiers.some((modifier) => modifier.value === 1 && modifier.source.includes("Gorilla Arms")),
    "O +1d6 de dano não pode aparecer como modificador de ataque",
  );
  assert.strictEqual(resolution.result.damageDice, "3d6", "O +2 de perícia não pode virar dado de dano");
});

test("bônus de perícia do cyberware só vale para a perícia declarada", () => {
  const casos: { id: string; skill: string; bonus: number; ativo?: boolean }[] = [
    { id: "gorilla_arms", skill: "brawling", bonus: 2 },
    { id: "audio_filter", skill: "perception", bonus: 2 },
    { id: "reinforced_tendons", skill: "athletics", bonus: 2 },
    { id: "combat_awareness", skill: "perception", bonus: 2, ativo: true },
    { id: "optical_camo", skill: "stealth", bonus: 4, ativo: true },
  ];

  for (const caso of casos) {
    let character = buildCharacter([caso.id], 5);
    if (caso.ativo) character = toggleCyberwareActivation(character, character.cyberware[0].id);

    const on = rollSkillCheck(character, caso.skill);
    assert.ok("result" in on, caso.id);
    assert.strictEqual(on.result.totalModifier, caso.bonus, `${caso.id}: o bônus deve valer em ${caso.skill}`);

    const off = rollSkillCheck(character, "education");
    assert.ok("result" in off, caso.id);
    assert.strictEqual(off.result.totalModifier, 0, `${caso.id}: vazou para uma perícia sem relação`);

    // Sem ativar, o efeito ativável não vale nada.
    if (caso.ativo) {
      const inactive = buildCharacter([caso.id], 5);
      const untouched = rollSkillCheck(inactive, caso.skill);
      assert.ok("result" in untouched, caso.id);
      assert.strictEqual(untouched.result.totalModifier, 0, `${caso.id}: efeito ativo sem ativar a peça`);
    }
  }
});

test("bônus de perícia não vaza para um ataque de outra perícia", () => {
  const character = buildCharacter(["gorilla_arms", "audio_filter", "reinforced_tendons"], 5);
  const resolution = rollAttack(character, { type: "brawling", skillId: "brawling" });
  assert.ok("result" in resolution);
  assert.deepStrictEqual(
    resolution.result.modifiers,
    [{ source: "Gorilla Arms (brawling)", value: 2 }],
    "Só o bônus da perícia usada no ataque pode aparecer",
  );
});

test("Armadura de cyberware não mexe em ataque nem em dano", () => {
  const character = buildCharacter(["subdermal_armor", "skin_weave"], 5);
  const resolution = rollAttack(character, { type: "brawling", skillId: "brawling" });
  assert.ok("result" in resolution);
  assert.deepStrictEqual(resolution.result.modifiers, [], "Proteção não é bônus de ataque");
  assert.strictEqual(resolution.result.damageDice, "2d6", "Proteção não altera o dano do próprio ataque");
});

test("Arma integrada (Mantis Blades) segue as mesmas regras: sem +2 e sem +1d6", () => {
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const character = buildCharacter(["mantis_blades"], 5);
    assert.strictEqual(character.weapons.length, 1);
    const weapon = character.weapons[0];

    const resolution = rollAttack(character, { type: "weapon", weaponId: weapon.id });
    assert.ok("result" in resolution);
    assert.strictEqual(resolution.result.damageDice, "3d6", "Dano é o da arma, sem bônus do Gorilla Arms");
    assert.deepStrictEqual(
      resolution.result.modifiers.filter((modifier) => modifier.source.includes("Gorilla")),
      [],
      "Arma integrada não usa Brawling",
    );
  } finally {
    Math.random = originalRandom;
  }
});

test("sem implante nenhum, o ataque não tem modificadores de cyberware", () => {
  const character = buildCharacter([], 5);
  const resolution = rollAttack(character, { type: "brawling", skillId: "brawling" });
  assert.ok("result" in resolution);
  assert.deepStrictEqual(resolution.result.modifiers, []);
});
