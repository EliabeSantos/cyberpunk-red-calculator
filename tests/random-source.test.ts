/**
 * F1.4 — RandomSource: mesma entrada + mesma sequência = mesmo resultado.
 *
 * A etapa é de INFRAESTRUTURA de aleatoriedade, não de regras. Este arquivo
 * cobre as três faces disso:
 *
 *   1. o RNG determinístico de teste (`createTestRandomSource`) — sequência,
 *      consumo previsível e exaustão com política EXPLÍCITA (lança erro; nunca
 *      cai em `Math.random`, nunca repete);
 *   2. a injeção nas regras que rolam dado — d10, `rollDice`, ataque, evasão,
 *      Critical Injury, iniciativa e dano — sempre mostrando que a MESMA
 *      sequência produz o MESMO resultado;
 *   3. o que NÃO virou RNG: `Math.random` continua encapsulado no
 *      `browserRandom` de `dice.ts`, `combat/damage.ts` continua sem
 *      aleatoriedade nenhuma, e identidade/timestamps continuam sendo
 *      identidade/timestamps.
 *
 * Nenhuma regra foi alterada: os valores vêm da fonte, a aritmética continua
 * a de sempre.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { createEmptyCharacter } from "../src/types/character.ts";
import { browserRandom, rollDice, rollDiceWith } from "../src/lib/dice.ts";
import { createTestRandomSource } from "../src/lib/random.ts";
import { rollAttack, rollEvasion } from "../src/lib/attacks.ts";
import { rollInitiative } from "../src/lib/initiative.ts";
import { rollEnemyInitiative } from "../src/lib/combatEngine.ts";
import { rollCriticalInjury } from "../src/data/criticalInjuries.ts";
import { applyReceivedDamage, rollDamageForLastAttack } from "../src/lib/damage.ts";
import type { AttackContext } from "../src/types/attack.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DICE_FILE = resolve(ROOT, "src", "lib", "dice.ts");
const RANDOM_FILE = resolve(ROOT, "src", "lib", "random.ts");
const CANONICAL_DAMAGE_FILE = resolve(ROOT, "src", "lib", "combat", "damage.ts");

/** Contexto mínimo de ataque: perícia padrão da ficha, sem arma nem modificador. */
const CONTEXT: AttackContext = { type: "brawling", skillId: "brawling" };

/* -------------------------------------------------------------------------- *
 * 1. O RNG determinístico
 * -------------------------------------------------------------------------- */

test("d10() devolve exatamente a sequência declarada", () => {
  const rng = createTestRandomSource([10, 7, 3]);
  assert.equal(rng.d10(), 10);
  assert.equal(rng.d10(), 7);
  assert.equal(rng.d10(), 3);
});

test("uma chamada a mais consome exatamente o próximo valor", () => {
  const rng = createTestRandomSource([1, 2, 3, 4, 5]);

  assert.deepEqual([rng.d10(), rng.d10()], [1, 2]);
  assert.equal(rng.d10(), 3, "não repete nem pula posição");
  assert.deepEqual(rng.roll("1d10").rolls, [4]);
  assert.deepEqual(rng.roll("1d10").rolls, [5]);
});

test("sequência esgotada lança erro — nunca cai em Math.random", () => {
  const rng = createTestRandomSource([9]);
  assert.equal(rng.d10(), 9);

  assert.throws(() => rng.d10(), /esgotado/, "o fim da sequência é um erro explícito");
  // Continua erro, não um número "qualquer": a fonte não deixou de ser
  // determinística porque a sequência acabou.
  assert.throws(() => rng.d10(), /esgotado/);
  assert.throws(() => rng.roll("1d6"), /esgotado/);
});

test("valor fora do intervalo do dado lança erro", () => {
  const rng = createTestRandomSource([10]);
  assert.throws(() => rollDice("1d6", rng), /fora do intervalo \[1, 6\]/);

  const naoInteiro = createTestRandomSource([2.5]);
  assert.throws(() => naoInteiro.d10(), /fora do intervalo \[1, 10\]/);
});

test("roll(expression) usa o MESMO parser do rollDice — não há um segundo parser", () => {
  const rng = createTestRandomSource([4, 3]);
  assert.deepEqual(rng.roll("2d6"), { expression: "2d6", rolls: [4, 3], total: 7 });

  // Mesma normalização do núcleo: trim, case-insensitive, expressão canônica.
  const normalizado = createTestRandomSource([2, 2]);
  assert.deepEqual(normalizado.roll("  2D6 "), { expression: "2d6", rolls: [2, 2], total: 4 });

  // E o MESMO erro para expressão inválida.
  assert.throws(() => createTestRandomSource([]).roll("fireball"), /Expressão de dado inválida/);
  assert.throws(() => rollDice("fireball"), /Expressão de dado inválida/);
});

test("o núcleo compartilhado aceita qualquer sorteador de faces", () => {
  const faces = [6, 5, 4];
  let cursor = 0;
  const result = rollDiceWith("3d6", () => faces[cursor++]);
  assert.deepEqual(result, { expression: "3d6", rolls: [6, 5, 4], total: 15 });
  assert.equal(cursor, 3, "um valor por dado, na ordem da expressão");
});

/* -------------------------------------------------------------------------- *
 * 2. Mesma entrada + mesma sequência = mesmo resultado, nas regras
 * -------------------------------------------------------------------------- */

test("rollDice: mesma sequência → mesmo resultado (d10 e 2d6)", () => {
  const a = rollDice("2d6", createTestRandomSource([6, 5]));
  const b = rollDice("2d6", createTestRandomSource([6, 5]));
  assert.deepEqual(a, b);
  assert.deepEqual(a, { expression: "2d6", rolls: [6, 5], total: 11 });

  const d10 = rollDice("1d10", createTestRandomSource([10]));
  assert.deepEqual(d10, { expression: "1d10", rolls: [10], total: 10 });
});

test("compatibilidade: a chamada antiga continua funcionando sem RNG (§5)", () => {
  const legado = rollDice("3d6");
  assert.equal(legado.expression, "3d6");
  assert.equal(legado.rolls.length, 3);
  for (const face of legado.rolls) assert.ok(face >= 1 && face <= 6, `face ${face} fora de 1..6`);
  assert.equal(legado.total, legado.rolls.reduce((sum, face) => sum + face, 0));

  // A fonte padrão continua sendo uma RandomSource válida, plugável no mesmo lugar.
  const viaBrowser = rollDice("3d6", browserRandom);
  assert.equal(viaBrowser.rolls.length, 3);
  assert.equal(browserRandom.d10() >= 1 && browserRandom.d10() <= 10, true);
});

test("ataque: mesma sequência → mesmo resultado; crítico e falha saem da fonte", () => {
  const ataque = (sequence: number[]) => {
    const resolution = rollAttack(
      createEmptyCharacter("rng-attack"),
      CONTEXT,
      createTestRandomSource(sequence),
    );
    assert.ok(!("error" in resolution), "contexto válido não pode virar erro");
    return resolution.result;
  };

  const comum = ataque([7]);
  assert.deepEqual(comum.roll.rolls, [7]);
  assert.equal(comum.critical, false);
  assert.equal(comum.fumble, false);

  // 10 explode: rola mais UMA vez e soma (regra atual, intacta).
  const critico = ataque([10, 4]);
  const critico2 = ataque([10, 4]);
  assert.deepEqual(critico.roll.rolls, [10, 4]);
  assert.equal(critico.diceTotal, 14);
  assert.equal(critico.critical, true);
  assert.deepEqual(critico.roll.rolls, critico2.roll.rolls, "mesma sequência, mesmos dados");
  assert.equal(critico.total, critico2.total, "mesma sequência, mesmo total");

  // 1 subtrai: rola mais UMA vez e subtrai (regra atual, intacta).
  const falha = ataque([1, 5]);
  const falha2 = ataque([1, 5]);
  assert.deepEqual(falha.roll.rolls, [1, 5]);
  assert.equal(falha.diceTotal, -4, "1 − 5 = −4");
  assert.equal(falha.fumble, true);
  assert.equal(falha.total, falha2.total);

  // Identidade continua sendo identidade: NÃO passou pelo RandomSource (§15).
  assert.notEqual(critico.attackId, critico2.attackId);
  assert.ok(critico.attackId.length > 0);
});

test("evasão: mesma sequência → mesmo resultado", () => {
  const evasao = (sequence: number[]) => {
    const resolution = rollEvasion(
      createEmptyCharacter("rng-evasion"),
      [],
      createTestRandomSource(sequence),
    );
    assert.ok(!("error" in resolution));
    return resolution.result;
  };

  const uma = evasao([10, 6]);
  const outra = evasao([10, 6]);
  assert.deepEqual(uma.roll.rolls, [10, 6]);
  assert.equal(uma.critical, true);
  assert.equal(uma.diceTotal, 16);
  assert.equal(uma.total, outra.total);
  assert.deepEqual(uma.roll.rolls, outra.roll.rolls);
});

test("Critical Injury: mesma sequência → mesma lesão, e o consumo é previsível", () => {
  const rng = createTestRandomSource([4, 3]);
  const injury = rollCriticalInjury("body", new Set(), rng);
  assert.equal(injury.roll, 7, "2d6 = 4 + 3");
  assert.equal(injury.name, "Foreign Object", "tabela body, roll 7");
  // Consumiu exatamente os 2 valores da rolagem — nada além.
  assert.throws(() => rng.d10(), /esgotado/, "2 valores consumidos");

  // Lesão repetida → nova rolagem (regra oficial intacta): mais 2 valores.
  const retry = createTestRandomSource([4, 3, 5, 5]);
  const outra = rollCriticalInjury("body", new Set(["Foreign Object"]), retry);
  assert.notEqual(outra.name, "Foreign Object", "a lesão já sofrida é re-rolada");
  assert.throws(() => retry.d10(), /esgotado/, "4 valores consumidos: 2 + 2");

  const a = rollCriticalInjury("head", new Set(), createTestRandomSource([2, 2]));
  const b = rollCriticalInjury("head", new Set(), createTestRandomSource([2, 2]));
  assert.equal(a.name, b.name, "mesma sequência, mesma lesão");
});

test("iniciativa: mesma sequência → mesmo resultado (ficha e inimigo)", () => {
  const character = createEmptyCharacter("rng-initiative");
  const uma = rollInitiative(character, createTestRandomSource([7])).result;
  const outra = rollInitiative(character, createTestRandomSource([7])).result;

  assert.equal(uma.diceRoll, 7);
  assert.equal(uma.diceTotal, 7);
  assert.equal(uma.total, outra.total, "REF + modificadores + mesmo d10");
  assert.equal(uma.expression, outra.expression);
  // O id continua sendo id (§15), então não comparamos o objeto inteiro.
  assert.notEqual(uma.initiativeId, outra.initiativeId);

  assert.equal(rollEnemyInitiative(5, 4, createTestRandomSource([7])), 16, "REF 5 + bônus 4 + 1d10 = 7");
  assert.equal(rollEnemyInitiative(5, 4, createTestRandomSource([7])), rollEnemyInitiative(5, 4, createTestRandomSource([7])));
});

test("RNG → rollDamage → número de dano, sem RNG na aplicação (§14)", () => {
  const ataque = rollAttack(createEmptyCharacter("rng-damage"), CONTEXT, createTestRandomSource([7]));
  assert.ok(!("error" in ataque));

  const um = rollDamageForLastAttack(ataque.character, createTestRandomSource([6, 6, 6]));
  const dois = rollDamageForLastAttack(ataque.character, createTestRandomSource([6, 6, 6]));
  assert.ok(!("error" in um) && !("error" in dois));
  assert.deepEqual(um.result.roll, dois.result.roll, "mesma sequência, mesma rolagem de dano");
  assert.equal(um.result.total, dois.result.total);
  assert.equal(um.result.total, um.result.roll.rolls.reduce((sum, face) => sum + face, 0));
});

test("a Critical Injury injetável atravessa a ficha sem mudar a regra (§10)", () => {
  const character = createEmptyCharacter("rng-ci");
  // 30 → 10 com threshold 20: fica Seriously Wounded, sem Critical Injury.
  character.combat.hp = { current: 30, max: 40 };

  const um = applyReceivedDamage(character, 20, "body", createTestRandomSource([4, 3]));
  assert.ok(!("error" in um));
  assert.equal(um.result.crossedWoundThreshold, true, "o limite foi atravessado, como sempre");
  assert.equal(um.result.criticalInjury, undefined);
  assert.equal(um.result.hpAfter, 10, "a aplicação de dano não mudou");

  const dois = applyReceivedDamage(character, 20, "body", createTestRandomSource([4, 3]));
  assert.ok(!("error" in dois));
  assert.equal(dois.result.criticalInjury, undefined);
});

/* -------------------------------------------------------------------------- *
 * 3. O que NÃO virou RNG (arquitetura)
 * -------------------------------------------------------------------------- */

interface ModuleScan {
  /** Chamadas `Math.random()` reais (comentários não contam). */
  mathRandom: number;
  imports: string[];
  /** Algum identificador `RandomSource` no código (comentários não contam). */
  usesRandomSource: boolean;
  usesIdentityOrClock: boolean;
}

/** Varre a AST: comentário à mão não engana este teste. */
function scanModule(file: string): ModuleScan {
  const source = readFileSync(file, "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const scan: ModuleScan = { mathRandom: 0, imports: [], usesRandomSource: false, usesIdentityOrClock: false };

  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "random" &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Math"
    ) {
      scan.mathRandom += 1;
    }
    if (ts.isImportDeclaration(node)) {
      scan.imports.push(node.moduleSpecifier.getText(ast).replace(/^["']|["']$/g, ""));
    }
    if (ts.isIdentifier(node)) {
      if (node.text === "RandomSource") scan.usesRandomSource = true;
      if (node.text === "randomUUID" || node.text === "Date" || node.text === "now") {
        scan.usesIdentityOrClock = true;
      }
    }
    node.forEachChild(visit);
  };
  ast.forEachChild(visit);
  return scan;
}

test("Math.random existe num lugar só: o browserRandom de dice.ts", () => {
  const dice = scanModule(DICE_FILE);
  assert.equal(dice.mathRandom, 1, "uma única fórmula de face (randomFace)");

  assert.equal(scanModule(RANDOM_FILE).mathRandom, 0, "o RNG de teste não chama Math.random");
  assert.equal(
    scanModule(CANONICAL_DAMAGE_FILE).mathRandom,
    0,
    "a aplicação de dano continua sem aleatoriedade nenhuma",
  );
});

test("combat/damage.ts segue determinístico: sem dado, sem RandomSource", () => {
  const damage = scanModule(CANONICAL_DAMAGE_FILE);
  assert.equal(damage.usesRandomSource, false, "applyDamage não conhece RandomSource");
  assert.ok(
    !damage.imports.some((spec) => spec.includes("/dice") || spec.includes("/random")),
    `imports de aleatoriedade no módulo de dano: ${damage.imports.join(", ")}`,
  );
  // Ele continua recebendo dano PRONTO — rolagem e aplicação separadas (§14).
  assert.ok(
    !damage.imports.some((spec) => spec.includes("gmStorage")),
    "e segue fora da camada de persistência",
  );
});

test("identidade e timestamps NÃO viraram RandomSource (§15)", () => {
  for (const file of [DICE_FILE, RANDOM_FILE]) {
    const scan = scanModule(file);
    assert.equal(
      scan.usesIdentityOrClock,
      false,
      `${file}: crypto.randomUUID/Date não são dado de Cyberpunk RED`,
    );
  }
});
