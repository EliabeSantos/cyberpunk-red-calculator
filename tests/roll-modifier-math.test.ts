import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyCharacter } from "../src/types/character.ts";
import { rollSkillCheck } from "../src/lib/skills.ts";
import { rollAttack } from "../src/lib/attacks.ts";
import type { Character, CriticalInjury, Weapon } from "../src/types/character.ts";

/** Personagem limpo com atributos fixos, perícia de ataque e sem lesão/HP baixo. */
function fighter(): Character {
  const base = createEmptyCharacter("math");
  return {
    ...base,
    stats: { ...base.stats, REF: 5, DEX: 5 },
    skills: { ...base.skills, brawling: { ...base.skills.brawling, level: 2 }, athletics: { ...base.skills.athletics, level: 2 } },
  };
}

function injured(character: Character, modifier: CriticalInjury["modifiers"][number]): Character {
  const injury: CriticalInjury = {
    roll: 4,
    name: "Lesão de teste",
    effect: modifier.description,
    quickFix: "—",
    treatment: "—",
    bonusDamage: 5,
    location: "body",
    modifiers: [modifier],
  };
  return { ...character, combat: { ...character.combat, criticalInjuries: [injury] } };
}

/** Identidade que a ficha promete ao jogador: STAT + perícia + d10 + modificadores. */
function attackTotalIsTheDisplayedSum(result: import("../src/types/attack.ts").AttackRollResult): number {
  return result.stat.value + result.skill.value + result.roll.total +
    result.modifiers.reduce((sum, modifier) => sum + modifier.value, 0);
}

test("perícia: a penalidade de STAT da lesão é contada UMA vez (bug 1)", () => {
  const character = injured(fighter(), { type: "stat", stat: "DEX", value: -2, description: "−2 em DEX" });

  const resolution = rollSkillCheck(character, "athletics");
  assert.ok("result" in resolution);
  const result = resolution.result;

  assert.strictEqual(result.statBase, 5, "o painel mostra o STAT base");
  assert.strictEqual(result.statValue, 3, "statValue continua sendo o STAT efetivo");
  assert.strictEqual(result.statModifier, -2);
  assert.strictEqual(result.totalModifier, -2, "o −2 é o único modificador");

  // É isso que a ficha desenha: STAT base + nível + d10 + Mod.
  assert.strictEqual(
    result.total,
    result.statBase + result.skillLevel + result.diceRoll + result.totalModifier,
    "a penalidade aparece uma única vez na soma",
  );
  assert.strictEqual(result.total, 5 - 2 + 2 + result.diceRoll, "nada de −2 aplicado em dobro");
});

test("ataque: context.modifiers conta uma vez (bug 2)", () => {
  const character = fighter();

  const resolution = rollAttack(character, {
    type: "brawling",
    skillId: "brawling",
    modifiers: [{ source: "Mira apontada", value: 2 }],
  });
  assert.ok("result" in resolution);
  const result = resolution.result;

  assert.deepStrictEqual(result.modifiers, [{ source: "Mira apontada", value: 2 }]);
  assert.strictEqual(
    result.total,
    attackTotalIsTheDisplayedSum(result),
    "context.modifiers entra no total uma única vez (era duas)",
  );
});

test("ataque: a penalidade de STAT da lesão conta uma vez e aparece como tag", () => {
  const character = injured(fighter(), { type: "stat", stat: "DEX", value: -2, description: "−2 em DEX" });

  const resolution = rollAttack(character, { type: "brawling", skillId: "brawling" });
  assert.ok("result" in resolution);
  const result = resolution.result;

  assert.strictEqual(result.stat.value, 5, "o STAT exibido é o base; a lesão vira tag");
  assert.ok(
    result.modifiers.some((modifier) => modifier.source === "STAT (lesão)" && modifier.value === -2),
    "a lesão de STAT aparece na lista de modificadores",
  );
  assert.strictEqual(result.total, attackTotalIsTheDisplayedSum(result));
  assert.strictEqual(result.total, 5 + 2 + result.roll.total - 2, "−2 uma vez só");
});

const RANGED_INJURY: CriticalInjury["modifiers"][number] = {
  type: "ranged",
  value: -2,
  description: "−2 em ataques à distância",
};
const MELEE_INJURY: CriticalInjury["modifiers"][number] = {
  type: "melee",
  value: -2,
  description: "−2 em ataques corpo a corpo",
};

function weapon(overrides: Partial<Weapon> & Pick<Weapon, "id" | "attackType" | "skill">): Weapon {
  return { name: overrides.id, damage: "2d6", ...overrides };
}

test("ataque com arma recebe lesão à distância / corpo a corpo (bugs 3 e 3b)", () => {
  const rangedCases: { label: string; weapon: Weapon }[] = [
    { label: "SMG (attackType 'smg' não existia na lista antiga)", weapon: weapon({ id: "w-smg", attackType: "smg", skill: "shoulder_arms" }) },
    { label: "pistola", weapon: weapon({ id: "w-gun", attackType: "handgun", skill: "handgun" }) },
    { label: "heavy weapon", weapon: weapon({ id: "w-heavy", attackType: "heavy_weapon", skill: "heavy_weapons" }) },
  ];

  for (const caso of rangedCases) {
    const character = injured(fighter(), RANGED_INJURY);
    character.weapons = [caso.weapon];

    const resolution = rollAttack(character, { type: "weapon", weaponId: caso.weapon.id });
    assert.ok("result" in resolution, `${caso.label}: ${("error" in resolution && resolution.error) || "erro"}`);
    const result = resolution.result;

    assert.ok(
      result.modifiers.some((modifier) => modifier.source === "Distância (lesão)" && modifier.value === -2),
      `${caso.label}: o ataque com arma deve levar a lesão de distância`,
    );
    assert.strictEqual(result.total, attackTotalIsTheDisplayedSum(result), `${caso.label}: total bate com o exibido`);
  }

  // Arma corpo a corpo com a MESMA lesão de distância não leva nada…
  const melee = weapon({ id: "w-melee", attackType: "melee", skill: "melee_weapon" });
  const meleeChar = injured(fighter(), RANGED_INJURY);
  meleeChar.weapons = [melee];
  const meleeResult = rollAttack(meleeChar, { type: "weapon", weaponId: melee.id });
  assert.ok("result" in meleeResult);
  assert.deepStrictEqual(meleeResult.result.modifiers, [], "lesão de distância não toca ataque corpo a corpo");

  // …mas leva a de corpo a corpo.
  const brawlChar = injured(fighter(), MELEE_INJURY);
  brawlChar.weapons = [melee];
  const brawlResult = rollAttack(brawlChar, { type: "weapon", weaponId: melee.id });
  assert.ok("result" in brawlResult);
  assert.ok(
    brawlResult.result.modifiers.some((modifier) => modifier.source === "Corpo a corpo (lesão)" && modifier.value === -2),
    "lesão de corpo a corpo vale no ataque com arma",
  );
  assert.strictEqual(brawlResult.result.total, attackTotalIsTheDisplayedSum(brawlResult.result));
});

test("sem lesão e sem contexto extra, o ataque não ganha modificador nenhum", () => {
  const character = fighter();
  const pistol = weapon({ id: "w-plain", attackType: "handgun", skill: "handgun" });
  character.weapons = [pistol];

  const resolution = rollAttack(character, { type: "weapon", weaponId: pistol.id });
  assert.ok("result" in resolution);
  assert.deepStrictEqual(resolution.result.modifiers, []);
  assert.strictEqual(resolution.result.total, attackTotalIsTheDisplayedSum(resolution.result));
});
