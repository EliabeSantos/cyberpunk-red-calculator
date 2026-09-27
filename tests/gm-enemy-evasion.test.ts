/**
 * Botão 💨 EVASÃO do cartão de inimigo na tela de GM/Encounters.
 *
 * Prova a fórmula pedida pelo Mestre: **Evasão = REF + nível da perícia
 * Evasion** somado ao 1d10 (explosão no 10, subtração no 1) — e que uma ficha
 * salva ANTIGA, gravada antes desta feature, continua rolando sem quebrar.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { EncounterData } from "../src/lib/gmStorage.ts";
import type { Enemy } from "../src/types/enemy.ts";

const { rollEvasion, getEvasionBase, getEnemyEvasionSkill } = await import("../src/lib/gmStorage.ts");

/** Participante de encontro com REF 7 e Evasão 5 → base 12. */
function encounter(
  participant: Partial<EncounterData["participants"][number]> = {},
): EncounterData {
  return {
    id: "encontro-1",
    name: "Emboscada",
    faction: "Maelstrom",
    enemyCount: 1,
    createdAt: "2026-09-27T10:00:00.000Z",
    participants: [
      {
        enemyId: "militante",
        id: "part-1",
        name: "Militante",
        archetype: "Gang",
        faction: "Maelstrom",
        level: 1,
        threatLevel: "low",
        hp: { current: 30, max: 30 },
        armor: { head: 11, body: 11 },
        conditions: [],
        isPlayer: false,
        weaponName: "Fuzil",
        weaponSkillId: "Shoulder Arms",
        weaponSkillName: "Shoulder Arms",
        refStat: 7,
        skillValue: 15,
        attackBase: 15,
        evasionSkillName: "Evasion",
        evasionSkillLevel: 5,
        damageExpression: "3d6",
        lastAttackRoll: null,
        lastDamageRoll: null,
        lastEvasionRoll: null,
        initiative: null,
        personalityTraits: [],
        ...participant,
      },
    ],
  };
}

test("a base da Evasão é REF + nível da perícia Evasion", () => {
  assert.equal(getEvasionBase({ refStat: 7, evasionSkillLevel: 5 }), 12);
  assert.equal(getEvasionBase({ refStat: 6, evasionSkillLevel: 11 }), 17);
  // Ficha salva antes da feature: sem o nível guardado, a base é o REF puro.
  assert.equal(getEvasionBase({ refStat: 7 }), 7);
});

test("a rolagem soma o d10 na base e guarda cada dado mostrado no cartão", () => {
  const original = encounter();
  const other = encounter({ id: "part-2", name: "Outro" });

  for (let i = 0; i < 300; i++) {
    const rolled = rollEvasion(
      { ...other, participants: [original.participants[0], other.participants[0]] },
      0,
    );
    const roll = rolled.participants[0].lastEvasionRoll;
    assert.ok(roll, "a rolagem fica registrada no participante");

    // Os dados listados são exatamente o d10 (com negativo no fumble).
    assert.equal(roll.diceTotal, roll.diceRolls.reduce((sum, value) => sum + value, 0));
    // Total = base (REF 7 + Evasão 5 = 12) + dados.
    assert.equal(roll.total, 12 + roll.diceTotal);
    // O vizinho não foi mexido.
    assert.equal(rolled.participants[1].lastEvasionRoll, null);
  }
});

test("ficha salva antiga, sem evasionSkillLevel, rola com REF puro", () => {
  const legacy = encounter({ evasionSkillName: undefined, evasionSkillLevel: undefined });
  const rolled = rollEvasion(legacy, 0);
  const roll = rolled.participants[0].lastEvasionRoll;
  assert.ok(roll);
  assert.equal(roll.total, 7 + roll.diceTotal, "base = REF, sem NaN nem erro");
});

test("crítico é o d10 natural 10 (explode) e falha é o natural 1 (subtrai)", () => {
  type EvasionRoll = { diceRolls: number[]; diceTotal: number; total: number; critical: boolean; fumble: boolean };
  let crit: EvasionRoll | null = null;
  let fumble: EvasionRoll | null = null;

  for (let i = 0; i < 5000 && (!crit || !fumble); i++) {
    const roll = rollEvasion(encounter(), 0).participants[0].lastEvasionRoll;
    if (roll?.critical && !crit) crit = roll;
    if (roll?.fumble && !fumble) fumble = roll;
  }

  assert.ok(crit, "em 5000 rolagens um d10 natural 10 aparece");
  assert.equal(crit.diceRolls[0], 10, "o crítico vem do d10 natural");
  assert.ok(crit.diceRolls.length > 1, "10 explode: entra dado extra");
  assert.equal(crit.total, 12 + crit.diceTotal);

  assert.ok(fumble, "em 5000 rolagens um d10 natural 1 aparece");
  assert.equal(fumble.diceRolls[0], 1, "a falha vem do d10 natural");
  assert.ok(fumble.diceRolls[1] < 0, "falso tiro subtrai um d10 (valor negativo)");
  assert.equal(fumble.total, 12 + fumble.diceTotal);
});

test("o nível da Evasão sai do bestiário ignorando maiúsculas", () => {
  const skill = (level: number) => ({ name: "Evasion", stat: "REF" as const, level });
  const base = {
    id: "x",
    schemaVersion: 1,
    createdAt: "2026-09-27T00:00:00Z",
    updatedAt: "2026-09-27T00:00:00Z",
    identity: { name: "Militante", archetype: "Gang", threatLevel: "low" as const },
    stats: { INT: 5, REF: 7, DEX: 6, TECH: 4, COOL: 5, WILL: 5, LUCK: 3, MOVE: 5, BODY: 6, EMP: 4 },
    skills: {},
    weapons: [],
    combat: { hp: { current: 30, max: 30 }, armor: { head: 11, body: 11 }, criticalInjuries: [] },
    conditions: [],
  };

  assert.deepEqual(getEnemyEvasionSkill({ ...(base as Enemy), skills: { Evasion: skill(5) } }), {
    name: "Evasion",
    level: 5,
  });
  assert.equal(
    getEnemyEvasionSkill({ ...(base as Enemy), skills: { evasion: skill(9) } }).level,
    9,
    "a chave vem do JSON como Evasion, mas a busca não liga para maiúsculas",
  );
  assert.equal(getEnemyEvasionSkill(base as Enemy).level, 0, "sem a perícia, nível 0 (base vira REF)");
});
