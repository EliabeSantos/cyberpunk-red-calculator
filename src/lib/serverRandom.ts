/**
 * F1.7 — `RandomSource` do SERVIDOR.
 *
 * Onde o navegador sortea com `browserRandom` (o sorteio comum de
 * `src/lib/dice.ts`), o servidor sortea com `node:crypto.randomInt` — a fonte
 * de aleatoriedade do runtime em que rodam as rotas `runtime = "nodejs"`.
 * É a fonte que uma futura execução de regra no servidor recebe:
 *
 *     engine.execute(state, action, serverRandom)   // motor (F1.5)
 *     rollAttack(personagem, contexto, serverRandom) // rolagem de ataque
 *
 * Assim o servidor gera o número ele mesmo, sem receber o resultado pronto
 * do cliente (Parte A do F1.7).
 *
 * O parser de expressão (`NdM`, validação, montagem do `DiceResult`) continua
 * sendo o ÚNICO, `rollDiceWith` de `src/lib/dice.ts` — aqui só muda a origem
 * da face, do mesmo jeito que o RNG de teste do F1.4. Nenhum segundo parser
 * de dados foi criado.
 *
 * O que este módulo deliberadamente NÃO tem: seed, replay, RNG persistido,
 * estado entre requisições ou qualquer endpoint de aleatoriedade. Cada face é
 * sorteada de forma independente e não enviesada (`randomInt` de `node:crypto`
 * corrige o arredondamento para baixo) e não compartilha estado com o sorteio
 * do cliente.
 *
 * `browserRandom` continua sendo o default de `rollDice` e nenhum consumidor
 * foi migrado nesta fase: quem executa regra no servidor injeta `serverRandom`
 * pelo último parâmetro opcional.
 *
 * Módulo puro: importa `node:crypto` + `dice.ts` + tipo do contrato. Sem
 * React, Next, Supabase, armazenamento local nem ambiente de navegador.
 */
import { randomInt } from "node:crypto";

import { rollDiceWith } from "@/lib/dice";
import type { RandomSource } from "@/lib/combat/contract";

/** Face de um dado de `sides` lados, sorteada pela criptografia do runtime. */
function cryptoFace(sides: number): number {
  return randomInt(sides) + 1;
}

/** A fonte que o servidor usa para executar regras (F1.7 Parte A). */
export const serverRandom: RandomSource = {
  roll: (expression: string) => rollDiceWith(expression, cryptoFace),
  d10: () => cryptoFace(10),
};
