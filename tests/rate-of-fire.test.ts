/**
 * F1.8D.5 — RATE OF FIRE (ROF)
 *
 * O que a auditoria encontrou e o que esta suíte fixa:
 *
 *   • O projeto NENHUMA vez implementa mecânica de ROF: só dado (`CombatWeapon.
 *     rateOfFire`, catálogo `items.json` e bestiário) e exibição (ficha, botões,
 *     `UNARMED_ROF` de Brawling/Martial Arts em `lib/attacks.ts`).
 *   • `docs/combat-engine-contract.md` §13 nº 8 registra "ROF é informativo:
 *     não limita nada" — este módulo preserva isso.
 *   • A fonte canônica é a ARMA: `weaponId → actor.weapons → rateOfFire`. O
 *     contrato não tem `action.rof` e esta etapa não cria um: um teste forja a
 *     action com `rof: 99` e mostra que o valor que sai é o da arma.
 *   • ROF 1 = o ataque de sempre; ROF 2/3 = MESMO ataque de sempre (1 rolagem,
 *     1 munição). Múltiplos ataques por ROF são RULE GAP — não estão aqui.
 *   • Ausente ≠ erro: `monowire`, `frag_grenade` e `incendiary_grenade` do
 *     catálogo não têm ROF e o ataque continua funcionando.
 *   • Só valor PRESENTE e mal formado recusa (inteiro ≥ 1), ANTES de qualquer
 *     sorteio: nenhum RNG consumido, nenhum estado mudado.
 *
 * Fora do escopo, não testado aqui como se existisse: Autofire, Suppressive,
 * Parry, múltiplas ações, munição por tiro > 1, random hit location, range/DV.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import ts from "typescript";

import { createTestRandomSource } from "../src/lib/random.ts";
import { execute } from "../src/lib/combat/engine.ts";
import type {
  AttackAction,
  AttackResult,
  CombatError,
  CombatParticipant,
  CombatResult,
  CombatState,
  CombatStateChange,
  CombatWeapon,
} from "../src/lib/combat/contract.ts";

/* -------------------------------------------------------------------------- *
 * Fixtures — recortes reais do contrato, montados à mão.
 * -------------------------------------------------------------------------- */

const PC_ID = "f18d5-pc";
const ALVO_ID = "f18d5-alvo";

/** Arma de teste; `rateOfFire` omitido quando não informado (caso monowire). */
function arma(id: string, rateOfFire?: number, { damage = "2d6", ammo = 8 } = {}): CombatWeapon {
  return {
    id,
    name: id,
    damage,
    skill: "handgun",
    attackType: "handgun",
    ammo,
    ...(rateOfFire !== undefined ? { rateOfFire } : {}),
  };
}

function personagem(weapons: CombatWeapon[]): CombatParticipant {
  return {
    id: PC_ID,
    type: "character",
    name: "V",
    source: { characterId: PC_ID, sourceKey: null, enemyId: null },
    stats: { REF: 7, DEX: 6 },
    skills: { handgun: { stat: "REF", level: 6 } },
    combat: {
      hp: { current: 40, max: 40 },
      armor: { head: 0, body: 0 },
      cyberwareSP: { head: 0, body: 0 },
      criticalInjuries: [],
      conditions: [],
      initiative: null,
      isDead: false,
    },
    weapons,
  };
}

/** Alvo inimigo: não rastreia lesões e não tem munição, então não interfere. */
function alvo(): CombatParticipant {
  return {
    id: ALVO_ID,
    type: "enemy",
    name: "Scrappy",
    source: { characterId: null, sourceKey: "scrappy", enemyId: "scrapper" },
    stats: { REF: 6 },
    combat: {
      hp: { current: 40, max: 40 },
      armor: { head: 0, body: 0 },
      cyberwareSP: { head: 0, body: 0 },
      criticalInjuries: [],
      conditions: [],
      initiative: null,
      isDead: false,
    },
  };
}

function estado(weapons: CombatWeapon[]): CombatState {
  return {
    id: "f18d5-combat",
    status: "active",
    round: 1,
    initiativeStarted: true,
    activeParticipantId: PC_ID,
    participants: [personagem(weapons), alvo()],
  };
}

function ataque(overrides: Partial<AttackAction> = {}): AttackAction {
  return {
    type: "attack",
    actorId: PC_ID,
    targetId: ALVO_ID,
    weaponId: "arma-1",
    attackType: "handgun",
    attackMode: "normal",
    defense: { type: "dv", value: 10, source: "range_table" },
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

function resultado(result: CombatResult): AttackResult {
  const r = ok(result);
  assert.ok(r.attackResult, "sucesso de ataque vem com attackResult");
  return r.attackResult;
}

function recusa(result: CombatResult): CombatError {
  assert.equal(result.ok, false, "esperava recusa");
  const errors = result.errors;
  assert.ok(errors && errors.length > 0, "recusa vem com errors");
  assert.equal(result.attackResult, undefined, "recusa não tem attackResult");
  return errors[0];
}

function ammoChanges(result: CombatResult): Extract<CombatStateChange, { type: "ammo_changed" }>[] {
  return result.changes.filter(
    (change): change is Extract<CombatStateChange, { type: "ammo_changed" }> =>
      change.type === "ammo_changed",
  );
}

function armaUsada(state: CombatState, id: string): CombatWeapon {
  const weapon = state.participants[0].weapons?.find((w) => w.id === id);
  assert.ok(weapon, `arma ${id} existe no estado`);
  return weapon;
}

/* ========================================================================== *
 * 1 — ROF 1: compatível com o Attack Engine existente
 * ========================================================================== */

test("ROF 1 → exatamente o ataque de sempre: fórmula, hit, uma rolagem, uma munição", () => {
  const state = estado([arma("arma-1", 1)]);
  const rng = createTestRandomSource([5, 9]);

  const result = execute(state, ataque(), rng);
  const ar = resultado(result);

  // Fórmula do F1.8C intacta: 7 (REF) + 6 (handgun) + 5 (d10) = 18 > DV 10.
  assert.equal(ar.total, 18, "o ROF não entra na fórmula de ataque");
  assert.deepEqual(ar.roll, { expression: "1d10", rolls: [5], total: 5 });
  assert.equal(ar.hit, true);
  assert.equal(ar.critical, false);
  assert.equal(ar.fumble, false);
  assert.equal(ar.rateOfFire, 1, "o valor vem da arma");

  // Uma ação, um tiro: 1 rolagem de ataque e 1 degraus de munição.
  assert.equal(result.rolls.length, 1, "um só ataque");
  assert.deepEqual(ammoChanges(result), [
    { type: "ammo_changed", participantId: PC_ID, weaponId: "arma-1", before: 8, after: 7 },
  ]);
  assert.equal(ar.ammoConsumed, 1);
  assert.equal(armaUsada(result.state, "arma-1").ammo, 7);

  // Consultar ROF não sorteou nada: o sentinela continua na frente.
  assert.equal(rng.d10(), 9, "1 valor consumido (o d10 do ataque)");
});

/* ========================================================================== *
 * 2 e 3 — ROF 2 / ROF 3: obtidos da arma, sem múltiplos ataques
 * ========================================================================== */

test("ROF 2 → valor da arma transportado; NÃO vira dois ataques nem dois tiros", () => {
  const state = estado([arma("arma-1", 2, { ammo: 12 })]);
  const rng = createTestRandomSource([5, 9]);

  const result = execute(state, ataque(), rng);
  const ar = resultado(result);

  assert.equal(ar.rateOfFire, 2, "o valor sai da arma");
  assert.equal(ar.total, 18, "a fórmula continua a mesma (ROF não modifica)");

  // A mecânica de múltiplos ataques NÃO existe no projeto (RULE GAP): nada
  // aqui rola duas vezes nem gasta duas munições.
  assert.equal(result.rolls.length, 1, "UMA rolagem de ataque, não duas");
  assert.deepEqual(ammoChanges(result), [
    { type: "ammo_changed", participantId: PC_ID, weaponId: "arma-1", before: 12, after: 11 },
  ]);
  assert.equal(ar.ammoConsumed, 1, "1 munição, como em F1.8C");

  assert.equal(rng.d10(), 9, "nenhum sorteio extra por consultar ROF 2");
});

test("ROF 3 → mesmo tratamento: só transporta o valor", () => {
  const state = estado([arma("arma-1", 3)]);
  const rng = createTestRandomSource([5, 9]);

  const result = execute(state, ataque(), rng);
  const ar = resultado(result);

  assert.equal(ar.rateOfFire, 3);
  assert.equal(result.rolls.length, 1, "nenhum laço de múltiplos ataques");
  assert.equal(armaUsada(result.state, "arma-1").ammo, 7, "uma unidade de munição");
  assert.equal(rng.d10(), 9, "1 valor consumido");
});

/* ========================================================================== *
 * 4 — weaponId → arma certa → ROF certo
 * ========================================================================== */

test("weaponId decide qual arma (e qual ROF): cada uma com o seu valor", () => {
  const armas = [
    arma("lenta", 1, { ammo: 8 }),
    arma("rapida", 2, { ammo: 12 }),
  ];

  // Arma "rapida": o ROF sai dela e a MUNIÇÃO dela é a que desce.
  const rapida = execute(estado(armas), ataque({ weaponId: "rapida" }), createTestRandomSource([5, 9]));
  const arRapida = resultado(rapida);
  assert.equal(arRapida.weaponId, "rapida");
  assert.equal(arRapida.rateOfFire, 2, "ROF da arma escolhida");
  assert.equal(armaUsada(rapida.state, "rapida").ammo, 11);
  assert.equal(armaUsada(rapida.state, "lenta").ammo, 8, "a outra arma nem foi tocada");

  // Arma "lenta": mesmo ataque, outro ROF, outra munição.
  const lenta = execute(estado(armas), ataque({ weaponId: "lenta" }), createTestRandomSource([5, 9]));
  const arLenta = resultado(lenta);
  assert.equal(arLenta.weaponId, "lenta");
  assert.equal(arLenta.rateOfFire, 1);
  assert.equal(armaUsada(lenta.state, "lenta").ammo, 7);
  assert.equal(armaUsada(lenta.state, "rapida").ammo, 12, "a outra arma nem foi tocada");
});

/* ========================================================================== *
 * 5 — weaponId inexistente
 * ========================================================================== */

test("weaponId inexistente → CombatError, sem RNG e sem estado novo", () => {
  const state = estado([arma("arma-1", 2)]);
  const rng = createTestRandomSource([5, 9]);

  const error = recusa(execute(state, ataque({ weaponId: "arma-fantasma" }), rng));

  assert.equal(error.code, "rule_violation");
  assert.match(error.message, /WEAPON_NOT_FOUND/);
  assert.equal(rng.d10(), 5, "nenhum valor consumido: a recusa veio antes do sorteio");
  assert.equal(error.message.includes("rateOfFire"), false, "a recusa é da arma, não do ROF");
});

/* ========================================================================== *
 * 6 — ROF inválido (e ausente, que é legítimo)
 * ========================================================================== */

test("ROF presente e mal formado → CombatError antes de qualquer sorteio", () => {
  for (const invalido of [0, -1, 2.5]) {
    const state = estado([arma("arma-1", invalido)]);
    const rng = createTestRandomSource([5, 9]);

    const result = execute(state, ataque(), rng);
    const error = recusa(result);

    assert.equal(error.code, "rule_violation", `ROF ${invalido} é recusado`);
    assert.match(error.message, /rateOfFire inválido/);
    assert.match(error.message, new RegExp(String(invalido).replace(".", "\\.")));
    assert.equal(rng.d10(), 5, `ROF ${invalido}: nenhum valor consumido`);
    assert.deepEqual(result.state, state, "estado volta intacto");
  }
});

test("arma SEM ROF declarado → ataque funciona (ausente não é erro)", () => {
  // Monowire, frag_grenade e incendiary_grenade do catálogo não têm `rof`.
  const state = estado([arma("arma-1")]);
  const rng = createTestRandomSource([5, 9]);

  const ar = resultado(execute(state, ataque(), rng));

  assert.equal(ar.rateOfFire, undefined, "sem ROF declarado, o campo fica ausente");
  assert.equal(ar.hit, true, "o ataque segue intacto");
  assert.equal(ar.ammoConsumed, 1);
});

/* ========================================================================== *
 * 7 — A action NÃO manda no ROF (fonte canônica)
 * ========================================================================== */

test("ROF forjado na action é ignorado: o valor que sai é o da arma", () => {
  const state = estado([arma("arma-1", 1)]);
  const rng = createTestRandomSource([5, 9]);

  // `Object.assign` injeta o campo sem cast: a action chega ao motor carregando
  // um ROF que o contrato nem declara — e o motor continua lendo a arma.
  const action = Object.assign(ataque(), { rof: 99, rateOfFire: 99 });

  const ar = resultado(execute(state, action, rng));

  assert.equal(ar.rateOfFire, 1, "a arma manda, a action não");
  assert.notEqual(ar.rateOfFire, 99);
});

/* ========================================================================== *
 * 8 — Ataque por perícia (sem arma) não tem ROF
 * ========================================================================== */

test("ataque por perícia (sem weaponId) → rateOfFire ausente", () => {
  const state = estado([arma("arma-1", 2)]);
  const rng = createTestRandomSource([5, 9]);

  const ar = resultado(execute(state, ataque({ weaponId: undefined, skillId: "handgun" }), rng));

  assert.equal(ar.weaponId, undefined);
  assert.equal(ar.rateOfFire, undefined, "ROF é propriedade de arma; sem arma não há ROF");
  assert.equal(ar.total, 18, "o caminho de perícia continua o de sempre");
});

/* ========================================================================== *
 * 9 — Determinismo
 * ========================================================================== */

test("determinismo: consultar ROF não altera o consumo do RandomSource", () => {
  const roda = (sequencia: number[], rateOfFire?: number) => {
    const rng = createTestRandomSource(sequencia);
    const result = execute(estado([arma("arma-1", rateOfFire)]), ataque(), rng);
    return { result, rng };
  };

  const r1 = roda([5, 9], 2);
  const r2 = roda([5, 9], 2);
  const r3 = roda([5, 9], 1);

  // Fontes INDEPENDENTES: cada chamada cria o seu RandomSource.
  const a1 = resultado(r1.result);
  const a2 = resultado(r2.result);
  assert.equal(a1.rateOfFire, 2);
  assert.deepEqual(
    { total: a1.total, roll: a1.roll, hit: a1.hit },
    { total: a2.total, roll: a2.roll, hit: a2.hit },
    "mesma sequência → mesmo ataque",
  );
  assert.deepEqual(r1.result.changes, r2.result.changes);
  assert.deepEqual(r1.result.state, r2.result.state);

  // Trocar só o ROF da arma não muda a rolagem nem o consumo de sorteios.
  const a3 = resultado(r3.result);
  assert.equal(a3.rateOfFire, 1);
  assert.deepEqual(a3.roll, a1.roll, "mesmo d10");
  assert.equal(r1.rng.d10(), 9, "ROF 2: 1 valor consumido (só o d10 do ataque)");
  assert.equal(r3.rng.d10(), 9, "ROF 1: 1 valor consumido — mesmo total de sorteios");
});

/* ========================================================================== *
 * 10 — Pureza do caminho de ROF (AST: comentário não conta)
 * ========================================================================== */

const ARQUIVOS_PUREZA = ["src/lib/combat/engine.ts", "src/lib/combat/contract.ts"];

const AMBIENTE_PROIBIDO = new Set([
  "window",
  "document",
  "localStorage",
  "sessionStorage",
  "gmStorage",
  "supabase",
  "React",
  "fetch",
]);

test("pureza: a resolução de ROF não toca DOM, rede, persistência nem Math.random", () => {
  for (const rel of ARQUIVOS_PUREZA) {
    const source = readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
    const ast = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    const identificadores: string[] = [];
    let mathRandom = 0;
    const importsValue: string[] = [];

    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && AMBIENTE_PROIBIDO.has(node.text)) identificadores.push(node.text);
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "Math" &&
        node.name.text === "random"
      ) {
        mathRandom++;
      }
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
        importsValue.push(node.moduleSpecifier.getText(ast).replace(/^["']|["']$/g, ""));
      }
      node.forEachChild(visit);
    };
    ast.forEachChild(visit);

    assert.deepEqual(identificadores, [], `${rel} não pode citar ambiente client/persistência`);
    assert.equal(mathRandom, 0, `${rel} não pode chamar Math.random`);
    assert.deepEqual(
      importsValue.filter((spec) => /^(react|next|client-only)|supabase|gmStorage/.test(spec)),
      [],
      `${rel} não pode importar UI/persistência/rede`,
    );
  }
});

/* ========================================================================== *
 * 11 — Regressão de contrato: o AttackAction continua sem `rof`
 * ========================================================================== */

test("o contrato de ataque não mudou: AttackAction segue sem campo de ROF", () => {
  const source = readFileSync(new URL("../src/lib/combat/contract.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("contract.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  let iface: ts.InterfaceDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === "AttackAction") iface = node;
    node.forEachChild(visit);
  };
  ast.forEachChild(visit);

  assert.ok(iface, "AttackAction existe");
  const propriedades = iface.members
    .filter(ts.isPropertySignature)
    .map((member) => (member.name && ts.isIdentifier(member.name) ? member.name.text : ""));
  const temCampoDeRof = propriedades.some((nome) => nome === "rof" || nome === "rateOfFire");
  assert.equal(temCampoDeRof, false, "o cliente não pode declarar ROF na action");
  assert.ok(propriedades.includes("weaponId"), "a action continua resolvendo pela arma");
});
