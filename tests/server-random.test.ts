/**
 * F1.7 Parte A — autoridade da rolagem: fonte de aleatoriedade do SERVIDOR.
 *
 * O que este arquivo protege:
 *   1. `serverRandom` IMPLEMENTA o contrato `RandomSource` (F1.1) e sortea
 *      faces válidas — mesma forma do `browserRandom`, fonte diferente;
 *   2. a fonte do servidor não depende de navegador e não sorteia fora do
 *      módulo responsável (o sorteio comum continua só em `dice.ts`);
 *   3. uma execução server-side CONSEGUE o resultado da rolagem sem receber
 *      o número final do cliente: `rollAttack(personagem, contexto,
 *      serverRandom)` roda inteiro aqui e devolve o total calculado pelos
 *      próprios componentes (STAT + perícia + d10 + modificadores).
 *
 * O endpoint `/combat/roll` NÃO foi migrado nesta fase: a ficha ainda rola o
 * dado antes de chamar o servidor (fire-and-forget) e mudaria o contrato com
 * a UI — a infraestrutura e a prova ficam aqui, o endpoint fica documentado
 * como bloqueado no relatório F1.7 §1.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { RandomSource } from "../src/lib/combat/contract.ts";
import type { Character, Weapon } from "../src/types/character.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_RANDOM_SOURCE = readFileSync(resolve(ROOT, "src", "lib", "serverRandom.ts"), "utf8");

const { serverRandom } = await import("../src/lib/serverRandom.ts");
const { rollAttack } = await import("../src/lib/attacks.ts");
const { createEmptyCharacter } = await import("../src/types/character.ts");

/* -------------------------------------------------------------------------- *
 * Fixture — mesma forma da ficha usada nos testes de contrato: REF 7,
 * Handgun 4, arma equipada, HP cheio (sem penalidade de lesão).
 * -------------------------------------------------------------------------- */

const SERVER_WEAPON_ID = "server-rng-arma";

function arma(): Weapon {
  return {
    id: SERVER_WEAPON_ID,
    name: "Heavy Pistol",
    damage: "3d6",
    rateOfFire: 2,
    attackType: "handgun",
    skill: "handgun",
    magazine: 6,
    ammo: 3,
  };
}

function personagem(): Character {
  const base = createEmptyCharacter("server-rng-personagem");
  const stats = { ...base.stats, REF: 7 };
  return {
    ...base,
    identity: { ...base.identity, name: "V server" },
    stats,
    skills: { ...base.skills, handgun: { ...base.skills.handgun, level: 4 } },
    weapons: [arma()],
  };
}

/* -------------------------------------------------------------------------- *
 * 1 — a fonte implementa RandomSource e sorteia faces válidas
 * -------------------------------------------------------------------------- */

test("serverRandom implementa RandomSource e sorteia faces válidas", () => {
  const rng: RandomSource = serverRandom;
  assert.equal(typeof rng.roll, "function");
  assert.equal(typeof rng.d10, "function");

  const faces: number[] = [];
  for (let i = 0; i < 100; i++) {
    const face = rng.d10();
    assert.ok(Number.isInteger(face) && face >= 1 && face <= 10, `d10 fora do intervalo: ${face}`);
    faces.push(face);
  }
  // Sanidade da fonte: 100 d10 idênticos significariam que nada está sendo sorteado.
  assert.ok(new Set(faces).size > 1, "100 d10 idênticos: a fonte não está sorteando");

  const result = rng.roll("3d6");
  assert.equal(result.expression, "3d6");
  assert.equal(result.rolls.length, 3);
  for (const face of result.rolls) {
    assert.ok(Number.isInteger(face) && face >= 1 && face <= 6, `face de d6 fora do intervalo: ${face}`);
  }
  assert.equal(result.total, result.rolls.reduce((sum, face) => sum + face, 0));
});

/* -------------------------------------------------------------------------- *
 * 2 — sem dependência de navegador, sem sortear fora do módulo responsável
 * -------------------------------------------------------------------------- */

test("a fonte do servidor não depende de navegador nem sorteia por Math.random", () => {
  assert.ok(!SERVER_RANDOM_SOURCE.includes("Math.random"), "serverRandom.ts não pode conter Math.random");

  const imports = [...SERVER_RANDOM_SOURCE.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
  const permitidos = new Set(["node:crypto", "@/lib/dice", "@/lib/combat/contract"]);
  for (const spec of imports) {
    assert.ok(permitidos.has(spec), `import inesperado em serverRandom.ts: ${spec}`);
  }
  // A criptografia do runtime é a origem da face — é ela que define a fonte.
  assert.ok(imports.includes("node:crypto"), "serverRandom.ts deveria importar o crypto do runtime");
  assert.ok(imports.includes("@/lib/dice"), "serverRandom.ts deveria reusar o parser canônico (rollDiceWith)");
});

/* -------------------------------------------------------------------------- *
 * 3 — execução server-side: o resultado nasce no servidor, não chega do cliente
 * -------------------------------------------------------------------------- */

test("execução server-side obtém o resultado da rolagem sem receber o número do cliente", () => {
  // Assinatura: (ficha, contexto, fonte) — nenhum parâmetro recebe `total`,
  // `rolls` ou qualquer número vindo de fora. O total é calculado aqui.
  const resolution = rollAttack(personagem(), { type: "handgun", weaponId: SERVER_WEAPON_ID }, serverRandom);
  if ("error" in resolution) {
    assert.fail(`rollAttack devolveu erro: ${resolution.error}`);
  }
  const { result } = resolution;

  // O total bate exatamente com os componentes internos (conta do próprio rollAttack).
  const modifierSum = result.modifiers.reduce((sum, modifier) => sum + modifier.value, 0);
  assert.equal(
    result.total,
    result.stat.value + result.skill.value + result.diceTotal + modifierSum,
  );
  assert.equal(result.stat.id, "REF");
  assert.equal(result.stat.value, 7);
  assert.equal(result.skill.id, "handgun");
  assert.equal(result.skill.value, 4);

  // Faces sorteadas pela fonte do servidor, dentro do intervalo do d10.
  assert.equal(result.roll.expression, "1d10");
  assert.equal(result.roll.total, result.diceTotal);
  for (const face of result.roll.rolls) {
    assert.ok(Number.isInteger(face) && face >= 1 && face <= 10, `face de d10 fora do intervalo: ${face}`);
  }
  assert.ok(
    Number.isInteger(result.naturalRoll) && result.naturalRoll >= 1 && result.naturalRoll <= 10,
    `naturalRoll inválido: ${result.naturalRoll}`,
  );
});
