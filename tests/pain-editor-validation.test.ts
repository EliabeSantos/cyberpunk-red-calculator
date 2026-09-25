import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyCharacter } from "../src/types/character.ts";
import { installCyberware } from "../src/lib/cyberware.ts";
import { rollSkillCheck } from "../src/lib/skills.ts";
import { rollAttack, rollEvasion } from "../src/lib/attacks.ts";
import { rollFirstAid } from "../src/lib/damage.ts";
import { getCatalogItem } from "../src/data/items.ts";
import { ignoresWoundPenalty, toggleCyberwareActivation } from "../src/lib/cyberwareEffects.ts";
import { calculateHPStatus, calculateWoundThreshold } from "../src/lib/calculations.ts";
import type { Character } from "../src/types/character.ts";

function withPainEditor(): Character {
  const item = getCatalogItem("pain_editor");
  assert.ok(item, "pain_editor não existe no catálogo");
  const character = createEmptyCharacter("pain-editor");
  return installCyberware(character, {
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

const PAIN_EDITOR_BRAWLING_CONTEXT = { type: "brawling" as const, skillId: "brawling" };

test("Pain Editor ativo remove o −2 de lesão grave da rolagem do First Aid", () => {
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const base = withPainEditor();
    const wounded = withHP(base, 0);
    assert.strictEqual(calculateHPStatus(0, 40, false), "mortally_wounded", "pré-condição: lesão grave");

    // Inativo: o −2 entra na conta.
    assert.strictEqual(ignoresWoundPenalty(wounded), false);
    const off = rollFirstAid(wounded, 0);
    assert.ok("result" in off);
    assert.strictEqual(off.result.injuryModifier, -2, "sem Pain Editor ativo a penalidade de lesão grave existe");

    // Ativo: o −2 sai da conta.
    const active = toggleCyberwareActivation(wounded, wounded.cyberware[0].id);
    assert.strictEqual(ignoresWoundPenalty(active), true);
    const on = rollFirstAid(active, 0);
    assert.ok("result" in on);
    assert.strictEqual(on.result.injuryModifier, 0, "Pain Editor ativo: a penalidade de lesão grave não é usada");
    assert.strictEqual(on.result.total - off.result.total, 2, "a diferença exata entre ligado e desligado é 2");

    // Desligar de volta devolve a penalidade.
    const toggledOff = toggleCyberwareActivation(active, active.cyberware[0].id);
    assert.strictEqual(ignoresWoundPenalty(toggledOff), false, "estágio ciclo → inativo devolve o −2");
    const again = rollFirstAid(toggledOff, 0);
    assert.ok("result" in again);
    assert.strictEqual(again.result.injuryModifier, -2);
  } finally {
    Math.random = originalRandom;
  }
});

test("Pain Editor ativo ignora só o −2 por HP — as Critical Injuries continuam valendo", () => {
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const base = withPainEditor();
    const injured: Character = {
      ...base,
      combat: {
        ...base.combat,
        criticalInjuries: [
          {
            roll: 7,
            name: "Lesão de teste",
            effect: "−2 em todas as ações",
            quickFix: "—",
            treatment: "—",
            bonusDamage: 5,
            location: "body",
            modifiers: [{ type: "all_actions", value: -2, description: "−2 em todas as ações" }],
          },
        ],
      },
    };
    const wounded = withHP(injured, 0);

    const off = rollFirstAid(wounded, 0);
    assert.ok("result" in off);
    assert.strictEqual(off.result.injuryModifier, -4, "HP (−2) + Critical Injury (−2) = −4");

    const active = toggleCyberwareActivation(wounded, wounded.cyberware[0].id);
    assert.strictEqual(ignoresWoundPenalty(active), true);
    const on = rollFirstAid(active, 0);
    assert.ok("result" in on);
    assert.strictEqual(on.result.injuryModifier, -2, "só o −2 de HP some; a Critical Injury permanece");
  } finally {
    Math.random = originalRandom;
  }
});

test("−2 de lesão grave em perícia, ataque e Evasão — e o Pain Editor ativo tira ele dos três", () => {
  const originalRandom = Math.random;
  Math.random = () => 0.42;
  try {
    const base = withPainEditor();
    assert.strictEqual(calculateWoundThreshold(40), 20);

    // HP 10 = Seriously Wounded, HP 0 = Mortally Wounded — ambos levam o −2.
    for (const hp of [10, 0]) {
      const wounded = withHP(base, hp);
      const healthy = withHP(base, 40);
      assert.notStrictEqual(
        calculateHPStatus(wounded.combat.hp.current, wounded.combat.hp.max, false),
        "normal",
        "pré-condição: personagem ferido",
      );

      // --- Sem o toggle: os três rolls levam −2 ---
      const skillHealthy = rollSkillCheck(healthy, "athletics");
      const skillWounded = rollSkillCheck(wounded, "athletics");
      assert.ok("result" in skillHealthy && "result" in skillWounded, `HP ${hp}: perícia falhou`);
      assert.strictEqual(
        skillWounded.result.total,
        skillHealthy.result.total - 2,
        `HP ${hp}: perícia deve levar −2 de lesão grave`,
      );

      const attackHealthy = rollAttack(healthy, PAIN_EDITOR_BRAWLING_CONTEXT);
      const attackWounded = rollAttack(wounded, PAIN_EDITOR_BRAWLING_CONTEXT);
      assert.ok("result" in attackHealthy && "result" in attackWounded, `HP ${hp}: ataque falhou`);
      assert.strictEqual(
        attackWounded.result.total,
        attackHealthy.result.total - 2,
        `HP ${hp}: ataque deve levar −2 de lesão grave`,
      );
      assert.ok(
        attackWounded.result.modifiers.some((modifier) => modifier.source === "Lesão grave (HP)" && modifier.value === -2),
        `HP ${hp}: o −2 precisa aparecer nos modificadores do ataque (a ficha mostra a tag)`,
      );

      const evasionHealthy = rollEvasion(healthy);
      const evasionWounded = rollEvasion(wounded);
      assert.ok("result" in evasionHealthy && "result" in evasionWounded, `HP ${hp}: evasão falhou`);
      assert.strictEqual(
        evasionWounded.result.total,
        evasionHealthy.result.total - 2,
        `HP ${hp}: Evasão deve levar −2 de lesão grave`,
      );
      assert.ok(
        evasionWounded.result.modifiers.some((modifier) => modifier.source === "Lesão grave (HP)" && modifier.value === -2),
        `HP ${hp}: o −2 precisa aparecer nos modificadores da Evasão`,
      );

      // --- Com o Pain Editor ativo: os três voltam ao valor do personagem saudável ---
      const active = toggleCyberwareActivation(wounded, wounded.cyberware[0].id);
      assert.strictEqual(ignoresWoundPenalty(active), true);

      const skillActive = rollSkillCheck(active, "athletics");
      assert.ok("result" in skillActive);
      assert.strictEqual(skillActive.result.total, skillHealthy.result.total, `HP ${hp}: perícia sem o −2`);

      const attackActive = rollAttack(active, PAIN_EDITOR_BRAWLING_CONTEXT);
      assert.ok("result" in attackActive);
      assert.strictEqual(attackActive.result.total, attackHealthy.result.total, `HP ${hp}: ataque sem o −2`);
      assert.ok(
        !attackActive.result.modifiers.some((modifier) => modifier.source === "Lesão grave (HP)"),
        `HP ${hp}: a tag some quando o toggle está ligado`,
      );

      const evasionActive = rollEvasion(active);
      assert.ok("result" in evasionActive);
      assert.strictEqual(evasionActive.result.total, evasionHealthy.result.total, `HP ${hp}: Evasão sem o −2`);
      assert.ok(
        !evasionActive.result.modifiers.some((modifier) => modifier.source === "Lesão grave (HP)"),
        `HP ${hp}: a tag some quando o toggle está ligado`,
      );
    }
  } finally {
    Math.random = originalRandom;
  }
});
