/**
 * F1.5 — Primeira execução REAL do motor: `engine.execute(state, action, rng)`.
 *
 * Esta suíte cobre o fluxo inteiro de uma vez, na ordem em que o contrato
 * promete:
 *
 *     CombatAction → engine.execute → validação → regra canônica → CombatResult
 *
 * O que ela prova (§11 do plano da F1.5):
 *
 *   1. happy path — `ok`, estado novo, `changes`, `rolls`, `events`;
 *   2. imutabilidade — o `state` recebido fica byte a byte igual ao snapshot;
 *   3. determinismo — mesma entrada + mesma sequência = mesmo resultado;
 *   4. RNG consumido na ordem esperada (e NÃO consumido quando nada rola);
 *   5. actor/target inválidos devolvem erro estruturado, sem exceção;
 *   6. a regra é DELEGADA — o número que aparece aqui é o que `applyDamage`
 *      calcula, sem fórmula duplicada dentro do teste.
 *
 * Nenhuma regra de Cyberpunk RED foi alterada: tudo aqui é verificação sobre
 * o que as funções canônicas já fazem.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createTestRandomSource } from "../src/lib/random.ts";
import { engine, execute } from "../src/lib/combat/engine.ts";
import { applyDamage, ENEMY_DAMAGE_POLICY } from "../src/lib/combat/damage.ts";
import { rollCriticalInjury, rollCriticalInjuryDetail } from "../src/data/criticalInjuries.ts";
import type {
  CombatAction,
  CombatError,
  CombatParticipant,
  CombatResult,
  CombatState,
  CombatStateChange,
} from "../src/lib/combat/contract.ts";

/* -------------------------------------------------------------------------- *
 * Fixtures — montadas à mão a partir dos tipos reais.
 * -------------------------------------------------------------------------- */

const PC_ID = "f15-pc";
const INIMIGO_ID = "f15-inimigo";

/** Ficha que RASTREIA lesões: é o adapter `toCombatParticipant(character)`. */
function personagem(combat: CombatParticipant["combat"]): CombatParticipant {
  return {
    id: PC_ID,
    type: "character",
    name: "V",
    source: { characterId: PC_ID, sourceKey: null, enemyId: null },
    stats: { REF: 7, BODY: 6 },
    skills: { handgun: { stat: "REF", level: 6 } },
    combat,
    // Sem economia: orçamento de Actions é da mesa, não da ficha.
  };
}

/** Encontro/inimigo: SEM `deathSave`, logo sem rastreio de lesões. */
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

/**
 * `CombatHealth` com os campos que os testes variam; o resto no padrão da
 * ficha/encontro (sem lesões, sem condições, sem iniciativa).
 */
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

function estado(
  participants: CombatParticipant[],
  status: "active" | "finished" = "active",
): CombatState {
  return {
    id: "f15-combat",
    status,
    round: 1,
    initiativeStarted: true,
    activeParticipantId: participants[0]?.id ?? null,
    participants,
  };
}

/** A ação padrão da suíte: 20 de dano do personagem no inimigo. */
const ACAO: CombatAction = { type: "damage", actorId: PC_ID, targetId: INIMIGO_ID, amount: 20 };

/* -------------------------------------------------------------------------- *
 * 1 — A API existe mesmo
 * -------------------------------------------------------------------------- */

test("engine.execute existe e é a MESMA função de execute (sem engine paralelo)", () => {
  assert.equal(typeof engine.execute, "function");
  assert.equal(engine.execute, execute, "dois nomes, uma implementação");
});

/* -------------------------------------------------------------------------- *
 * 2 — Happy path
 * -------------------------------------------------------------------------- */

test("happy path: dano válido → ok, estado novo, changes e events", () => {
  const state = estado([personagem(saude({ hp: [30, 40] })), inimigo(saude({ hp: [40, 40], armor: [0, 11] }))]);

  const result = execute(state, ACAO);

  assert.equal(result.ok, true);
  assert.equal(result.errors, undefined);
  assert.notEqual(result.state, state, "saída é um estado NOVO");
  assert.equal(result.state.id, state.id);
  assert.equal(result.state.round, state.round);

  // 20 de dano vs SP 11 → 9 no HP; 20 > 11 → a veste perde 1 SP.
  assert.deepEqual(result.changes, [
    { type: "hp_changed", participantId: INIMIGO_ID, before: 40, after: 31 },
    { type: "armor_changed", participantId: INIMIGO_ID, location: "body", before: 11, after: 10 },
  ]);
  assert.deepEqual(result.rolls, [], "a aplicação de dano não rola nada (F1.3)");
  assert.deepEqual(
    result.events,
    [],
    "eventos são do F1.6 (CombatResult.events → appendEvent): aqui saem prontos",
  );

  const alvo = result.state.participants[1];
  assert.equal(alvo.combat.hp.current, 31);
  assert.equal(alvo.combat.armor.body, 10);
  assert.equal(
    result.state.participants[0],
    state.participants[0],
    "quem não mudou é reutilizado (partilha estrutural)",
  );
});

test("a ação não muta o estado recebido", () => {
  const state = estado([personagem(saude({ hp: [30, 40] })), inimigo(saude({ hp: [40, 40], armor: [0, 11] }))]);
  const antes = structuredClone(state);

  const result = execute(state, ACAO);

  assert.deepEqual(state, antes, "o estado original ficou idêntico ao snapshot");
  assert.notEqual(result.state, state);
  assert.equal(state.participants[1].combat.hp.current, 40, "alvo original com HP intacto");
  assert.equal(state.participants[1].combat.armor.body, 11, "alvo original com veste intacta");
  assert.deepEqual(state.participants[1].combat.criticalInjuries, [], "nenhuma lesão foi acrescentada no original");
});

/* -------------------------------------------------------------------------- *
 * 3 — Regra delegada (nada é recalculado aqui nem no teste)
 * -------------------------------------------------------------------------- */

test("a regra é delegada: o resultado é exatamente o que applyDamage calcula", () => {
  const state = estado([personagem(saude({ hp: [30, 40] })), inimigo(saude({ hp: [40, 40], armor: [0, 11] }))]);
  const esperado = applyDamage(
    { hp: 40, wornArmorSP: 11, cyberwareSP: 0, isDead: false },
    20,
    ENEMY_DAMAGE_POLICY,
    "full",
  );

  const result = execute(state, ACAO);
  const alvo = result.state.participants[1].combat;

  assert.equal(alvo.hp.current, esperado.hpAfter);
  assert.equal(alvo.armor.body, esperado.wornArmorSPAfter);
  assert.equal(
    result.changes.some((change) => change.type === "is_dead_changed"),
    esperado.isDeadAfter !== esperado.isDeadBefore,
    "is_dead_changed só aparece quando a regra muda a derrota",
  );
});

test("o SP de cyberware do CONTRATO participa da absorção (subdérmica ignora o dano)", () => {
  const dano: CombatAction = { type: "damage", actorId: null, targetId: INIMIGO_ID, amount: 10 };
  const comSubdermica = estado([inimigo(saude({ hp: [40, 40], armor: [0, 4], cyberware: [0, 11] }))]);
  const semCyberware = estado([inimigo(saude({ hp: [40, 40], armor: [0, 4], cyberware: [0, 0] }))]);

  const protegido = execute(comSubdermica, dano);
  const exposto = execute(semCyberware, dano);

  assert.equal(protegido.state.participants[0].combat.hp.current, 40, "SP 11 de cyberware absorveu os 10");
  assert.deepEqual(protegido.changes, [], "nem HP nem veste mudaram");
  assert.equal(exposto.state.participants[0].combat.hp.current, 34, "sem o campo, 10 − 4 chegam no HP");
});

test("política enemy: HP trava em 0 e a derrota vem do dano", () => {
  const state = estado([inimigo(saude({ hp: [5, 40] }))]);

  const result = execute(state, { type: "damage", actorId: null, targetId: INIMIGO_ID, amount: 20 });

  assert.equal(result.state.participants[0].combat.hp.current, 0, "não fica negativo");
  assert.equal(
    result.state.participants[0].combat.isDead,
    true,
    "F1.7.1: o estado devolvido reflete a derrota (mesma fonte do is_dead_changed)",
  );
  assert.deepEqual(result.changes, [
    { type: "hp_changed", participantId: INIMIGO_ID, before: 5, after: 0 },
    { type: "is_dead_changed", participantId: INIMIGO_ID, before: false, after: true },
  ]);
});

test("política player: HP pode ficar negativo e a derrota NÃO vem do dano", () => {
  const state = estado([personagem(saude({ hp: [5, 40], armor: [0, 4], deathSave: { dc: 0, failures: 0 } }))]);

  const result = execute(state, { type: "damage", actorId: null, targetId: PC_ID, amount: 20 });

  assert.equal(result.state.participants[0].combat.hp.current, -11, "o Death Save é quem mata");
  assert.equal(result.state.participants[0].combat.isDead, false);
  assert.deepEqual(result.changes, [
    { type: "hp_changed", participantId: PC_ID, before: 5, after: -11 },
    { type: "armor_changed", participantId: PC_ID, location: "body", before: 4, after: 3 },
  ]);
});

test("armorRule explícito tem prioridade sobre o atalho ignoreArmor", () => {
  const state = () => estado([inimigo(saude({ hp: [40, 40], armor: [0, 11] }))]);
  const dano = 12;

  const comIgnore = execute(state(), {
    type: "damage",
    actorId: null,
    targetId: INIMIGO_ID,
    amount: dano,
    ignoreArmor: true,
  });
  const comMeia = execute(state(), {
    type: "damage",
    actorId: null,
    targetId: INIMIGO_ID,
    amount: dano,
    ignoreArmor: true,
    armorRule: "martial_arts_half",
  });

  const esperadoIgnore = applyDamage(
    { hp: 40, wornArmorSP: 11, cyberwareSP: 0, isDead: false },
    dano,
    ENEMY_DAMAGE_POLICY,
    "ignore",
  );
  const esperadoMeia = applyDamage(
    { hp: 40, wornArmorSP: 11, cyberwareSP: 0, isDead: false },
    dano,
    ENEMY_DAMAGE_POLICY,
    "martial_arts_half",
  );

  assert.equal(comIgnore.state.participants[0].combat.hp.current, esperadoIgnore.hpAfter);
  assert.equal(comMeia.state.participants[0].combat.hp.current, esperadoMeia.hpAfter);
  assert.notEqual(comIgnore.state.participants[0].combat.hp.current, comMeia.state.participants[0].combat.hp.current);
});

/* -------------------------------------------------------------------------- *
 * 4 — Critical Injury: o RandomSource do F1.4 dentro do motor
 * -------------------------------------------------------------------------- */

test("limiar de ferimento atravessado → lesão, roll e 2 valores do rng consumidos na ordem", () => {
  const state = estado([personagem(saude({ hp: [30, 40], armor: [0, 4], deathSave: { dc: 0, failures: 0 } }))]);
  const rng = createTestRandomSource([3, 4, 9]); // 2d6 = 7 → "Foreign Object"; sobra o 9

  const result = execute(state, { type: "damage", actorId: null, targetId: PC_ID, amount: 20 }, rng);

  assert.equal(result.ok, true);
  assert.deepEqual(result.rolls, [
    { kind: "critical_injury", actorId: null, targetId: PC_ID, expression: "2d6", rolls: [3, 4], total: 7 },
  ]);
  assert.equal(result.rolls[0].total, 7);

  const lesao = result.changes.find(
    (change): change is Extract<CombatStateChange, { type: "critical_injury_added" }> =>
      change.type === "critical_injury_added",
  );
  assert.ok(lesao, "a lesão aparece nas mudanças observáveis");
  assert.equal(lesao.injury.name, "Foreign Object");
  assert.equal(lesao.injury.roll, 7);
  assert.equal(result.state.participants[0].combat.criticalInjuries.length, 1);

  assert.equal(rng.d10(), 9, "foram consumidos exatamente os 2 valores do 2d6, nessa ordem");
});

test("RNG fica intocado quando a ação não rola nada", () => {
  const state = estado([personagem(saude({ hp: [30, 40], armor: [0, 4], deathSave: { dc: 0, failures: 0 } }))]);
  const rng = createTestRandomSource([5, 6]);

  // 20 → 29 de HP, acima do limiar (20): nenhum sorteio.
  const result = execute(state, { type: "damage", actorId: null, targetId: PC_ID, amount: 5 }, rng);

  assert.equal(result.ok, true);
  assert.deepEqual(result.rolls, []);
  assert.equal(rng.d10(), 5, "nenhum valor da sequência foi consumido");
});

test("inimigo não rastreia lesões: limiar atravessado não gera Critical Injury", () => {
  const state = estado([inimigo(saude({ hp: [40, 40] }))]);
  const rng = createTestRandomSource([3, 4]);

  const result = execute(state, { type: "damage", actorId: null, targetId: INIMIGO_ID, amount: 30 }, rng);

  assert.equal(result.ok, true);
  assert.deepEqual(result.rolls, [], "sem deathSave não há rastreio de lesões (mesmo comportamento do encontro)");
  assert.equal(
    result.changes.some((change) => change.type === "critical_injury_added"),
    false,
  );
  assert.equal(rng.d10(), 3, "nenhuma rolagem foi feita");
});

test("rollCriticalInjuryDetail devolve a lesão E o 2d6 (e repete quando já sofrida)", () => {
  const { injury, roll } = rollCriticalInjuryDetail("body", undefined, createTestRandomSource([3, 4]));
  assert.deepEqual(roll, { expression: "2d6", rolls: [3, 4], total: 7 });
  assert.equal(injury.name, "Foreign Object");
  assert.equal(injury.roll, 7);

  // A assinatura antiga continua devolvendo a MESMA lesão.
  assert.deepEqual(
    rollCriticalInjury("body", undefined, createTestRandomSource([3, 4])),
    injury,
  );

  // Regra de não repetir: a7 (3+4) já sofrida obriga nova rolagem (1+2 = 3).
  const repetida = rollCriticalInjuryDetail(
    "body",
    new Set(["Foreign Object"]),
    createTestRandomSource([3, 4, 1, 2]),
  );
  assert.equal(repetida.roll.total, 3);
  assert.notEqual(repetida.injury.name, "Foreign Object");
});

/* -------------------------------------------------------------------------- *
 * 5 — Determinismo
 * -------------------------------------------------------------------------- */

test("determinismo: mesma entrada + mesma sequência = mesmo resultado mecânico", () => {
  const acao: CombatAction = { type: "damage", actorId: null, targetId: PC_ID, amount: 20 };
  const roda = (sequencia: number[]) =>
    execute(estado([personagem(saude({ hp: [30, 40], armor: [0, 4], deathSave: { dc: 0, failures: 0 } }))]), acao, createTestRandomSource(sequencia));

  const primeiro = roda([3, 4]);
  const repetido = roda([3, 4]);
  const outro = roda([2, 2]);

  assert.equal(primeiro.ok, repetido.ok);
  assert.deepEqual(primeiro.changes, repetido.changes);
  assert.deepEqual(primeiro.rolls, repetido.rolls);
  assert.deepEqual(primeiro.state, repetido.state, "mesma sequência → mesmo estado novo");

  assert.equal(primeiro.rolls[0].total, 7);
  assert.equal(outro.rolls[0].total, 4, "sequência diferente → outro 2d6 → outra lesão");
  assert.notDeepEqual(primeiro.state, outro.state);
});

/* -------------------------------------------------------------------------- *
 * 6 — Validações (erro estruturado, nunca exceção)
 * -------------------------------------------------------------------------- */

function erro(result: CombatResult): CombatError {
  assert.equal(result.ok, false, "esperava recusa");
  const errors = result.errors;
  assert.ok(errors, "recusa vem com errors");
  assert.ok(errors.length > 0, "recusa vem com errors");
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.rolls, []);
  return errors[0];
}

test("actor inexistente → unknown_participant, sem lançar exceção", () => {
  const state = estado([personagem(saude({ hp: [30, 40] })), inimigo(saude({ hp: [40, 40], armor: [0, 11] }))]);
  const antes = structuredClone(state);

  const result = execute(state, { type: "damage", actorId: "fantasma", targetId: INIMIGO_ID, amount: 5 });

  assert.equal(erro(result).code, "unknown_participant");
  assert.equal(result.state, state, "em falha o resultado devolve o mesmo estado");
  assert.deepEqual(state, antes, "nada foi aplicado");
});

test("target inexistente → unknown_participant, sem lançar exceção", () => {
  const state = estado([personagem(saude({ hp: [30, 40] }))]);

  const result = execute(state, { type: "damage", actorId: null, targetId: "fantasma", amount: 5 });

  assert.equal(erro(result).code, "unknown_participant");
  assert.match(erro(result).message, /fantasma/);
});

test("actor derrotado → combatant_defeated (mesma regra de resolveAction)", () => {
  const state = estado([
    personagem(saude({ hp: [0, 40], isDead: true, deathSave: { dc: 6, failures: 3 } })),
    inimigo(saude({ hp: [40, 40], armor: [0, 11] })),
  ]);

  const result = execute(state, ACAO);

  assert.equal(erro(result).code, "combatant_defeated");
});

test("combate encerrado → combat_finished", () => {
  const state = estado([personagem(saude({ hp: [30, 40] })), inimigo(saude({ hp: [40, 40] }))], "finished");

  const result = execute(state, ACAO);

  assert.equal(erro(result).code, "combat_finished");
});

test("ação fora do escopo da F1.5 → invalid_action estruturado (as outras 11 não quebram)", () => {
  const state = estado([personagem(saude({ hp: [30, 40] })), inimigo(saude({ hp: [40, 40] }))]);
  const antes = structuredClone(state);
  const acoes: CombatAction[] = [
    { type: "heal", actorId: PC_ID },
    { type: "initiative", actorId: null },
    { type: "end_turn", actorId: null },
    { type: "other", actorId: PC_ID, label: "qualquer coisa" },
  ];

  for (const acao of acoes) {
    const result = execute(state, acao);
    assert.equal(erro(result).code, "invalid_action", `${acao.type} devia ser recusado`);
    assert.match(erro(result).message, /damage/, "a recusa diz o que ESTÁ integrado");
  }
  assert.deepEqual(state, antes, "recusas não tocam o estado");
});

test("dado inválido → invalid_action com a mesma mensagem da ficha", () => {
  const state = estado([personagem(saude({ hp: [30, 40] }))]);

  for (const amount of [0, -3, 1.5, Number.NaN]) {
    const result = execute(state, { type: "damage", actorId: null, targetId: PC_ID, amount });
    assert.equal(erro(result).code, "invalid_action", `amount=${amount}`);
    assert.equal(erro(result).message, "Dano inválido.");
  }
});

test("local de impacto fora da tabela → invalid_action (dado de JS/JSON não vira NaN)", () => {
  const state = estado([personagem(saude({ hp: [30, 40] }))]);
  const acao = {
    type: "damage",
    actorId: null,
    targetId: PC_ID,
    amount: 5,
    hitLocation: "torso",
  } as unknown as CombatAction;

  assert.equal(erro(execute(state, acao)).code, "invalid_action");
});
