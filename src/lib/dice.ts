/**
 * F1.4 — NÚCLEO canônico de rolagem + fonte de aleatoriedade padrão.
 *
 * O parser (`NdM`), a validação e a montagem do `DiceResult` continuam aqui,
 * numa função só. O que muda é de onde vem o sorteio de cada face:
 *
 *   Math.random()  →  `randomFace`  →  `rollDiceWith(expression, nextFace)`
 *                                        ↑                ↑
 *                                  browserRandom     RNG de teste
 *                                  (produção)   (createTestRandomSource)
 *
 * `rollDice(expression)` continua funcionando exatamente como antes (usa
 * `browserRandom`, que devolve o mesmo `Math.floor(Math.random() * sides) + 1`
 * de sempre); `rollDice(expression, rng)` recebe a fonte injetável do F1.4.
 *
 * Não existe um segundo parser de dados aqui nem em `src/lib/random.ts`:
 * quem injeta aleatoriedade injeta o *sorteador de faces*, nunca a lógica de
 * expressão, crítico, modificadores ou bônus (F1.4 §4).
 *
 * Módulo puro: nada de `client-only`, React, Next, DOM, `localStorage`,
 * Supabase ou `gmStorage`.
 */
import type { RandomSource } from "@/lib/combat/contract";

export type DiceResult = { expression: string; rolls: number[]; total: number };

/** Sorteia UMA face de um dado com `sides` lados (1..sides). */
export type DiceFaceSource = (sides: number) => number;

/**
 * Rola `expression` no formato `NdM` usando `nextFace` para sortear cada dado.
 * É o núcleo compartilhado: `browserRandom` e o RNG de teste passam por aqui,
 * então validação, normalização da expressão e soma são idênticos nos dois.
 */
export function rollDiceWith(expression: string, nextFace: DiceFaceSource): DiceResult {
  const match = /^(\d+)d(\d+)$/i.exec(expression.trim());
  if (!match) throw new Error(`Expressão de dado inválida: ${expression}`);
  const quantity = Number(match[1]); const sides = Number(match[2]);
  if (!Number.isInteger(quantity) || !Number.isInteger(sides) || quantity < 1 || sides < 2 || quantity > 100) throw new Error(`Expressão de dado inválida: ${expression}`);
  const rolls = Array.from({ length: quantity }, () => nextFace(sides));
  return { expression: `${quantity}d${sides}`, rolls, total: rolls.reduce((sum, roll) => sum + roll, 0) };
}

/** A fórmula de sempre — único lugar que chama `Math.random` para dados. */
function randomFace(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

/**
 * Fonte padrão de PRODUÇÃO: o mesmo algoritmo de antes, atrás do contrato
 * `RandomSource` do F1.1. Nada de seed, replay ou estado aqui (F1.4 §2).
 */
export const browserRandom: RandomSource = {
  roll: (expression: string) => rollDiceWith(expression, randomFace),
  d10: () => randomFace(10),
};

/** Rola expressões simples no formato NdM, por exemplo 2d6 ou 1d10.
 * `rng` é opcional (F1.4): sem ele a fonte é `browserRandom`, ou seja, o
 * comportamento antigo, byte a byte. */
export function rollDice(
  expression: string,
  rng: RandomSource = browserRandom,
): DiceResult {
  return rng.roll(expression);
}
