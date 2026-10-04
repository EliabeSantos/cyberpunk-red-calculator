/**
 * F1.8D.1 — DAMAGE ENGINE
 *
 * A segunda etapa do fluxo de combate, mantida SEPARADA da primeira:
 *
 *     AttackAction → Attack Engine → AttackResult (hit)
 *                                     ↓
 *                         DamageAction → Damage Engine → DamageResult
 *
 * O Attack Engine não resolve dano e o Damage Engine não decide acerto: esta
 * suíte cobre só o que a etapa de dano promete (§15 do plano F1.8D.1):
 *
 *   1. dano básico            — 10 de dano, 0 de armadura → 10 de HP perdido;
 *   2. redução de armadura    — 10 de dano, SP 4 → 6;
 *   3. armadura absorve tudo  — 5 de dano, SP 10 → 0;
 *   4. transição de HP        — hpBefore/hpAfter ↔ changes ↔ estado;
 *   5. wound penalty          — delegado à função canônica `getWoundPenalty`;
 *   6. HP negativo (player)   — política F1.3 preservada;
 *   7. clamp de HP (enemy)    — política F1.3 preservada;
 *   8. armor efetiva          — `max(veste, cyberware)` nos dois sentidos;
 *   9. dano inválido          — recusado, sem damageResult;
 *  10. validações             — actor/target inexistentes → CombatError;
 *  11. determinismo           — mesmas entradas, RNGs INDEPENDENTES;
 *  12. integração             — attack com hit → DamageAction → DamageResult.
 *
 * NENHUMA regra de Cyberpunk RED é escrita aqui: cada número esperado vem da
 * implementação canônica (`applyDamage`, `getWoundPenalty`, `effectiveArmorSP`)
 * ou da aritmética explícita do enunciado. Nada foi "corrigido" nesta etapa —
 * os testes fixam o comportamento ATUAL, inclusive as políticas assymétricas
 * de ficha × inimigo.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createTestRandomSource } from "../src/lib/random.ts";
import { engine, execute } from "../src/lib/combat/engine.ts";
import { effectiveArmorSP } from "../src/lib/combat/damage.ts";
import { calculateWoundThreshold, getWoundPenalty } from "../src/lib/calculations.ts";
import { createEmptyCharacter } from "../src/types/character.ts";
import type {
  CombatAction,
  CombatError,
  CombatParticipant,
  CombatResult,
  CombatState,
} from "../src/lib/combat/contract.ts";

/* -------------------------------------------------------------------------- *
 * Fixtures — mesmos recortes do motor (F1.5/F1.8C), montados à mão.
 * -------------------------------------------------------------------------- */

const PC_ID = "f18d-pc";
const INIMIGO_ID = "f18d-inimigo";

/** Ficha: SEM deathSave por padrão (só importa quando a lesão crítica é rolada). */
function personagem(combat: CombatParticipant["combat"]): CombatParticipant {
  return {
    id: PC_ID,
    type: "character",
    name: "V",
    source: { characterId: PC_ID, sourceKey: null, enemyId: null },
    stats: { REF: 7, DEX: 6, BODY: 6 },
    skills: {
      handgun: { stat: "REF", level: 6 },
      evasion: { stat: "DEX", level: 4 },
    },
    combat,
  };
}

/** Inimigo: tipo "enemy" → `ENEMY_DAMAGE_POLICY` (clamp em 0 + derrota pelo HP). */
function inimigo(combat: CombatParticipant["combat"]): CombatParticipant {
  return {
    id: INIMIGO_ID,
    type: "enemy",
    name: "Scrappy",
    source: { characterId: null, sourceKey: INIMIGO_ID, enemyId: "scrapper" },
    stats: { REF: 6 },
    combat,
  };
}

interface Combat {
  hp: [number, number];
  armor?: [number, number];
  cyberware?: [number, number];
  isDead?: boolean;
  deathSave?: { dc: number; failures: number };
}

/** `CombatHealth` com o que os testes variam; o resto no padrão (sem lesões/condições). */
function saude({
  hp,
  armor = [0, 0],
  cyberware = [0, 0],
  isDead = false,
  deathSave,
}: Combat): CombatParticipant["combat"] {
  return {
    hp: { current: hp[0], max: hp[1] },
    armor: { head: armor[0], body: armor[1] },
    cyberwareSP: { head: cyberware[0], body: cyberware[1] },
    criticalInjuries: [],
    conditions: [],
    initiative: null,
    isDead,
    ...(deathSave ? { deathSave } : {}),
  };
}

function estado(participants: CombatParticipant[], status: "active" | "finished" = "active"): CombatState {
  return {
    id: "f18d-combat",
    status,
    round: 1,
    initiativeStarted: true,
    activeParticipantId: participants[0]?.id ?? null,
    participants,
  };
}

/** Dano externo/GM (`actorId: null`) num alvo dado. */
function dano(targetId: string, amount: number, actorId: string | null = null): CombatAction {
  return { type: "damage", actorId, targetId, amount };
}

/* -------------------------------------------------------------------------- *
 * Helpers de asserção
 * -------------------------------------------------------------------------- */

function ok(result: CombatResult): CombatResult {
  assert.equal(result.ok, true, `esperava sucesso, veio ${JSON.stringify(result.errors)}`);
  return result;
}

/** Sucesso de dano SEMPRE vem com `damageResult` — é o contrato do F1.8D.1. */
function danoOk(result: CombatResult) {
  const r = ok(result);
  assert.ok(r.damageResult, "sucesso de dano vem com damageResult");
  return r.damageResult;
}

function erro(result: CombatResult): CombatError {
  assert.equal(result.ok, false, "esperava recusa");
  const errors = result.errors;
  assert.ok(errors && errors.length > 0, "recusa vem com errors");
  return errors[0];
}

/* ========================================================================== *
 * 1 — Dano básico
 * ========================================================================== */

test("dano básico: 10 de dano e 0 de armadura → 10 de HP perdido", () => {
  const state = estado([inimigo(saude({ hp: [40, 40] }))]);

  const result = execute(state, dano(INIMIGO_ID, 10));
  const dmg = danoOk(result);

  assert.equal(dmg.rawDamage, 10);
  assert.equal(dmg.armorValue, 0, "sem armadura, o SP considerado é 0");
  assert.equal(dmg.damageAbsorbed, 0);
  assert.equal(dmg.damageAfterArmor, 10, "nada foi absorvido");
  assert.equal(dmg.hpBefore, 40);
  assert.equal(dmg.hpAfter, 30);
  assert.equal(result.state.participants[0].combat.hp.current, 30, "o estado bate com o resultado");
  assert.equal(dmg.woundPenalty, 0, "30/40 está acima do limiar (20)");
});

/* ========================================================================== *
 * 2 — Redução de armadura
 * ========================================================================== */

test("redução de armadura: 10 de dano, SP 4 → 6 chegam ao HP", () => {
  const state = estado([inimigo(saude({ hp: [40, 40], armor: [0, 4] }))]);

  const dmg = danoOk(execute(state, dano(INIMIGO_ID, 10)));

  assert.equal(dmg.rawDamage, 10);
  assert.equal(dmg.armorValue, 4, "SP efetivo do local");
  assert.equal(dmg.damageAbsorbed, 4, "redução aplicada");
  assert.equal(dmg.damageAfterArmor, 6, "10 − 4");
  assert.equal(dmg.hpAfter, 34, "40 − 6");
});

test("dano que passou do SP degrada a veste em 1 (comportamento F1.3 preservado)", () => {
  const state = estado([inimigo(saude({ hp: [40, 40], armor: [0, 4] }))]);

  const result = execute(state, dano(INIMIGO_ID, 10));

  assert.deepEqual(result.changes, [
    { type: "hp_changed", participantId: INIMIGO_ID, before: 40, after: 34 },
    { type: "armor_changed", participantId: INIMIGO_ID, location: "body", before: 4, after: 3 },
  ]);
  assert.equal(result.state.participants[0].combat.armor.body, 3);
  // O MESMO array, por referência: `damageResult.changes` nunca diverge.
  assert.equal(result.damageResult?.changes, result.changes);
});

/* ========================================================================== *
 * 3 — Armadura absorve tudo
 * ========================================================================== */

test("armadura absorve tudo: 5 de dano, SP 10 → 0 de dano e nenhuma mudança", () => {
  const state = estado([inimigo(saude({ hp: [40, 40], armor: [0, 10] }))]);

  const result = execute(state, dano(INIMIGO_ID, 5));
  const dmg = danoOk(result);

  assert.equal(dmg.armorValue, 10);
  assert.equal(dmg.damageAbsorbed, 5, "segurou o dano inteiro");
  assert.equal(dmg.damageAfterArmor, 0);
  assert.equal(dmg.hpBefore, 40);
  assert.equal(dmg.hpAfter, 40, "o HP não se moveu");
  assert.deepEqual(result.changes, [], "sem penetração não há HP nem degradação");
  assert.equal(dmg.woundPenalty, 0);
});

/* ========================================================================== *
 * 4 — Transição de HP
 * ========================================================================== */

test("transição de HP: DamageResult, changes e estado contam a MESMA história", () => {
  const state = estado([
    personagem(saude({ hp: [40, 40], deathSave: { dc: 6, failures: 0 } })),
  ]);

  const result = execute(state, dano(PC_ID, 15));
  const dmg = danoOk(result);

  assert.equal(dmg.hpBefore, 40);
  assert.equal(dmg.hpAfter, 25, "40 − 15, sem armadura");

  const change = result.changes.find((c) => c.type === "hp_changed");
  assert.ok(change && change.type === "hp_changed");
  assert.equal(change.before, dmg.hpBefore, "o change reflete o hpBefore");
  assert.equal(change.after, dmg.hpAfter, "o change reflete o hpAfter");
  assert.equal(result.state.participants[0].combat.hp.current, dmg.hpAfter, "o estado reflete o hpAfter");
});

/* ========================================================================== *
 * 5 — Wound penalty delegado à função canônica
 * ========================================================================== */

test("wound penalty: atravessa o limiar → −2, exatamente o que getWoundPenalty devolve", () => {
  const state = estado([
    personagem(saude({ hp: [40, 40], deathSave: { dc: 6, failures: 0 } })),
    inimigo(saude({ hp: [40, 40], armor: [0, 4] })),
  ]);

  // 40 → 16: abaixo do limiar (floor(40/2) = 20) → Seriously Wounded.
  const result = execute(state, dano(PC_ID, 24, INIMIGO_ID), createTestRandomSource([3, 4]));
  const dmg = danoOk(result);

  assert.equal(dmg.hpAfter, 16);
  assert.equal(16, calculateWoundThreshold(40) - 4, "o limiar é ceil(maxHP/2)");

  // Delegação: o número é o da função canônica, calculado sobre o HP NOVO.
  const ficha = createEmptyCharacter("delegacao");
  ficha.combat.hp = { current: dmg.hpAfter, max: 40 };
  ficha.combat.isDead = false;
  assert.equal(dmg.woundPenalty, getWoundPenalty(ficha), "a fonte única decide a penalidade");
  assert.equal(dmg.woundPenalty, -2, "Seriously Wounded = −2");

  // Wound Threshold determina somente Seriously Wounded.
  assert.deepEqual(result.rolls, []);
  assert.equal(result.changes.some((c) => c.type === "critical_injury_added"), false);
});

test("wound penalty: acima do limiar → 0 e nenhum sorteio", () => {
  const state = estado([
    personagem(saude({ hp: [40, 40], deathSave: { dc: 6, failures: 0 } })),
  ]);
  const rng = createTestRandomSource([5, 6]);

  const result = execute(state, dano(PC_ID, 10), rng);
  const dmg = danoOk(result);

  assert.equal(dmg.hpAfter, 30, "acima de 20: status Normal");
  assert.equal(dmg.woundPenalty, 0, "sem penalidade");
  assert.deepEqual(result.rolls, [], "limiar não foi atravessado: nenhuma rolagem");
  assert.equal(rng.d10(), 5, "nenhum valor da sequência foi consumido");
});

/* ========================================================================== *
 * 6 e 7 — Políticas de HP preservadas (F1.3)
 * ========================================================================== */

test("player: HP pode ficar negativo e o dano NÃO mata (Death Save decide)", () => {
  const state = estado([
    personagem(saude({ hp: [5, 40], armor: [0, 4], deathSave: { dc: 6, failures: 0 } })),
  ]);

  const result = execute(state, dano(PC_ID, 12));
  const dmg = danoOk(result);

  assert.equal(dmg.hpBefore, 5);
  assert.equal(dmg.hpAfter, -3, "5 − 8 (12 de dano − 4 de SP): a ficha aceita negativo");
  assert.equal(result.state.participants[0].combat.hp.current, -3);
  assert.equal(result.state.participants[0].combat.isDead, false, "a derrota não vem do dano");
  assert.equal(
    result.changes.some((c) => c.type === "is_dead_changed"),
    false,
  );
  // Mortally Wounded também é penalidade canônica (−2).
  assert.equal(dmg.woundPenalty, -2);
});

test("enemy: HP trava em 0 e o HP zero É a derrota", () => {
  const state = estado([inimigo(saude({ hp: [5, 40] }))]);

  const result = execute(state, dano(INIMIGO_ID, 20));
  const dmg = danoOk(result);

  assert.equal(dmg.hpBefore, 5);
  assert.equal(dmg.hpAfter, 0, "nunca fica negativo: clamp da política enemy");
  assert.equal(result.state.participants[0].combat.hp.current, 0);
  assert.deepEqual(
    result.changes,
    [
      { type: "hp_changed", participantId: INIMIGO_ID, before: 5, after: 0 },
      { type: "is_dead_changed", participantId: INIMIGO_ID, before: false, after: true },
    ],
    "a derrota sai na mudança observável (é o que o cliente espelha, seção 10)",
  );
  assert.equal(dmg.woundPenalty, 0, "morto não tem penalidade: getWoundPenalty lê isDead");

  // F1.7.1 (Decisão A — antes DEFERRED do F1.8D.1): o estado resultante AGORA
  // reflete a derrota, da MESMA fonte do `is_dead_changed` acima
  // (`outcome.isDeadAfter` via `isDefeatedBy`) — sem re-derivada `hp <= 0`.
  assert.equal(
    result.state.participants[0].combat.isDead,
    true,
    "inimigo derrubado volta morto no estado devolvido pelo motor",
  );
});

test("enemy: sobrevivente segue vivo no estado devolvido (F1.7.1)", () => {
  const state = estado([inimigo(saude({ hp: [30, 40] }))]);

  const result = execute(state, dano(INIMIGO_ID, 4));
  danoOk(result);

  assert.equal(result.state.participants[0].combat.hp.current, 26);
  assert.equal(
    result.state.participants[0].combat.isDead,
    false,
    "HP acima de 0 com política enemy não derruba",
  );
  assert.equal(
    result.changes.some((change) => change.type === "is_dead_changed"),
    false,
  );
});

/* ========================================================================== *
 * 8 — Armor efetiva: max(veste, cyberware)
 * ========================================================================== */

test("armor efetiva: veste (4) < cyberware (11) → vale o cyberware", () => {
  const state = estado([inimigo(saude({ hp: [40, 40], armor: [0, 4], cyberware: [0, 11] }))]);

  const dmg = danoOk(execute(state, dano(INIMIGO_ID, 20)));

  assert.equal(dmg.armorValue, effectiveArmorSP(4, 11), "a fonte única da regra decide");
  assert.equal(dmg.armorValue, 11, "não soma: vale o maior");
  assert.equal(dmg.damageAbsorbed, 11);
  assert.equal(dmg.damageAfterArmor, 9, "20 − 11 (com a veste sozinha seria 16)");
  assert.equal(dmg.hpAfter, 31);
});

test("armor efetiva: cyberware (4) < veste (11) → vale a veste", () => {
  const state = estado([inimigo(saude({ hp: [40, 40], armor: [0, 11], cyberware: [0, 4] }))]);

  const dmg = danoOk(execute(state, dano(INIMIGO_ID, 20)));

  assert.equal(dmg.armorValue, effectiveArmorSP(11, 4), "a fonte única da regra decide");
  assert.equal(dmg.armorValue, 11);
  assert.equal(dmg.damageAfterArmor, 9, "20 − 11 (com o cyberware sozinho seria 16)");
  assert.equal(dmg.hpAfter, 31);
});

/* ========================================================================== *
 * 9 — Dano inválido
 * ========================================================================== */

test("dano inválido (≤ 0, não inteiro, NaN) → invalid_action, sem damageResult", () => {
  const state = estado([inimigo(saude({ hp: [40, 40] }))]);
  const antes = structuredClone(state);

  for (const amount of [0, -3, 1.5, Number.NaN]) {
    const result = execute(state, dano(INIMIGO_ID, amount));
    const err = erro(result);
    assert.equal(err.code, "invalid_action", `amount=${amount}`);
    assert.equal(err.message, "Dano inválido.", "a mesma validação da ficha (F1.5)");
    assert.equal(result.damageResult, undefined, "recusa não produz resultado parcial");
    assert.deepEqual(result.changes, [], `amount=${amount}: nada foi aplicado`);
  }
  assert.deepEqual(state, antes, "o estado original ficou intacto");
});

/* ========================================================================== *
 * 10 — Validações estruturadas
 * ========================================================================== */

test("actor inexistente → unknown_participant, sem damageResult", () => {
  const state = estado([inimigo(saude({ hp: [40, 40] }))]);

  const result = execute(state, dano(INIMIGO_ID, 10, "fantasma"));

  assert.equal(erro(result).code, "unknown_participant");
  assert.equal(result.damageResult, undefined);
  assert.equal(result.state, state, "em falha o motor devolve o MESMO estado");
});

test("target inexistente → unknown_participant, sem damageResult", () => {
  const state = estado([inimigo(saude({ hp: [40, 40] }))]);

  const result = execute(state, dano("fantasma", 10));

  assert.equal(erro(result).code, "unknown_participant");
  assert.equal(result.damageResult, undefined);
});

test("combate encerrado → combat_finished, sem damageResult", () => {
  const state = estado([inimigo(saude({ hp: [40, 40] }))], "finished");

  const result = execute(state, dano(INIMIGO_ID, 10));

  assert.equal(erro(result).code, "combat_finished");
  assert.equal(result.damageResult, undefined);
});

test("ações que não são damage não produzem damageResult", () => {
  const state = estado([inimigo(saude({ hp: [40, 40] }))]);

  const fora: CombatAction[] = [
    { type: "heal", actorId: INIMIGO_ID },
    { type: "end_turn", actorId: null },
    { type: "other", actorId: INIMIGO_ID, label: "x" },
  ];
  for (const action of fora) {
    const result = execute(state, action);
    assert.equal(erro(result).code, "invalid_action", `${action.type}`);
    assert.equal(result.damageResult, undefined, `${action.type}`);
  }
});

/* ========================================================================== *
 * 11 — Determinismo (RNGs INDEPENDENTES, lição do F1.8C)
 * ========================================================================== */

test("determinismo: mesmo estado + mesma action + mesma sequência → mesmo resultado", () => {
  // Alvo com deathSave: o limiar é atravessado, então o 2d6 da lesão consome
  // o RandomSource — é aqui que a determinismo se prova de verdade.
  const novoEstado = () =>
    estado([
      personagem(saude({ hp: [40, 40], armor: [0, 4], deathSave: { dc: 6, failures: 0 } })),
      inimigo(saude({ hp: [40, 40] })),
    ]);
  const action = { ...dano(PC_ID, 24, INIMIGO_ID), damageRolls: [6, 6, 3] };

  // `createTestRandomSource` é stateful (cursor interno): cada execução
  // precisa da SUA instância, com a mesma sequência declarada.
  const r1 = execute(novoEstado(), action, createTestRandomSource([3, 4]));
  const r2 = execute(novoEstado(), action, createTestRandomSource([3, 4]));

  const d1 = danoOk(r1);
  const d2 = danoOk(r2);

  // Rolagem e resultado de dano idênticos.
  assert.deepEqual(r1.rolls, r2.rolls);
  assert.equal(d1.rawDamage, d2.rawDamage);
  assert.equal(d1.armorValue, d2.armorValue);
  assert.equal(d1.damageAbsorbed, d2.damageAbsorbed);
  assert.equal(d1.damageAfterArmor, d2.damageAfterArmor);
  assert.equal(d1.hpBefore, d2.hpBefore);
  assert.equal(d1.hpAfter, d2.hpAfter);
  assert.equal(d1.woundPenalty, d2.woundPenalty);
  assert.equal(d1.actorId, d2.actorId);
  assert.equal(d1.targetId, d2.targetId);
  // Mudanças, estado e id: idênticos. O `damageId` é carimbo de correlação
  // (mesmo molde do `attackId` do F1.8C), então o que se compara é a parte
  // DETERMINÍSTICA dele — o prefixo — e não o milissegundo do relógio.
  assert.deepEqual(r1.changes, r2.changes);
  assert.deepEqual(r1.state, r2.state);
  assert.ok(d1.damageId.startsWith(`${INIMIGO_ID}-${PC_ID}-`));
  assert.ok(d2.damageId.startsWith(`${INIMIGO_ID}-${PC_ID}-`));

  // Sequência DIFERENTE → outro 2d6 → outra lesão: a fonte é injetada mesmo.
  const outro = execute(novoEstado(), action, createTestRandomSource([1, 1]));
  assert.notDeepEqual(outro.rolls, r1.rolls);
  assert.notDeepEqual(outro.state, r1.state);
});

/* ========================================================================== *
 * 12 — Integração: AttackResult com hit → DamageAction → DamageResult
 * ========================================================================== */

test("fluxo completo: ataque acerta → DamageAction → DamageResult (engines separados)", () => {
  const actor = personagem(saude({ hp: [40, 40] }));
  const alvo = inimigo(saude({ hp: [40, 40], armor: [0, 4] }));
  const state = estado([actor, alvo]);

  // 1) ATAQUE — o Attack Engine decide hit/miss, sem tocar em HP.
  const ataque = execute(
    state,
    {
      type: "attack",
      actorId: PC_ID,
      targetId: INIMIGO_ID,
      skillId: "handgun",
      attackType: "handgun",
      attackMode: "normal",
      defense: { type: "dv", value: 10, source: "range_table" },
    },
    createTestRandomSource([5]), // 7 (REF) + 6 (perícia) + 5 (d10) = 18 > DV 10
  );
  const attackResult = ok(ataque).attackResult;
  assert.ok(attackResult, "ataque produce AttackResult");
  assert.equal(attackResult.hit, true, "18 > 10");
  assert.equal(
    attackResult.total,
    18,
    "stats[skill.stat] + nível + d10, sem modificador (regra do F1.8C)",
  );
  assert.equal(
    ataque.damageResult,
    undefined,
    "FRONTEIRA: o Attack Engine NÃO resolve dano",
  );
  assert.equal(ataque.state.participants[1].combat.hp.current, 40, "o ataque não mexeu em HP");

  // 2) DANO — a etapa seguinte, com o valor já rolado (o motor não rola arma).
  const danoResult = execute(ataque.state, dano(INIMIGO_ID, 10, PC_ID));
  const dmg = danoOk(danoResult);

  assert.equal(dmg.rawDamage, 10);
  assert.equal(dmg.armorValue, 4);
  assert.equal(dmg.damageAfterArmor, 6, "10 − 4");
  assert.equal(dmg.hpBefore, 40);
  assert.equal(dmg.hpAfter, 34, "40 − 6");
  assert.equal(danoResult.state.participants[1].combat.hp.current, 34);

  // 3) As fronteiras continuam limpas nos dois sentidos.
  assert.equal(danoResult.attackResult, undefined, "o Damage Engine não decide acerto");
});

/* ========================================================================== *
 * 13 — Imutabilidade
 * ========================================================================== */

test("a execução não muta o estado recebido", () => {
  const state = estado([
    personagem(saude({ hp: [40, 40], armor: [0, 11], deathSave: { dc: 6, failures: 0 } })),
    inimigo(saude({ hp: [40, 40], armor: [0, 4] })),
  ]);
  const antes = structuredClone(state);

  const result = execute(state, dano(PC_ID, 24, INIMIGO_ID), createTestRandomSource([3, 4]));

  assert.ok(result.ok);
  assert.deepEqual(state, antes, "o estado original ficou idêntico ao snapshot");
  assert.notEqual(result.state, state, "a saída é um estado NOVO");
  assert.equal(state.participants[0].combat.hp.current, 40, "HP original intacto");
  assert.equal(state.participants[0].combat.criticalInjuries.length, 0, "nenhuma lesão no original");
});

/* ========================================================================== *
 * 14 — A API do motor continua sendo uma só
 * ========================================================================== */

test("engine.execute é a MESMA função de execute (sem engine paralelo)", () => {
  assert.equal(typeof engine.execute, "function");
  assert.equal(engine.execute, execute, "dois nomes, uma implementação");
});
