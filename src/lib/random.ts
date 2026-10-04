/**
 * F1.4 — RNG DETERMINÍSTICO para testes.
 *
 * Exatamente a contraparte do `browserRandom` de `src/lib/dice.ts`: mesma
 * interface (`RandomSource` do contrato F1.1), mesmo algoritmo de rolagem
 * (`rollDiceWith`, o parser canônico) — só a origem dos números muda, de
 * `Math.random()` para uma SEQUÊNCIA declarada.
 *
 * ```ts
 * const rng = createTestRandomSource([10, 7, 3]);
 * rng.d10(); // 10
 * rng.d10(); // 7
 * rng.d10(); // 3
 * ```
 *
 * Política de exaustão (F1.4 §8): quando a sequência acaba, a fonte **lança
 * erro**. Ela nunca cai para `Math.random()` e nunca repete valores — um
 * teste determinístico não pode deixar de ser determinístico sem que o teste
 * saiba disso. Valor fora do intervalo do dado (`1..sides`) também lança erro,
 * para não haver resultado "inventado".
 *
 * Consome exatamente um valor por face: `d10()` consome 1, `roll("2d6")`
 * consome 2 — nesse formato e nessa ordem.
 *
 * Módulo puro: só tipos + `rollDiceWith`. Nada de DOM, Supabase, `gmStorage`,
 * React, Next ou `client-only`.
 */
import { rollDiceWith } from "@/lib/dice";
import type { RandomSource } from "@/lib/combat/contract";

export type { RandomSource };

/**
 * Fonte de sorteio controlada por `sequence`. Cada chamada consome o próximo
 * valor; a ordem é a da sequência e nada além dela decide o resultado.
 */
export function createTestRandomSource(sequence: readonly number[]): RandomSource {
  const values = [...sequence];
  let index = 0;

  const nextFace = (sides: number): number => {
    if (index >= values.length) {
      throw new Error(
        `RandomSource de teste esgotado: faltou o valor #${index} para um d${sides} ` +
          `(a sequência tem ${values.length}). Declarou-se a sequência toda?`,
      );
    }
    const value = values[index];
    if (!Number.isInteger(value) || value < 1 || value > sides) {
      throw new Error(
        `RandomSource de teste: valor ${value} na posição ${index} fora do intervalo [1, ${sides}].`,
      );
    }
    index += 1;
    return value;
  };

  return {
    roll: (expression: string) => rollDiceWith(expression, nextFace),
    d10: () => nextFace(10),
  };
}
