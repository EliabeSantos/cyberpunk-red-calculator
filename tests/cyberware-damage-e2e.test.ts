import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyCharacter } from "../src/types/character.ts";
import { installCyberware } from "../src/lib/cyberware.ts";
import { getAvailableAttacks, rollAttack } from "../src/lib/attacks.ts";
import { applyAttackDamage, rollDamageForLastAttack } from "../src/lib/damage.ts";
import { getCatalogItem } from "../src/data/items.ts";
import type { Character } from "../src/types/character.ts";

function withGorillaArms(body: number): Character {
  const base = createEmptyCharacter(`e2e-${body}`);
  const item = getCatalogItem("gorilla_arms");
  assert.ok(item);
  const character = installCyberware(
    { ...base, stats: { ...base.stats, BODY: body, DEX: 5, REF: 5 } },
    { id: crypto.randomUUID(), catalogItemId: item.id, name: item.name, category: "cyberware", quantity: 1 },
  ).character;
  character.skills.brawling.level = 2;
  character.skills.martial_arts.level = 2;
  character.combat.hp = { current: character.combat.hp.max, max: character.combat.hp.max };
  return character;
}

/** Reproduz exatamente o que a UI faz: lista de ataques → rolar ataque → rolar dano → aplicar. */
test("fluxo da UI: o +1d6 do Gorilla Arms chega à rolagem de dano", () => {
  for (const body of [2, 5, 7, 9]) {
    const originalRandom = Math.random;
    Math.random = () => 0.42;
    try {
      const character = withGorillaArms(body);
      // Escala oficial de dano por BODY: 1–4 = 1d6 · 5–6 = 2d6 · 7–10 = 3d6 · 11+ = 4d6.
      const expectedBase: Record<number, number> = { 2: 1, 5: 2, 7: 3, 9: 3 };
      const baseDice = expectedBase[body];
      const expected = `${baseDice + 1}d6`;

      for (const attackId of ["skill:brawling", "skill:martial_arts"]) {
        const available = getAvailableAttacks(character).find((attack) => attack.id === attackId);
        assert.ok(available, `${attackId} não aparece na lista de ataques`);

        const attack = rollAttack(character, available.context);
        assert.ok("result" in attack, `${attackId}: ataque falhou`);
        assert.strictEqual(attack.result.damageDice, expected, `${attackId} com BODY ${body}`);
        assert.deepStrictEqual(
          attack.result.damageSources,
          [`Base (BODY ${body}): ${baseDice}d6`, "Gorilla Arms: +1d6"],
          `${attackId}: a ficha deve mostrar de onde vêm os dados`,
        );

        // O botão "Rolar Dano" usa character.lastAttack
        const damage = rollDamageForLastAttack(attack.character);
        assert.ok("result" in damage, `${attackId}: dano falhou`);
        assert.strictEqual(damage.result.damageDice, expected, `${attackId}: expressão do dano`);
        assert.strictEqual(damage.result.roll.rolls.length, baseDice + 1, `${attackId}: dados rolados`);

        const applied = applyAttackDamage(damage.character, damage.result, "body");
        assert.ok("character" in applied, `${attackId}: aplicação falhou`);
        assert.strictEqual(
          applied.result.damageToHP,
          damage.result.total,
          `${attackId}: o total aplicado ao alvo deve ser o da rolagem`,
        );
      }
    } finally {
      Math.random = originalRandom;
    }
  }
});

test("sem Gorilla Arms o dano desarmado é o base (sem bônus)", () => {
  const originalRandom = Math.random;
  Math.random = () => 0.42;
  try {
    const character = createEmptyCharacter("e2e-plain");
    character.stats = { ...character.stats, BODY: 2 };
    character.skills.brawling.level = 2;

    const available = getAvailableAttacks(character).find((attack) => attack.id === "skill:brawling");
    assert.ok(available);
    const attack = rollAttack(character, available.context);
    assert.ok("result" in attack);
    assert.strictEqual(attack.result.damageDice, "1d6", "BODY 2 sem implante = 1d6");
    assert.deepStrictEqual(attack.result.damageSources, ["Base (BODY 2): 1d6"]);

    const damage = rollDamageForLastAttack(attack.character);
    assert.ok("result" in damage);
    assert.strictEqual(damage.result.roll.rolls.length, 1);
  } finally {
    Math.random = originalRandom;
  }
});

test("ataque com arma não recebe o +1d6 (é efeito de ataque desarmado)", () => {
  const originalRandom = Math.random;
  Math.random = () => 0.42;
  try {
    const character = withGorillaArms(5);
    character.weapons = [
      { id: "w-club", name: "Taco", damage: "2d6", skill: "melee_weapon", attackType: "melee" },
    ];
    const available = getAvailableAttacks(character).find((attack) => attack.context.weaponId === "w-club");
    assert.ok(available, "arma não aparece na lista de ataques");

    const attack = rollAttack(character, available.context);
    assert.ok("result" in attack);
    assert.strictEqual(attack.result.damageDice, "2d6", "dano é o da arma");
  } finally {
    Math.random = originalRandom;
  }
});
