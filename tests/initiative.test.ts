import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyCharacter } from "../src/types/character.ts";
import { installCyberware } from "../src/lib/cyberware.ts";
import { getCatalogItem } from "../src/data/items.ts";
import { getInitiativeModifiers, rollInitiative } from "../src/lib/initiative.ts";
import { ignoresWoundPenalty, toggleCyberwareActivation } from "../src/lib/cyberwareEffects.ts";
import type { Character, CriticalInjury } from "../src/types/character.ts";

function withImplant(catalogId: string): Character {
  const item = getCatalogItem(catalogId);
  assert.ok(item, `Item de catálogo inexistente: ${catalogId}`);
  return installCyberware(createEmptyCharacter(`init-${catalogId}`), {
    id: crypto.randomUUID(),
    catalogItemId: item.id,
    name: item.name,
    category: "cyberware",
    quantity: 1,
  }).character;
}

function withHP(character: Character, hpCurrent: number): Character {
  return { ...character, combat: { ...character.combat, hp: { current: hpCurrent, max: 40 }, isDead: false } };
}

function withInjury(character: Character, injury: CriticalInjury): Character {
  return { ...character, combat: { ...character.combat, criticalInjuries: [injury] } };
}

const ALL_ACTIONS_INJURY: CriticalInjury = {
  roll: 3,
  name: "Lesão de teste",
  effect: "−2 em todas as ações",
  quickFix: "—",
  treatment: "—",
  bonusDamage: 5,
  location: "body",
  modifiers: [{ type: "all_actions", value: -2, description: "−2 em todas as ações" }],
};

function withSeededRandom<T>(seed: number, run: () => T): T {
  const originalRandom = Math.random;
  Math.random = () => seed;
  try {
    return run();
  } finally {
    Math.random = originalRandom;
  }
}

test("Iniciativa = REF + modificadores + d10, cada componente uma única vez", () => {
  withSeededRandom(0.42, () => {
    const base = createEmptyCharacter("init-base");
    const wounded = withHP(withInjury(base, ALL_ACTIONS_INJURY), 10);

    const outcome = rollInitiative(wounded);
    const { result } = outcome;
    const modifierSum = result.modifiers.reduce((sum, modifier) => sum + modifier.value, 0);

    assert.strictEqual(result.refBonus, base.stats.REF, "a base é o REF puro");
    assert.strictEqual(result.total, result.refBonus + result.diceTotal + modifierSum, "cada modificador conta uma vez");
    assert.ok(result.diceRolls.length >= 1 && result.diceRolls.length <= 2, "d10 com exploding");
    assert.strictEqual(
      outcome.character.rollHistory[0].label,
      "Iniciativa",
      "a rolagem entra no histórico",
    );
    assert.strictEqual(outcome.character.rollHistory[0].total, result.total, "histórico e resultado batem");
  });
});

test("Lesão grave dá −2 na Iniciativa e o Pain Editor ativo zera", () => {
  withSeededRandom(0.42, () => {
    const base = withImplant("pain_editor");
    const wounded = withHP(base, 10);

    assert.deepStrictEqual(
      getInitiativeModifiers(wounded),
      [{ source: "Lesão grave (HP)", value: -2 }],
      "a lista pura traz só a penalidade de lesão grave",
    );

    const off = rollInitiative(wounded).result;
    assert.ok(
      off.modifiers.some((modifier) => modifier.source === "Lesão grave (HP)" && modifier.value === -2),
      "o −2 aparece na lista e na fórmula",
    );
    assert.match(off.expression, /−2 Lesão grave \(HP\)|-2 Lesão grave \(HP\)/, "a fórmula da ficha mostra o −2");

    const active = toggleCyberwareActivation(wounded, wounded.cyberware[0].id);
    assert.strictEqual(ignoresWoundPenalty(active), true);
    const on = rollInitiative(active).result;
    assert.ok(
      !on.modifiers.some((modifier) => modifier.source === "Lesão grave (HP)"),
      "Pain Editor ativo: a penalidade sai",
    );
    assert.strictEqual(on.total - off.total, 2, "a diferença é exatamente 2");
  });
});

test("Critical Injury de 'todas as ações' também entra na Iniciativa", () => {
  withSeededRandom(0.42, () => {
    const injured = withInjury(createEmptyCharacter("init-injury"), ALL_ACTIONS_INJURY);
    const healthy = createEmptyCharacter("init-healthy");

    const result = rollInitiative(injured).result;
    assert.ok(
      result.modifiers.some((modifier) => modifier.source === "Todas ações (lesão)" && modifier.value === -2),
      "a lesão de todas as ações vale na Iniciativa",
    );
    assert.strictEqual(
      result.total,
      rollInitiative(healthy).result.total - 2,
      "personagem com a lesão rola 2 a menos",
    );
  });
});

test("Bônus de cyberware de Iniciativa continua valendo (Sandevistan +4)", () => {
  withSeededRandom(0.42, () => {
    const base = withImplant("sandevistan");
    const off = rollInitiative(base).result;
    assert.ok(
      !off.modifiers.some((modifier) => modifier.source.includes("Sandevistan")),
      "precisa estar ativo",
    );

    const active = toggleCyberwareActivation(base, base.cyberware[0].id);
    const on = rollInitiative(active).result;
    assert.ok(
      on.modifiers.some((modifier) => modifier.source.includes("Sandevistan") && modifier.value === 4),
      "Sandevistan ativo: +4",
    );
    assert.strictEqual(on.total - off.total, 4);
    assert.match(on.expression, /\+4 Sandevistan/);
  });
});
