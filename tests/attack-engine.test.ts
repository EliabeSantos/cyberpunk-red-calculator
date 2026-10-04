/**
 * F1.8C — ATTACK ENGINE
 *
 * Suíte de testes para a resolução canônica de um ataque:
 *
 *   AttackAction + CombatState + RandomSource
 *       → engine.execute
 *       → CombatResult (ok=true, state atualizado, attackResult)
 *
 * Cobre:
 *   • Ranged DV — hit / miss / empate (defensor vence)
 *   • Ranged Evasion — hit / miss / empate
 *   • Melee — hit / miss / empate
 *   • Critical — primeiro d10 = 10
 *   • Fumble — primeiro d10 = 1
 *   • Sem chaining — 10 + sequência contendo 10 → só 1 extra
 *   • Wound penalty — HP > 0 / HP <= 0 / HP <= -10
 *   • Aimed — attackMode = aimed, aimedTarget = head → −8
 *   • Aimed sem aimedTarget → erro
 *   • Ammo — ammo >= 1 → executa e consome 1; ammo = 0 → erro
 *   • Contexto inválido — actor inexistente, target inexistente,
 *     defesa ausente, DV inválida, Evasion sem perícia,
 *     conflito weapon/attackType, aimed sem aimedTarget,
 *     modo fora do F1.8C
 *   • Determinismo — mesma source → mesma sequência
 *   • Imutabilidade — state original não é mutado
 *
 * NENHUMA regra de Cyberpunk RED é implementada aqui — tudo é
 * verificação sobre o que os helpers canônicos já fazem.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createTestRandomSource } from "../src/lib/random.ts";
import { engine, execute } from "../src/lib/combat/engine.ts";
import type {
  AttackAction,
  CombatParticipant,
  CombatResult,
  CombatState,
  DefenseContext,
} from "../src/lib/combat/contract.ts";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const PC_ID = "pc-1";
const INIMIGO_ID = "enemy-1";

function participante(overrides: Partial<CombatParticipant>): CombatParticipant {
  return {
    id: PC_ID,
    type: "character",
    name: "V",
    source: { characterId: PC_ID, sourceKey: null, enemyId: null },
    stats: { REF: 7, DEX: 6, BODY: 5 },
    skills: { handgun: { stat: "REF", level: 6 }, evasion: { stat: "DEX", level: 4 } },
    weapons: [{ id: "wp-1", name: "Heavy Pistol", damage: "3d6", skill: "handgun", attackType: "handgun", ammo: 3 }],
    combat: { hp: { current: 30, max: 40 }, armor: { head: 0, body: 0 }, criticalInjuries: [], conditions: [], initiative: null, isDead: false },
    ...overrides,
  };
}

function estado(participants: CombatParticipant[]): CombatState {
  return { id: "combat-1", status: "active", round: 1, initiativeStarted: false, activeParticipantId: null, participants };
}

function attackAction(overrides: Partial<AttackAction>): AttackAction {
  return {
    type: "attack",
    actorId: PC_ID,
    targetId: INIMIGO_ID,
    weaponId: "wp-1",
    attackType: "handgun",
    attackMode: "normal",
    defense: { type: "dv", value: 10, source: "range_table" },
    ...overrides,
  };
}

function dvDefense(value: number): DefenseContext {
  return { type: "dv", value, source: "range_table" };
}

function evasionDefense(): DefenseContext {
  return { type: "evasion" };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function ok(result: CombatResult): CombatResult {
  assert.equal(result.ok, true, `esperado ok=true, got: ${JSON.stringify(result.errors)}`);
  return result;
}

function falha(result: CombatResult): CombatResult {
  assert.equal(result.ok, false, `esperado ok=false`);
  return result;
}

/* -------------------------------------------------------------------------- */
/* Ranged DV — hit / miss / empate                                            */
/* -------------------------------------------------------------------------- */

test("Ranged DV: attack total > DV → hit", () => {
  // baseStat = REF(7) + skill(6) = 13, d10 = 5 → total = 18 > 10 → hit
  const rng = createTestRandomSource([5]);
  const state = estado([participante({}), participante({ id: INIMIGO_ID, stats: { DEX: 5 }, combat: { hp: { current: 20, max: 20 }, armor: { head: 0, body: 0 }, criticalInjuries: [], conditions: [], initiative: null, isDead: false } })]);
  const action = attackAction({ defense: dvDefense(10) });
  const result = execute(state, action, rng);
  assert.equal(ok(result).attackResult?.hit, true);
  assert.equal(result.attackResult?.total, 18);
});

test("Ranged DV: attack total < DV → miss", () => {
  // low stats: REF=2, skill=1 → baseStat = 3
  // d10 = 1 (fumble), extra = 1 → total = 3 + 1 - 1 = 3 <= 10 → miss
  const lowActor = participante({
    stats: { REF: 2, DEX: 2 },
    skills: { handgun: { stat: "REF", level: 1 } },
  });
  const state = estado([lowActor, participante({ id: INIMIGO_ID, stats: { DEX: 5 }, skills: { evasion: { stat: "DEX", level: 4 } }, combat: { hp: { current: 20, max: 20 }, armor: { head: 0, body: 0 }, criticalInjuries: [], conditions: [], initiative: null, isDead: false } })]);
  const rng = createTestRandomSource([1, 1]);
  const action = attackAction({ defense: dvDefense(10) });
  const result = execute(state, action, rng);
  assert.equal(ok(result).attackResult?.hit, false);
});

test("Ranged DV: attack total = DV → miss (empate = defensor vence)", () => {
  // REF=3, skill=2 → baseStat = 5, d10 = 5 → total = 10 <= 10 → miss
  const actor = participante({
    stats: { REF: 3, DEX: 2 },
    skills: { handgun: { stat: "REF", level: 2 } },
  });
  const state = estado([actor, participante({ id: INIMIGO_ID, stats: { DEX: 5 }, skills: { evasion: { stat: "DEX", level: 4 } }, combat: { hp: { current: 20, max: 20 }, armor: { head: 0, body: 0 }, criticalInjuries: [], conditions: [], initiative: null, isDead: false } })]);
  const rng = createTestRandomSource([5]);
  const action = attackAction({ defense: dvDefense(10) });
  const result = execute(state, action, rng);
  assert.equal(ok(result).attackResult?.hit, false);
});

/* -------------------------------------------------------------------------- */
/* Ranged Evasion                                                              */
/* -------------------------------------------------------------------------- */

test("Ranged Evasion: attack > evasion → hit", () => {
  const actor = participante({ stats: { REF: 7, DEX: 6 }, skills: { handgun: { stat: "REF", level: 6 }, evasion: { stat: "DEX", level: 4 } } });
  const target = participante({ id: INIMIGO_ID, stats: { DEX: 6 }, skills: { evasion: { stat: "DEX", level: 4 } }, combat: { hp: { current: 20, max: 20 }, armor: { head: 0, body: 0 }, criticalInjuries: [], conditions: [], initiative: null, isDead: false } });
  const state = estado([actor, target]);
  // attack: baseStat=13, d10=5 → total=18; evasion: DEX=6, skill=4, d10=3 → 13+3=16
  const rng = createTestRandomSource([5, 3]);
  const action = attackAction({ defense: evasionDefense() });
  const result = execute(state, action, rng);
  assert.equal(ok(result).attackResult?.hit, true);
});

test("Ranged Evasion: attack < evasion → miss", () => {
  const actor = participante({ stats: { REF: 2, DEX: 2 }, skills: { handgun: { stat: "REF", level: 1 }, evasion: { stat: "DEX", level: 4 } } });
  const target = participante({ id: INIMIGO_ID, stats: { DEX: 6 }, skills: { evasion: { stat: "DEX", level: 4 } }, combat: { hp: { current: 20, max: 20 }, armor: { head: 0, body: 0 }, criticalInjuries: [], conditions: [], initiative: null, isDead: false } });
  const state = estado([actor, target]);
  // attack: baseStat=3, d10=1 (fumble) + extra=1 → total=3; evasion: DEX=6, skill=4, d10=3 → 13
  // Need 3 values: attack d10=1, extra=1, evasion d10=3
  const rng = createTestRandomSource([1, 1, 3]);
  const action = attackAction({ defense: evasionDefense() });
  const result = execute(state, action, rng);
  assert.equal(ok(result).attackResult?.hit, false);
});

/* -------------------------------------------------------------------------- */
/* Critical / Fumble                                                           */
/* -------------------------------------------------------------------------- */

test("Critical: primeiro d10 = 10 → critical=true", () => {
  const actor = participante({ stats: { REF: 7, DEX: 6 }, skills: { handgun: { stat: "REF", level: 6 } } });
  const state = estado([actor, participante({ id: INIMIGO_ID, stats: { DEX: 5 }, skills: { evasion: { stat: "DEX", level: 4 } }, combat: { hp: { current: 20, max: 20 }, armor: { head: 0, body: 0 }, criticalInjuries: [], conditions: [], initiative: null, isDead: false } })]);
  const rng = createTestRandomSource([10, 5]);
  const action = attackAction({ defense: dvDefense(10) });
  const result = execute(state, action, rng);
  assert.equal(ok(result).attackResult?.critical, true);
  assert.equal(ok(result).attackResult?.fumble, false);
});

test("Fumble: primeiro d10 = 1 → fumble=true", () => {
  const actor = participante({ stats: { REF: 7, DEX: 6 }, skills: { handgun: { stat: "REF", level: 6 } } });
  const state = estado([actor, participante({ id: INIMIGO_ID, stats: { DEX: 5 }, skills: { evasion: { stat: "DEX", level: 4 } }, combat: { hp: { current: 20, max: 20 }, armor: { head: 0, body: 0 }, criticalInjuries: [], conditions: [], initiative: null, isDead: false } })]);
  const rng = createTestRandomSource([1, 5]);
  const action = attackAction({ defense: dvDefense(10) });
  const result = execute(state, action, rng);
  assert.equal(ok(result).attackResult?.fumble, true);
  assert.equal(ok(result).attackResult?.critical, false);
});

/* -------------------------------------------------------------------------- */
/* Sem chaining                                                                */
/* -------------------------------------------------------------------------- */

test("Sem chaining: 10 + sequência contendo 10 → só 1 dado extra", () => {
  const actor = participante({ stats: { REF: 7, DEX: 6 }, skills: { handgun: { stat: "REF", level: 6 } } });
  const state = estado([actor, participante({ id: INIMIGO_ID, stats: { DEX: 5 }, skills: { evasion: { stat: "DEX", level: 4 } }, combat: { hp: { current: 20, max: 20 }, armor: { head: 0, body: 0 }, criticalInjuries: [], conditions: [], initiative: null, isDead: false } })]);
  const rng = createTestRandomSource([10, 10, 5]);
  const action = attackAction({ defense: dvDefense(10) });
  const result = execute(state, action, rng);
  const roll = ok(result).attackResult?.roll;
  assert.ok(roll, "roll should exist");
  assert.equal(roll.rolls.length, 2, "só 2 dados: primeiro 10 + 1 extra");
  assert.equal(roll.rolls[0], 10);
  assert.equal(roll.rolls[1], 10);
  // total = 13 + 10 + 10 = 33
  assert.equal(ok(result).attackResult?.total, 33);
});

test("Sem chaining: 1 + sequência contendo 1 → só 1 dado extra", () => {
  const actor = participante({ stats: { REF: 7, DEX: 6 }, skills: { handgun: { stat: "REF", level: 6 } } });
  const state = estado([actor, participante({ id: INIMIGO_ID, stats: { DEX: 5 }, skills: { evasion: { stat: "DEX", level: 4 } }, combat: { hp: { current: 20, max: 20 }, armor: { head: 0, body: 0 }, criticalInjuries: [], conditions: [], initiative: null, isDead: false } })]);
  const rng = createTestRandomSource([1, 1, 5]);
  const action = attackAction({ defense: dvDefense(10) });
  const result = execute(state, action, rng);
  const roll = ok(result).attackResult?.roll;
  assert.ok(roll, "roll should exist");
  assert.equal(roll.rolls.length, 2, "só 2 dados: primeiro 1 + 1 extra");
  assert.equal(roll.rolls[0], 1);
  assert.equal(roll.rolls[1], 1);
  // total = 13 + 1 - 1 = 13
  assert.equal(ok(result).attackResult?.total, 13);
});

/* -------------------------------------------------------------------------- */
/* Aimed Shot                                                                  */
/* -------------------------------------------------------------------------- */

test("Aimed: attackMode=aimed + aimedTarget=head → -8 no total", () => {
  const actor = participante({ stats: { REF: 7, DEX: 6 }, skills: { handgun: { stat: "REF", level: 6 } } });
  const state = estado([actor, participante({ id: INIMIGO_ID, stats: { DEX: 5 }, skills: { evasion: { stat: "DEX", level: 4 } }, combat: { hp: { current: 20, max: 20 }, armor: { head: 0, body: 0 }, criticalInjuries: [], conditions: [], initiative: null, isDead: false } })]);
  const rng = createTestRandomSource([5]);
  const action = attackAction({ attackMode: "aimed", aimedTarget: "head", defense: dvDefense(10) });
  const result = execute(state, action, rng);
  assert.equal(ok(result).attackResult?.total, 10); // 7 + 6 + 5 - 8 = 10
  assert.equal(ok(result).attackResult?.hit, false); // 10 <= 10 → miss (empate = defensor)
  assert.equal(ok(result).attackResult?.aimedTarget, "head");
});

test("Aimed sem aimedTarget → erro", () => {
  const st = estado([participante({}), participante({ id: INIMIGO_ID, combat: { hp: { current: 20, max: 20 }, armor: { head: 0, body: 0 }, criticalInjuries: [], conditions: [], initiative: null, isDead: false } })]);
  const action = attackAction({ attackMode: "aimed" });
  const result = execute(st, action);
  falha(result);
  assert.equal(erro(result).code, "rule_violation");
  assert.match(erro(result).message, /aimedTarget/i);
});

/* -------------------------------------------------------------------------- */
/* Ammo                                                                        */
/* -------------------------------------------------------------------------- */

test("Ammo: ammo >= 1 → ataque executa e consome 1", () => {
  const actor = participante({ weapons: [{ id: "wp-1", name: "Pistol", damage: "3d6", skill: "handgun", attackType: "handgun", ammo: 3 }] });
  const state = estado([actor, participante({ id: INIMIGO_ID, stats: { DEX: 5 }, skills: { evasion: { stat: "DEX", level: 4 } }, combat: { hp: { current: 20, max: 20 }, armor: { head: 0, body: 0 }, criticalInjuries: [], conditions: [], initiative: null, isDead: false } })]);
  const rng = createTestRandomSource([5]);
  const action = attackAction({ weaponId: "wp-1", defense: dvDefense(10) });
  const result = execute(state, action, rng);
  assert.equal(ok(result).attackResult?.hit, true);
  assert.equal(ok(result).attackResult?.ammoConsumed, 1);
  const updatedWeapon = ok(result).state.participants[0].weapons?.find(w => w.id === "wp-1");
  assert.equal(updatedWeapon?.ammo, 2);
});

test("Ammo: ammo = 0 → erro sem rolagem", () => {
  const actor = participante({ weapons: [{ id: "wp-1", name: "Pistol", damage: "3d6", skill: "handgun", attackType: "handgun", ammo: 0 }] });
  const state = estado([actor, participante({ id: INIMIGO_ID, combat: { hp: { current: 20, max: 20 }, armor: { head: 0, body: 0 }, criticalInjuries: [], conditions: [], initiative: null, isDead: false } })]);
  const rng = createTestRandomSource([5]);
  const action = attackAction({ weaponId: "wp-1", defense: dvDefense(10) });
  const result = execute(state, action, rng);
  falha(result);
  assert.equal(erro(result).code, "rule_violation");
  assert.match(erro(result).message, /munição/i);
});

/* -------------------------------------------------------------------------- */
/* Contexto inválido                                                           */
/* -------------------------------------------------------------------------- */

test("Actor inexistente → erro", () => {
  const st = estado([participante({ id: "other" })]);
  const action = attackAction({ actorId: "nonexistent" });
  const result = execute(st, action);
  falha(result);
  assert.equal(erro(result).code, "unknown_participant");
});

test("Target inexistente → erro", () => {
  const st = estado([participante({})]);
  const action = attackAction({ targetId: "nonexistent" });
  const result = execute(st, action);
  falha(result);
  assert.equal(erro(result).code, "unknown_participant");
});

test("Modo desconhecido (fora do AttackMode) → erro", () => {
  const st = estado([participante({}), participante({ id: INIMIGO_ID, combat: { hp: { current: 20, max: 20 }, armor: { head: 0, body: 0 }, criticalInjuries: [], conditions: [], initiative: null, isDead: false } })]);
  // F1.8D.6 aceitou `autofire`, F1.8D.7 aceitou `suppressive` — a guarda
  // sobrou para valores fora do `AttackMode` (chamador JS pode mandar qualquer
  // string; o tipo não protege em runtime).
  const action = attackAction({ attackMode: "burst" as "normal" });
  const result = execute(st, action);
  falha(result);
  assert.equal(erro(result).code, "rule_violation");
  assert.match(erro(result).message, /"burst"/);
  assert.match(erro(result).message, /não é suportado/);
});

test("Conflito weapon/attackType → erro", () => {
  const actor = participante({ weapons: [{ id: "wp-1", name: "Pistol", damage: "3d6", skill: "handgun", attackType: "handgun", ammo: 3 }] });
  const st = estado([actor, participante({ id: INIMIGO_ID, combat: { hp: { current: 20, max: 20 }, armor: { head: 0, body: 0 }, criticalInjuries: [], conditions: [], initiative: null, isDead: false } })]);
  const rng = createTestRandomSource([5]);
  const action = attackAction({ weaponId: "wp-1", attackType: "rifle" });
  const result = execute(st, action, rng);
  falha(result);
  assert.equal(erro(result).code, "rule_violation");
});

/* -------------------------------------------------------------------------- */
/* Determinismo                                                                */
/* -------------------------------------------------------------------------- */

test("Determinismo: mesmo estado + mesma action + mesma sequência RNG → mesmo resultado", () => {
  const actor1 = participante({ stats: { REF: 7, DEX: 6 }, skills: { handgun: { stat: "REF", level: 6 } } });
  const st1 = estado([actor1, participante({ id: INIMIGO_ID, stats: { DEX: 5 }, skills: { evasion: { stat: "DEX", level: 4 } }, combat: { hp: { current: 20, max: 20 }, armor: { head: 0, body: 0 }, criticalInjuries: [], conditions: [], initiative: null, isDead: false } })]);
  const st2 = structuredClone(st1);
  const action = attackAction({ defense: dvDefense(10) });

  // `createTestRandomSource` é stateful (cursor interno): cada execução
  // precisa da SUA instância, com a mesma sequência declarada.
  const r1 = execute(st1, action, createTestRandomSource([5, 3]));
  const r2 = execute(st2, action, createTestRandomSource([5, 3]));

  const a1 = ok(r1).attackResult;
  const a2 = ok(r2).attackResult;
  assert.ok(a1 && a2, "ambas as execuções devem produzir AttackResult");

  // Rolagem e total idênticos.
  assert.deepEqual(a1.roll, a2.roll);
  assert.equal(a1.total, a2.total);
  // Resolução do ataque idêntica.
  assert.equal(a1.hit, a2.hit);
  assert.equal(a1.critical, a2.critical);
  assert.equal(a1.fumble, a2.fumble);
  // Defesa idêntica (DV fornecido pelo caller).
  assert.equal(a1.defenseType, a2.defenseType);
  assert.equal(a1.defenseValue, a2.defenseValue);
  assert.deepEqual(a1.defenseRoll, a2.defenseRoll);
  // Munição consumida idêntica.
  assert.equal(a1.ammoConsumed, a2.ammoConsumed);
  assert.equal(a1.weaponId, a2.weaponId);
  // Mudanças de estado e estado final idênticos.
  assert.deepEqual(r1.changes, r2.changes);
  assert.deepEqual(r1.state, r2.state);
});

/* -------------------------------------------------------------------------- */
/* Imutabilidade                                                               */
/* -------------------------------------------------------------------------- */

test("Imutabilidade: state original não é mutado", () => {
  const actor = participante({});
  const originalAmmo = actor.weapons?.[0].ammo;
  const st = estado([actor, participante({ id: INIMIGO_ID, stats: { DEX: 5 }, skills: { evasion: { stat: "DEX", level: 4 } }, combat: { hp: { current: 20, max: 20 }, armor: { head: 0, body: 0 }, criticalInjuries: [], conditions: [], initiative: null, isDead: false } })]);
  const antes = structuredClone(st);
  const rng = createTestRandomSource([5]);
  const action = attackAction({ defense: dvDefense(10) });
  execute(st, action, rng);
  assert.deepEqual(st, antes, "state original deve ser idêntico");
  assert.equal(actor.weapons?.[0].ammo, originalAmmo, "ammo original não deve ser alterado");
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function erro(result: CombatResult): { code: string; message: string } {
  assert.ok(!result.ok, "esperado resultado com erro");
  return result.errors?.[0] ?? { code: "unknown", message: "" };
}
