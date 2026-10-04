/**
 * F1.8D.10 — AUDITORIA E UNIFICAÇÃO DO EVASION RESOLVER
 *
 * Esta suíte é a PROVA do resultado da auditoria (Resultado B — unificação
 * parcial):
 *
 *   • O DADO e a parte PASSIVA (cyberware de Evasão + lesão crítica) são a
 *     MESMA regra nos dois contextos do Combat Core — compartilhados pelo
 *     resolvedor `evasionPassiveModifiers` (engine.ts) e provados aqui:
 *     mesmo participante + mesmo sorteio → mesmo DiceResult e mesmo total.
 *
 *   • Os TOTALS continuam diferentes por regra legítima (fixado, não
 *     "corrigido"): o standalone soma `action.modifiers`, lesão de HP e
 *     cyberware `all_physical`; a defesa dentro do ataque (F1.8C congelado)
 *     não soma. Igualar seria alterar a etapa fechada.
 *
 *   • Política de erro idêntica (`EVASION_SKILL_MISSING`), com contagem de
 *     RNG em erro DIFERENTE por arquitetura: no ataque, o dado do ataque
 *     rola antes da checagem da defesa (ordem F1.8C).
 *
 *   • Não-mutação: nenhum dos caminhos toca o defensor; o standalone não
 *     toca estado algum.
 *
 * O caminho legado de Enemy (REF + evasionSkillLevel, `enemyAttacks.ts`)
 * continua fora do Combat Core e fora desta etapa.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createTestRandomSource } from "../src/lib/random.ts";
import { execute } from "../src/lib/combat/engine.ts";
import type {
  AttackAction,
  CombatParticipant,
  CombatResult,
  CombatState,
  DefenseContext,
  EvasionAction,
} from "../src/lib/combat/contract.ts";

/* -------------------------------------------------------------------------- *
 * Fixtures — dois contextos sobre o MESMO defensor coerente.
 * -------------------------------------------------------------------------- */

const ATACANTE_ID = "f18d10-atacante";
const DEFENSOR_ID = "f18d10-defensor";

const saudePadrao = {
  armor: { head: 0, body: 0 },
  cyberwareSP: { head: 0, body: 0 },
  criticalInjuries: [],
  conditions: [],
  initiative: null,
  isDead: false,
};

/** Defensor coerente: DEX 6, Evasion nível 4, 40/40 HP, sem cyberware. */
function defensor(overrides: Partial<CombatParticipant> = {}): CombatParticipant {
  return {
    id: DEFENSOR_ID,
    type: "character",
    name: "Alvo",
    source: { characterId: DEFENSOR_ID, sourceKey: null, enemyId: null },
    stats: { DEX: 6, REF: 5 },
    skills: { evasion: { stat: "DEX", level: 4 } },
    combat: { hp: { current: 40, max: 40 }, ...saudePadrao },
    ...overrides,
  };
}

function atacante(overrides: Partial<CombatParticipant> = {}): CombatParticipant {
  return {
    id: ATACANTE_ID,
    type: "character",
    name: "Atacante",
    source: { characterId: ATACANTE_ID, sourceKey: null, enemyId: null },
    stats: { REF: 7, DEX: 6 },
    skills: { handgun: { stat: "REF", level: 6 } },
    weapons: [{ id: "wp-1", name: "Heavy Pistol", damage: "3d6", skill: "handgun", attackType: "handgun", ammo: 5 }],
    combat: { hp: { current: 40, max: 40 }, ...saudePadrao },
    ...overrides,
  };
}

/** Estado inicial idêntico a cada chamada (não compartilha referências). */
function estado(defensorOverrides: Partial<CombatParticipant> = {}): CombatState {
  return {
    id: "f18d10-combat",
    status: "active",
    round: 1,
    initiativeStarted: true,
    activeParticipantId: ATACANTE_ID,
    participants: [atacante(), defensor(defensorOverrides)],
  };
}

function ataque(defense: DefenseContext): AttackAction {
  return {
    type: "attack",
    actorId: ATACANTE_ID,
    targetId: DEFENSOR_ID,
    weaponId: "wp-1",
    attackType: "handgun",
    attackMode: "normal",
    defense,
  };
}

function acao(overrides: Partial<EvasionAction> = {}): EvasionAction {
  return { type: "evasion", actorId: DEFENSOR_ID, ...overrides };
}

/* -------------------------------------------------------------------------- *
 * Helpers
 * -------------------------------------------------------------------------- */

function ok(result: CombatResult): CombatResult {
  assert.equal(result.ok, true, `esperava sucesso: ${JSON.stringify(result.errors)}`);
  return result;
}

function attackOk(result: CombatResult) {
  const r = ok(result);
  assert.ok(r.attackResult, "ataque resolvido vem com attackResult");
  return r.attackResult;
}

function evasionOk(result: CombatResult) {
  const r = ok(result);
  assert.ok(r.evasionResult, "evasão resolvida vem com evasionResult");
  return r.evasionResult;
}

/* ========================================================================== *
 * 1 — Equivalência no domínio comum + não-mutação + determinismo + regressão
 * ========================================================================== */

test("domínio comum: EvasionAction e defesa do ataque dão o MESMO DiceResult e o MESMO total", () => {
  const estadoAtaque = estado();
  const estadoEvasao = estado();
  const defensorAntes = structuredClone(estadoAtaque.participants[1]);
  const snapshotEvasao = structuredClone(estadoEvasao);

  // Caminho B (ataque): dado 1 = rolo do ataque (4); dado 2 = rolo da defesa (5).
  const resultadoAtaque = execute(estadoAtaque, ataque({ type: "evasion" }), createTestRandomSource([4, 5, 9]));
  // Caminho A (standalone): consome SÓ o rolo da defesa (5).
  const resultadoEvasao = execute(estadoEvasao, acao(), createTestRandomSource([5, 9]));

  const ar = attackOk(resultadoAtaque);
  const er = evasionOk(resultadoEvasao);

  // === Prova de equivalência (seção 12): mesmo sorteio, mesma matemática. ===
  assert.equal(ar.defenseType, "evasion");
  assert.deepEqual(ar.defenseRoll, er.roll, "mesmo DiceResult para o mesmo sorteio");
  assert.equal(ar.defenseValue, er.total, "mesmo valor matemático de Evasion");
  assert.equal(er.roll.total, 5, "defesa: 1d10 = 5");
  assert.equal(er.total, 15, "DEX 6 + Evasion 4 + d10 5 — domínio sem modificadores divergentes");
  assert.equal(ar.defenseValue, 15);

  // === Regressão do ataque (seção 15): os campos do F1.8C não mudaram. ===
  assert.equal(ar.total, 17, "REF 7 + handgun 6 + d10 4 + 0 mods");
  assert.equal(ar.hit, true, "17 > 15 — tie-break `attack > defense` inalterado");
  assert.equal(ar.critical, false);
  assert.equal(ar.fumble, false);
  assert.equal(ar.ammoConsumed, 1, "modo normal segue custando 1");

  // === Não-mutação (seção 14): o resolvedor só calcula. ===
  assert.deepEqual(estadoAtaque.participants[1], defensorAntes, "defensor intocado pela defesa");
  assert.deepEqual(estadoEvasao, snapshotEvasao, "standalone não muta estado algum");

  // === Determinismo (seção 13): mesma sequência → mesmo EvasionResult. ===
  const repeticao = execute(snapshotEvasao, acao(), createTestRandomSource([5, 9]));
  assert.deepEqual(evasionOk(repeticao).roll, er.roll);
  assert.equal(evasionOk(repeticao).total, er.total);
});

/* ========================================================================== *
 * 2 — Dado: explosão do 10 e fumble do 1 idênticos nos dois caminhos
 * ========================================================================== */

test("dado: explosão (10 → +1 dado) e fumble (1 → −1 dado) idênticos nos dois caminhos", () => {
  // (a) Explosão: defesa rola 10 e ganha 3 → "2d10" [10, 3] = 13.
  const atqExplosao = attackOk(
    execute(estado(), ataque({ type: "evasion" }), createTestRandomSource([4, 10, 3, 9])),
  );
  const evaExplosao = evasionOk(execute(estado(), acao(), createTestRandomSource([10, 3, 9])));
  assert.deepEqual(atqExplosao.defenseRoll, { expression: "2d10", rolls: [10, 3], total: 13 });
  assert.deepEqual(evaExplosao.roll, { expression: "2d10", rolls: [10, 3], total: 13 });
  assert.equal(atqExplosao.defenseValue, 23, "6 + 4 + 13");
  assert.equal(evaExplosao.total, 23, "6 + 4 + 13");
  assert.equal(atqExplosao.defenseValue, evaExplosao.total);

  // (b) Fumble: defesa rola 1 e perde 3 → "2d10" [1, 3] = −2.
  const atqFumble = attackOk(
    execute(estado(), ataque({ type: "evasion" }), createTestRandomSource([4, 1, 3, 9])),
  );
  const evaFumble = evasionOk(execute(estado(), acao(), createTestRandomSource([1, 3, 9])));
  assert.deepEqual(atqFumble.defenseRoll, { expression: "2d10", rolls: [1, 3], total: -2 });
  assert.deepEqual(evaFumble.roll, { expression: "2d10", rolls: [1, 3], total: -2 });
  assert.equal(atqFumble.defenseValue, 8, "6 + 4 − 2");
  assert.equal(evaFumble.total, 8, "6 + 4 − 2");
  assert.equal(atqFumble.defenseValue, evaFumble.total);
});

/* ========================================================================== *
 * 3 — Divergência de REGRA fixada: lesão de HP
 * ========================================================================== */

test("divergência REGRA (fixada, não corrigida): lesão de HP conta no standalone e não conta na defesa do ataque", () => {
  // HP 19/40 → Seriously Wounded → getWoundPenalty = −2.
  const ferido = { combat: { hp: { current: 19, max: 40 }, ...saudePadrao } };

  const ar = attackOk(execute(estado(ferido), ataque({ type: "evasion" }), createTestRandomSource([4, 5, 9])));
  const er = evasionOk(execute(estado(ferido), acao(), createTestRandomSource([5, 9])));

  assert.equal(ar.defenseValue, 15, "F1.8C congelado: defesa do ataque SEM penalidade de lesão");
  assert.equal(er.total, 13, "standalone = fórmula da ficha: −2 de Seriously Wounded");
  assert.equal(er.total, ar.defenseValue - 2, "a diferença EXATA é o wound penalty — dois contextos, duas regras (F1.8D.10)");
});

/* ========================================================================== *
 * 4 — Divergência de REGRA fixada: cyberware all_physical
 * ========================================================================== */

test("divergência REGRA (fixada, não corrigida): cyberware all_physical conta no standalone e não conta na defesa", () => {
  // Adrenaline Booster estágio 1 ("Rescaldo") = −1 em testes físicos.
  const comFisico = { cyberware: [{ name: "Adrenaline Booster", catalogItemId: "adrenaline_booster", activeStage: 1 }] };

  const ar = attackOk(execute(estado(comFisico), ataque({ type: "evasion" }), createTestRandomSource([4, 5, 9])));
  const er = evasionOk(execute(estado(comFisico), acao(), createTestRandomSource([5, 9])));

  assert.equal(ar.defenseValue, 15, "defesa do ataque não lê all_physical (F1.8C)");
  assert.equal(er.total, 14, "standalone lê all_physical (fórmula da ficha, F1.8D.9)");
  assert.equal(er.total, ar.defenseValue - 1, "diferença = exatamente o modificador físico");
});

/* ========================================================================== *
 * 5 — Divergência de ARQUITETURA: action.modifiers só existe no standalone
 * ========================================================================== */

test("divergência ARQUITETURA (fixada): action.modifiers é canal do standalone; DefenseContext não tem esse campo", () => {
  const ar = attackOk(execute(estado(), ataque({ type: "evasion" }), createTestRandomSource([4, 5, 9])));
  const er = evasionOk(
    execute(estado(), acao({ modifiers: [{ source: "Equipamento (+2)", value: 2 }] }), createTestRandomSource([5, 9])),
  );

  assert.equal(ar.defenseValue, 15, "defesa: DefenseContext = dv | evasion, sem modifiers (contrato intacto)");
  assert.equal(er.total, 17, "standalone: 15 + 2 do chamador");
  assert.equal(er.total, ar.defenseValue + 2, "a diferença é o canal de modifiers — arquitetura, não regra");
});

/* ========================================================================== *
 * 6 — Skill ausente: mesma recusa; consumo de RNG em erro difere por arquitetura
 * ========================================================================== */

test("skill ausente: mesma recusa nos dois caminhos; RNG em erro difere (ataque rola antes da defesa)", () => {
  const semSkill = { skills: {} };

  // Caminho A (standalone): toda validação antes do sorteio → 0 consumido.
  const rngA = createTestRandomSource([5, 9]);
  const resA = execute(estado(semSkill), acao(), rngA);
  assert.equal(resA.ok, false, "standalone recusa sem perícia");
  assert.deepEqual(resA.errors?.[0], { code: "rule_violation", message: "EVASION_SKILL_MISSING" });
  assert.equal(resA.evasionResult, undefined);
  assert.equal(rngA.d10(), 5, "standalone: nenhum valor consumido no erro");

  // Caminho B (ataque): ordem F1.8C — rolo do ataque ANTES da checagem da
  // defesa, então 1 valor já foi consumido quando a recusa chega.
  const rngB = createTestRandomSource([4, 9]);
  const resB = execute(estado(semSkill), ataque({ type: "evasion" }), rngB);
  assert.equal(resB.ok, false, "ataque recusa sem perícia no defensor");
  assert.deepEqual(resB.errors?.[0], { code: "rule_violation", message: "EVASION_SKILL_MISSING" });
  assert.equal(resB.attackResult, undefined);
  assert.equal(rngB.d10(), 9, "ataque: 1 dado (o do ataque) consumido antes da recusa — arquitetura congelada");
});
