/**
 * F1.3 — REGRA CANÔNICA de aplicação de dano (`src/lib/combat/damage.ts`).
 *
 * Antes desta etapa a mesma cadeia SP → absorção → degradação → HP estava
 * escrita em `src/lib/damage.ts` (duas vezes: dano manual e dano de ataque) e
 * em `src/lib/combat/enemyDamage.ts`. Este arquivo cobre a regra única e as
 * DIFERENÇAS DECLARADAS entre ficha e inimigo — as duas meias-SP, o clamp de
 * HP e quem derrota.
 *
 * Regra de ouro da etapa: nada aqui foi "consertado". Os testes fixam o
 * comportamento ATUAL, inclusive onde ele é estranho (F1.0 §13), para impedir
 * mudança acidental em etapas futuras:
 *
 *   · `ignoreArmor` do inimigo subtrai floor(SP/2) e degrada pelo SP cheio;
 *   · Artes Marciais subtrai ceil(SP/2) e degrada pelo SP já cortado;
 *   · quem perde 1 SP é sempre a VESTE, mesmo quando a subdérmica absorveu;
 *   · o inimigo trava em 0 HP e morre nele; a ficha aceita HP negativo e só
 *     morre no Death Save.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyCharacter } from "../src/types/character.ts";
import { applyReceivedDamage } from "../src/lib/damage.ts";
import * as enemyDamage from "../src/lib/combat/enemyDamage.ts";
import type { DamageTarget } from "../src/lib/combat/damage.ts";
import {
  applyDamage,
  effectiveArmorSP,
  isDefeatedBy,
  PLAYER_DAMAGE_POLICY,
  ENEMY_DAMAGE_POLICY,
} from "../src/lib/combat/damage.ts";
import type { EncounterData, EncounterParticipant } from "../src/types/encounter.ts";

/** Alvo padrão: 40 HP, sem proteção, vivo. */
function alvo(overrides: Partial<DamageTarget> = {}): DamageTarget {
  return { hp: 40, wornArmorSP: 0, cyberwareSP: 0, isDead: false, ...overrides };
}

/* -------------------------------------------------------------------------- *
 * Dano puro: nada de armadura / armadura que aguenta / excedente.
 * -------------------------------------------------------------------------- */

test("dano sem armadura chega inteiro no HP", () => {
  const out = applyDamage(alvo(), 12, ENEMY_DAMAGE_POLICY);
  assert.equal(out.damage, 12);
  assert.equal(out.armorSPBefore, 0);
  assert.equal(out.damageAbsorbed, 0);
  assert.equal(out.damageToHP, 12);
  assert.equal(out.hpBefore, 40);
  assert.equal(out.hpAfter, 28);
  assert.equal(out.wornArmorSPAfter, 0);
});

test("armadura que não foi penetrada segura o dano inteiro e não degrada", () => {
  const out = applyDamage(alvo({ wornArmorSP: 11 }), 5, ENEMY_DAMAGE_POLICY);
  assert.equal(out.damageAbsorbed, 5);
  assert.equal(out.damageToHP, 0, "nada chegou no HP");
  assert.equal(out.hpAfter, 40);
  assert.equal(out.wornArmorSPAfter, 11, "sem penetração não há -1 SP");
  assert.equal(out.armorSPAfter, 11);
});

test("dano exatamente igual ao SP também não penetra", () => {
  const out = applyDamage(alvo({ wornArmorSP: 11 }), 11, ENEMY_DAMAGE_POLICY);
  assert.equal(out.damageAbsorbed, 11);
  assert.equal(out.damageToHP, 0);
  assert.equal(out.hpAfter, 40);
  assert.equal(out.wornArmorSPAfter, 11, "a degradação exige passar do SP, não igualar");
});

test("dano excedente: HP perde o excedente e a veste perde 1 SP", () => {
  const out = applyDamage(alvo({ wornArmorSP: 11 }), 20, ENEMY_DAMAGE_POLICY);
  assert.equal(out.damageAbsorbed, 11);
  assert.equal(out.damageToHP, 9, "20 − 11");
  assert.equal(out.hpAfter, 31);
  assert.equal(out.wornArmorSPAfter, 10);
  assert.equal(out.armorSPAfter, 10);
});

/* -------------------------------------------------------------------------- *
 * As duas variantes de SP — reais, diferentes entre si e NÃO corrigidas.
 * -------------------------------------------------------------------------- */

test("`ignoreArmor` do inimigo: meia-SP para baixo e degradação pelo SP cheio", () => {
  // floor(11 / 2) = 5 abatidos; a degradação continua medindo o SP cheio (11).
  const raspou = applyDamage(alvo({ wornArmorSP: 11 }), 10, ENEMY_DAMAGE_POLICY, "ignore");
  assert.equal(raspou.armorSPBefore, 5, "floor(11/2)");
  assert.equal(raspou.damageToHP, 5, "10 − 5");
  assert.equal(raspou.hpAfter, 35);
  assert.equal(
    raspou.wornArmorSPAfter,
    11,
    "a veste não degrada com 10 de dano mesmo o HP levando 5 — comportamento atual (F1.0 §13)",
  );

  const penetrou = applyDamage(alvo({ wornArmorSP: 11 }), 12, ENEMY_DAMAGE_POLICY, "ignore");
  assert.equal(penetrou.damageToHP, 7);
  assert.equal(penetrou.wornArmorSPAfter, 10, "acima do SP cheio (11) a veste perde 1 SP");
});

test("Artes Marciais: meia-SP para cima e degradação pelo SP cortado", () => {
  const out = applyDamage(alvo({ wornArmorSP: 11 }), 12, PLAYER_DAMAGE_POLICY, "martial_arts_half");
  assert.equal(out.armorSPBefore, 6, "ceil(11/2)");
  assert.equal(out.damageAbsorbed, 6);
  assert.equal(out.damageToHP, 6, "12 − 6");
  assert.equal(out.spHalvedByMartialArts, true);
  assert.equal(out.wornArmorSPAfter, 10, "a ficha degrada acima do SP cortado (12 > 6)");

  const semArmadura = applyDamage(alvo({ wornArmorSP: 0 }), 10, PLAYER_DAMAGE_POLICY, "martial_arts_half");
  assert.equal(semArmadura.spHalvedByMartialArts, false, "SP 0 não é 'SP cortado'");
  assert.equal(semArmadura.damageToHP, 10);
});

test("as duas meias-SP divergem no mesmo dano — e nenhuma foi alterada no F1.3", () => {
  const ficha = applyDamage(alvo({ wornArmorSP: 11 }), 10, PLAYER_DAMAGE_POLICY, "martial_arts_half");
  const inimigo = applyDamage(alvo({ wornArmorSP: 11 }), 10, ENEMY_DAMAGE_POLICY, "ignore");

  assert.equal(ficha.armorSPBefore, 6, "ficha arredonda para cima");
  assert.equal(inimigo.armorSPBefore, 5, "inimigo arredonda para baixo");
  assert.equal(ficha.damageToHP, 4);
  assert.equal(inimigo.damageToHP, 5);
  assert.equal(ficha.wornArmorSPAfter, 10, "ficha degrada: 10 > 6");
  assert.equal(inimigo.wornArmorSPAfter, 11, "inimigo NÃO degrada: 10 ≤ 11 (SP cheio)");
});

test("SP efetivo: veste e cyberware nunca acumulam (vale o maior)", () => {
  assert.equal(effectiveArmorSP(0, 0), 0);
  assert.equal(effectiveArmorSP(5, 0), 5);
  assert.equal(effectiveArmorSP(0, 7), 7);
  assert.equal(effectiveArmorSP(4, 11), 11);
  assert.equal(effectiveArmorSP(11, 11), 11, "empate não soma");
  assert.equal(effectiveArmorSP(11, 0), 11);
});

/* -------------------------------------------------------------------------- *
 * POLÍTICA: as diferenças ficha × inimigo, explícitas.
 * -------------------------------------------------------------------------- */

test("política de HP: a ficha aceita HP negativo, o inimigo trava em 0", () => {
  const ficha = applyDamage(alvo({ hp: 5 }), 12, PLAYER_DAMAGE_POLICY);
  assert.equal(ficha.hpAfter, -7, "a ficha permite valores negativos");

  const inimigo = applyDamage(alvo({ hp: 5 }), 12, ENEMY_DAMAGE_POLICY);
  assert.equal(inimigo.hpAfter, 0, "o inimigo é clampeado em 0");
});

test("HP zero: derrota o inimigo, mas não muda a ficha (Death Save decide)", () => {
  const inimigo = applyDamage(alvo({ hp: 5 }), 5, ENEMY_DAMAGE_POLICY);
  assert.equal(inimigo.hpAfter, 0);
  assert.equal(inimigo.isDeadBefore, false);
  assert.equal(inimigo.isDeadAfter, true, "inimigo: hp <= 0 É a derrota");

  const ficha = applyDamage(alvo({ hp: 5 }), 5, PLAYER_DAMAGE_POLICY);
  assert.equal(ficha.hpAfter, 0, "0 HP é só Mortally Wounded");
  assert.equal(ficha.isDeadAfter, false, "ficha: o dano não mata, o Death Save mata");

  const jaMorta = applyDamage(alvo({ hp: 5, isDead: true }), 5, PLAYER_DAMAGE_POLICY);
  assert.equal(jaMorta.isDeadAfter, true, "a ficha preserva o isDead que já estava");
});

test("isDefeatedBy declara a mesma regra de derrota que a mesa espelha", () => {
  assert.equal(isDefeatedBy(ENEMY_DAMAGE_POLICY, 0, false), true);
  assert.equal(isDefeatedBy(ENEMY_DAMAGE_POLICY, -3, false), true);
  assert.equal(isDefeatedBy(ENEMY_DAMAGE_POLICY, 1, false), false, "cura acima de 0 volta a agir");
  assert.equal(isDefeatedBy(PLAYER_DAMAGE_POLICY, -10, false), false, "a ficha não morre por dano");
  assert.equal(isDefeatedBy(PLAYER_DAMAGE_POLICY, -10, true), true, "preserva o estado atual");
});

/* -------------------------------------------------------------------------- *
 * Cyberware (comportamento encontrado no F1.2, preservado de propósito).
 * -------------------------------------------------------------------------- */

test("cyberware SP: subdérmica vale mais que a veste e só a veste degrada", () => {
  const segurou = applyDamage(alvo({ wornArmorSP: 4, cyberwareSP: 11 }), 5, ENEMY_DAMAGE_POLICY);
  assert.equal(segurou.armorSPBefore, 11, "vale o maior, não soma");
  assert.equal(segurou.damageToHP, 0);
  assert.equal(segurou.wornArmorSPAfter, 4);

  const penetrou = applyDamage(alvo({ wornArmorSP: 4, cyberwareSP: 11 }), 20, ENEMY_DAMAGE_POLICY);
  assert.equal(penetrou.damageToHP, 9, "20 − 11");
  assert.equal(
    penetrou.wornArmorSPAfter,
    3,
    "PENDÊNCIA F1.3 / backlog: quem perde 1 SP é sempre a veste, " +
      "mesmo quando quem protegeu foi o cyberware. Mantido de propósito.",
  );
  assert.equal(penetrou.armorSPAfter, 11, "o SP de cyberware é constante");
});

/* -------------------------------------------------------------------------- *
 * Pureza: a regra não escreve no que recebe.
 * -------------------------------------------------------------------------- */

test("applyDamage não muta o alvo recebido", () => {
  const target = alvo({ hp: 40, wornArmorSP: 11, cyberwareSP: 5, isDead: false });
  const antes = structuredClone(target);

  const out = applyDamage(target, 30, ENEMY_DAMAGE_POLICY, "martial_arts_half");

  assert.deepEqual(target, antes, "o alvo original ficou idêntico");
  assert.equal(out.damageToHP, 24, "30 − ceil(11/2)");
  assert.equal(out.hpAfter, 16, "o estado novo está no resultado (40 − 24)");
  assert.equal(out.hpBefore, target.hp);
  assert.equal(out.isDeadBefore, target.isDead);
});

/* -------------------------------------------------------------------------- *
 * Os adaptadores continuam vendo a mesma regra.
 * -------------------------------------------------------------------------- */

function participante(overrides: Partial<EncounterParticipant> = {}): EncounterParticipant {
  return {
    enemyId: "recruit",
    id: "part-1",
    name: "Recruta",
    archetype: "Ranged Mook",
    faction: "6th Street",
    level: 1,
    threatLevel: "low",
    hp: { current: 40, max: 40 },
    armor: { head: 11, body: 11 },
    conditions: [],
    isPlayer: false,
    weaponName: "Heavy Pistol",
    weaponSkillId: "Handgun",
    weaponSkillName: "Handgun",
    refStat: 6,
    skillValue: 12,
    attackBase: 12,
    evasionSkillName: "Evasion",
    evasionSkillLevel: 5,
    damageExpression: "3d6",
    lastAttackRoll: null,
    lastDamageRoll: null,
    lastEvasionRoll: null,
    initiative: null,
    personalityTraits: [],
    ...overrides,
  };
}

function encontro(participant: EncounterParticipant): EncounterData {
  return {
    id: "enc-1",
    name: "Emboscada",
    faction: "6th Street",
    enemyCount: 1,
    participants: [participant],
    createdAt: "2026-10-03T00:00:00.000Z",
  };
}

test("ficha e inimigo calculam o mesmo número para o mesmo dano", () => {
  const character = createEmptyCharacter("canonico");
  character.combat.armor = { head: 11, body: 11 };
  character.combat.hp = { current: 40, max: 40 };

  const ficha = applyReceivedDamage(character, 20, "body");
  assert.ok(!("error" in ficha), "dano válido deve resolver");

  const origem = encontro(participante());
  const inimigo = enemyDamage.applyDamageToParticipant(origem, 0, 20, false, "body");

  assert.equal(
    ficha.result.armorSPBefore,
    enemyDamage.getParticipantArmorSP(origem.participants[0], "body"),
    "mesmo SP efetivo",
  );
  assert.equal(ficha.result.damageToHP, 9, "20 − 11 na ficha");
  assert.equal(inimigo.participants[0].hp.current, 31, "20 − 11 no inimigo");
  assert.equal(
    ficha.result.hpAfter,
    inimigo.participants[0].hp.current,
    "os dois adaptadores devolvem o mesmo HP",
  );
  assert.equal(ficha.result.armorSPAfter, inimigo.participants[0].armor.body, "mesma degradação");
  assert.equal(inimigo.participants[0].armor.head, 11, "só o local atingido é gravado");
});
