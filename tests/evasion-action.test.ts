/**
 * F1.8D.9 — EVASÃO COMO AÇÃO DO COMBAT ENGINE
 *
 * O que esta suíte fixa:
 *
 *   • FÓRMULA = a determinada da ficha (`rollEvasion`, attacks.ts:317-377):
 *     STAT(skill.stat) + nível + 1d10 + `action.modifiers`
 *     + penalidade de lesão (`getWoundPenalty`, fonte única)
 *     + cyberware de Evasão + cyberware "todo físico"
 *     + lesão crítica (allPhysical + allActions + STAT da perícia).
 *   • DADOS = o MESMO `rollAttackDice` do ataque (F1.8C): primeiro 10 soma um
 *     dado, primeiro 1 subtrai, sem cadeia — idêntico à regra da ficha.
 *   • RNG injetado: mesmo state + mesma action + mesma sequência = mesmo
 *     resultado; ERRO nunca consome RNG nem muda estado.
 *   • SEM debit de ação, SEM estado novo, SEM evento — a Evasão da mesa custa
 *     1 ("other") na camada Mesa (`MESA_ROLL_ACTION`), não no motor (RULE GAP
 *     de Action Economy, não implementada aqui).
 *   • Divergências PRÉ-EXISTENTES preservadas e testadas como estão:
 *     inimigo do encontro = REF + `evasionSkillLevel` fora do motor (o adapter
 *     não traz `skills.evasion` → recusa `EVASION_SKILL_MISSING`, sem
 *     corrigir para REF), e a defesa-Evasão DENTRO do ataque (F1.8C) continua
 *     com a sua própria composição de modificadores.
 *
 * Fora do escopo (RULE GAP, não testado como se existisse): custo de ação no
 * motor, reação/integração ataque↔evasão, limite de reuso por turno, Parry,
 * Dodge and Dive, condições (PRONE/etc.) na fórmula.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import ts from "typescript";

import { createTestRandomSource } from "../src/lib/random.ts";
import { execute } from "../src/lib/combat/engine.ts";
import { toCombatParticipant } from "../src/lib/combat/adapters.ts";
import type { NormalizedEncounterParticipant } from "../src/lib/combat/adapters.ts";
import type { CriticalInjury } from "../src/data/criticalInjuries.ts";
import type {
  CombatError,
  CombatParticipant,
  CombatResult,
  CombatState,
  EvasionAction,
} from "../src/lib/combat/contract.ts";

/* -------------------------------------------------------------------------- *
 * Fixtures — recortes reais do contrato, montados à mão.
 * -------------------------------------------------------------------------- */

const ATOR_ID = "f18d9-ator";

const saudePadrao = {
  armor: { head: 0, body: 0 },
  cyberwareSP: { head: 0, body: 0 },
  criticalInjuries: [],
  conditions: [],
  initiative: null,
  isDead: false,
};

/** Personagem com Evasion DEX 6 + nível 4 — linha de base da fórmula. */
function ator(overrides: Partial<CombatParticipant> = {}): CombatParticipant {
  return {
    id: ATOR_ID,
    type: "character",
    name: "V",
    source: { characterId: ATOR_ID, sourceKey: null, enemyId: null },
    stats: { DEX: 6, REF: 7 },
    skills: { evasion: { stat: "DEX", level: 4 } },
    combat: { hp: { current: 40, max: 40 }, ...saudePadrao },
    ...overrides,
  };
}

function estado(
  participants: CombatParticipant[],
  status: CombatState["status"] = "active",
): CombatState {
  return {
    id: "f18d9-combat",
    status,
    round: 1,
    initiativeStarted: true,
    activeParticipantId: participants[0]?.id ?? null,
    participants,
  };
}

function acao(overrides: Partial<EvasionAction> = {}): EvasionAction {
  return { type: "evasion", actorId: ATOR_ID, ...overrides };
}

/** Participante de encontro REAL — mesmo recorte do teste de contrato F1.1. */
function inimigo(overrides: Partial<NormalizedEncounterParticipant> = {}): NormalizedEncounterParticipant {
  return {
    enemyId: "scrapper",
    id: "instance-2",
    name: "Scrappy #2",
    archetype: "Scrappy",
    faction: "Maelstrom",
    level: 2,
    threatLevel: "medium",
    hp: { current: 35, max: 35 },
    armor: { head: 11, body: 11 },
    conditions: [{ id: "stunned", name: "Atordoado" }],
    isPlayer: false,
    weaponName: "Heavy Pistol",
    weaponSkillId: "handgun",
    weaponSkillName: "Handgun",
    refStat: 6,
    moveStat: 5,
    skillValue: 10,
    attackBase: 12,
    damageExpression: "3d6",
    lastAttackRoll: null,
    lastDamageRoll: null,
    initiative: 14,
    personalityTraits: [{ id: "t1", name: "Grosseiro", description: "Não mede palavras." }],
    magazine: 8,
    ammo: 5,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- *
 * Helpers de asserção
 * -------------------------------------------------------------------------- */

function ok(result: CombatResult): CombatResult {
  assert.equal(result.ok, true, `esperava sucesso, veio ${JSON.stringify(result.errors)}`);
  return result;
}

function evasionOk(result: CombatResult) {
  const r = ok(result);
  assert.ok(r.evasionResult, "sucesso de evasão vem com evasionResult");
  return r.evasionResult;
}

function erro(result: CombatResult): CombatError {
  assert.equal(result.ok, false, "esperava recusa");
  const errors = result.errors;
  assert.ok(errors && errors.length > 0, "recusa vem com errors");
  assert.equal(result.evasionResult, undefined, "recusa não tem evasionResult");
  return errors[0];
}

/* ========================================================================== *
 * 1 — Evasion válida: fórmula, rolagem no rolls, estado intacto
 * ========================================================================== */

test("evasion válida: STAT + perícia + 1d10 via RNG injetado; estado e changes intactos", () => {
  const state = estado([ator()]);
  const rng = createTestRandomSource([5, 9]);

  const result = execute(state, acao(), rng);
  const er = evasionOk(result);

  // Fórmula: DEX 6 + nível 4 + d10 5 = 15.
  assert.equal(er.total, 15, "6 + 4 + 5, sem nenhum modificador fantasma");
  assert.deepEqual(er.roll, { expression: "1d10", rolls: [5], total: 5 });
  assert.deepEqual(er.baseStat, { id: "DEX", value: 6 }, "atributo = o da perícia");
  assert.deepEqual(er.skill, { id: "evasion", value: 4 }, "skill id exato = 'evasion'");
  assert.equal(er.critical, false);
  assert.equal(er.fumble, false);

  // A ação de evasão NÃO é ataque nem dano.
  assert.equal(result.attackResult, undefined);
  assert.equal(result.damageResult, undefined);

  // Rolagem publicada no `rolls` com kind "evasion" (MesaRollKind).
  assert.deepEqual(result.rolls, [
    { expression: "1d10", rolls: [5], total: 5, kind: "evasion", actorId: ATOR_ID },
  ]);

  // Nada muda: sem estado novo, sem changes, sem eventos (ação pura).
  assert.equal(result.state, state, "mesmo objeto de estado — sem mutação");
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.events, []);

  // Exatamente 1 valor sorteado — sentinela intacta.
  assert.equal(rng.d10(), 9, "1 valor consumido (só o d10)");
});

/* ========================================================================== *
 * 2 — Modificadores temporários do chamador
 * ========================================================================== */

test("action.modifiers entram na conta (mesmo papel do parâmetro da ficha)", () => {
  const state = estado([ator()]);
  const rng = createTestRandomSource([5, 9]);

  const result = execute(state, acao({ modifiers: [{ source: "Equipamento (+2)", value: 2 }] }), rng);
  const er = evasionOk(result);

  assert.equal(er.total, 17, "6 + 4 + 5 + 2");
  assert.equal(rng.d10(), 9, "modifiers não rolam dado nenhum");
});

/* ========================================================================== *
 * 3 — Penalidade de lesão grave (fonte única getWoundPenalty)
 * ========================================================================== */

test("wound penalty: Seriously Wounded (HP ≤ metade) → −2 na evasão", () => {
  // HP 20/40 → threshold floor(40/2) = 20 → Seriously Wounded → −2.
  const state = estado([ator({ combat: { hp: { current: 20, max: 40 }, ...saudePadrao } })]);
  const rng = createTestRandomSource([5, 9]);

  const result = execute(state, acao(), rng);
  const er = evasionOk(result);

  assert.equal(er.total, 13, "6 + 4 + 5 − 2 (mesma fonte única do ataque)");
  assert.equal(rng.d10(), 9, "a penalidade não consome RNG");
});

/* ========================================================================== *
 * 4 — Cyberware canônico: Evasão (Kerenzikov) e "todo físico" (Adrenaline)
 * ========================================================================== */

test("cyberware: bônus de Evasão entra; efeito all_physical também (estágios)", () => {
  // (a) Kerenzikov estágio 0 ("Em movimento"): +1 Evasão → 16.
  const comKerenzikov = execute(
    estado([
      ator({
        cyberware: [{ name: "Kerenzikov", catalogItemId: "kerenzikov", activeStage: 0 }],
      }),
    ]),
    acao(),
    createTestRandomSource([5, 9]),
  );
  assert.equal(evasionOk(comKerenzikov).total, 16, "6 + 4 + 5 + 1");

  // (b) Adrenaline Booster estágio 1 ("Rescaldo"): −1 todo físico → 14.
  const comRescaldo = execute(
    estado([
      ator({
        cyberware: [{ name: "Adrenaline Booster", catalogItemId: "adrenaline_booster", activeStage: 1 }],
      }),
    ]),
    acao(),
    createTestRandomSource([5, 9]),
  );
  assert.equal(evasionOk(comRescaldo).total, 14, "6 + 4 + 5 − 1");
});

/* ========================================================================== *
 * 5 — Lesão crítica (as três categorias que a fórmula lê)
 * ========================================================================== */

test("lesão crítica: STAT da perícia + all_actions entram; ranged/melee não", () => {
  const lesao: CriticalInjury = {
    roll: 4,
    name: "Lesão de Teste",
    effect: "−2 DEX e −1 em todas as ações (falso — só para a conta).",
    quickFix: "None",
    treatment: "Surgery (DV 16)",
    bonusDamage: 5,
    location: "body",
    modifiers: [
      { type: "stat", stat: "DEX", value: -2, description: "−2 DEX" },
      { type: "all_actions", value: -1, description: "−1 em todas as ações" },
      { type: "ranged", value: -3, description: "−3 à distância (NÃO vale em evasão)" },
    ],
  };
  const state = estado([
    ator({ combat: { hp: { current: 40, max: 40 }, ...saudePadrao, criticalInjuries: [lesao] } }),
  ]);
  const rng = createTestRandomSource([5, 9]);

  const er = evasionOk(execute(state, acao(), rng));

  assert.equal(er.total, 12, "6 + 4 + 5 − 2 (DEX) − 1 (all_actions); ranged não entra");
  assert.equal(rng.d10(), 9, "lesão não consome RNG");
});

/* ========================================================================== *
 * 6 — Dados: crítico soma um dado, fumble subtrai (regra do ataque)
 * ========================================================================== */

test("dado exploding: primeiro 10 soma extra (critical), primeiro 1 subtrai (fumble)", () => {
  // (a) 10 → dado extra 3 → dados 10 + 3 = 13 → total 6 + 4 + 13 = 23.
  const critico = evasionOk(
    execute(estado([ator()]), acao(), createTestRandomSource([10, 3, 9])),
  );
  assert.deepEqual(critico.roll, { expression: "2d10", rolls: [10, 3], total: 13 });
  assert.equal(critico.critical, true, "primeiro dado natural 10");
  assert.equal(critico.fumble, false);
  assert.equal(critico.total, 23);

  // (b) 1 → dado extra 3 → dados 1 + 3 = −2 → total 6 + 4 − 2 = 8.
  const fumble = evasionOk(
    execute(estado([ator()]), acao(), createTestRandomSource([1, 3, 9])),
  );
  assert.deepEqual(fumble.roll, { expression: "2d10", rolls: [1, 3], total: -2 });
  assert.equal(fumble.fumble, true, "primeiro dado natural 1");
  assert.equal(fumble.critical, false);
  assert.equal(fumble.total, 8);
});

/* ========================================================================== *
 * 7 — Determinismo (RNGs INDEPENDENTES por chamada)
 * ========================================================================== */

test("determinismo: mesma sequência em RNGs independentes → mesmo resultado", () => {
  const roda = () => {
    const rng = createTestRandomSource([7, 9]);
    const result = execute(estado([ator()]), acao(), rng);
    return { result, rng };
  };

  const r1 = roda();
  const r2 = roda();

  assert.deepEqual(r1.result.evasionResult, r2.result.evasionResult);
  assert.deepEqual(r1.result.rolls, r2.result.rolls);
  assert.deepEqual(r1.result.changes, r2.result.changes);
  assert.deepEqual(r1.result.state, r2.result.state);

  assert.equal(r1.result.evasionResult?.total, 17, "6 + 4 + 7");
  assert.equal(r1.rng.d10(), 9, "1 valor em cada");
  assert.equal(r2.rng.d10(), 9);
});

/* ========================================================================== *
 * 8 — Erros: nenhum sorteio antes das validações, estado intacto
 * ========================================================================== */

test("erros: participante inexistente/derrotado, combate encerrado e dados ausentes não rolam", () => {
  const casos: Array<{
    nome: string;
    state: CombatState;
    action: EvasionAction;
    code: string;
    mensagem: RegExp;
  }> = [
    {
      nome: "ator inexistente",
      state: estado([ator()]),
      action: acao({ actorId: "fantasma" }),
      code: "unknown_participant",
      mensagem: /não existe no combate/,
    },
    {
      nome: "combate encerrado",
      state: estado([ator()], "finished"),
      action: acao(),
      code: "combat_finished",
      mensagem: /Combate encerrado/,
    },
    {
      nome: "participante derrotado",
      state: estado([
        ator({ combat: { hp: { current: 0, max: 40 }, ...saudePadrao, isDead: true } }),
      ]),
      action: acao(),
      code: "combatant_defeated",
      mensagem: /fora do combate/,
    },
    {
      nome: "perícia inexistente",
      state: estado([ator({ skills: {} })]),
      action: acao(),
      code: "rule_violation",
      mensagem: /EVASION_SKILL_MISSING/,
    },
    {
      nome: "STAT da perícia ausente",
      state: estado([ator({ stats: { REF: 8 } })]),
      action: acao(),
      code: "rule_violation",
      mensagem: /EVASION_STAT_MISSING:DEX/,
    },
  ];

  for (const caso of casos) {
    const rng = createTestRandomSource([5, 9]);
    const result = execute(caso.state, caso.action, rng);
    const error = erro(result);

    assert.equal(error.code, caso.code, caso.nome);
    assert.match(error.message, caso.mensagem, caso.nome);
    assert.equal(rng.d10(), 5, `${caso.nome}: nenhum valor de RNG consumido`);
    assert.equal(result.state, caso.state, `${caso.nome}: estado intacto`);
    assert.deepEqual(result.rolls, [], `${caso.nome}: nada rolado`);
    assert.deepEqual(result.changes, [], `${caso.nome}: nada mudou`);
  }
});

/* ========================================================================== *
 * 9 — Inimigo do encontro: divergência pré-existente preservada (não corrigida)
 * ========================================================================== */

test("comportamento enemy: adaptado do encontro recusa com EVASION_SKILL_MISSING (divergência REF×DEX mantida)", () => {
  const participante = toCombatParticipant(inimigo());

  // A divergência existe HOJE no adapter (adapters.ts:228-240): o encontro
  // traz REF/MOVE e só a perícia da arma — sem DEX e sem `skills.evasion`.
  assert.equal(participante.stats?.REF, 6, "inimigo vive em REF");
  assert.equal(participante.stats?.DEX, undefined, "sem DEX no recorte");
  assert.equal(participante.skills?.["evasion"], undefined, "sem perícia Evasion no recorte");

  const state = estado([participante]);
  const rng = createTestRandomSource([5, 9]);
  const result = execute(state, { type: "evasion", actorId: participante.id }, rng);

  // Recusa honesta — NADA de default 0 nem fallback REF inventado aqui.
  const error = erro(result);
  assert.equal(error.code, "rule_violation");
  assert.match(error.message, /EVASION_SKILL_MISSING/);
  assert.equal(rng.d10(), 5, "sem RNG em erro");
  assert.equal(result.state, state, "estado intacto");
});

/* ========================================================================== *
 * 10 — Contrato: sem campos especulativos, resultado mínimo
 * ========================================================================== */

test("contrato: EvasionAction não muda; EvasionResult/CombatResult só com o necessário", () => {
  const source = readFileSync(new URL("../src/lib/combat/contract.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("contract.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const membrosDe = (nome: string): string[] => {
    let alvo: ts.InterfaceDeclaration | undefined;
    const visit = (node: ts.Node): void => {
      if (ts.isInterfaceDeclaration(node) && node.name.text === nome) alvo = node;
      node.forEachChild(visit);
    };
    ast.forEachChild(visit);
    assert.ok(alvo, `${nome} existe`);
    return alvo.members
      .filter(ts.isPropertySignature)
      .map((member) => (member.name && ts.isIdentifier(member.name) ? member.name.text : ""));
  };

  // A action NÃO ganhou campos especulativos (reaction/parry/bonus/...):
  // continua exatamente a do F1.1.
  assert.deepEqual(membrosDe("EvasionAction"), ["type", "actorId", "targetId", "modifiers"]);

  // O resultado traz SÓ o que a rolagem precisa — nada de reactionSpent,
  // canEvade, evasionBonus, parryAvailable, counterAttack.
  assert.deepEqual(membrosDe("EvasionResult"), [
    "roll",
    "baseStat",
    "skill",
    "total",
    "critical",
    "fumble",
  ]);

  // CombatResult ganhou exatamente um campo: evasionResult.
  assert.deepEqual(membrosDe("CombatResult"), [
    "ok",
    "state",
    "changes",
    "rolls",
    "events",
    "errors",
    "attackResult",
    "damageResult",
    "evasionResult",
  ]);
});
