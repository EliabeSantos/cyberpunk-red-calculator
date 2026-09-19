export type DiceResult = { expression: string; rolls: number[]; total: number };

/** Rola expressões simples no formato NdM, por exemplo 2d6 ou 1d10. */
export function rollDice(expression: string): DiceResult {
  const match = /^(\d+)d(\d+)$/i.exec(expression.trim());
  if (!match) throw new Error(`Expressão de dado inválida: ${expression}`);
  const quantity = Number(match[1]); const sides = Number(match[2]);
  if (!Number.isInteger(quantity) || !Number.isInteger(sides) || quantity < 1 || sides < 2 || quantity > 100) throw new Error(`Expressão de dado inválida: ${expression}`);
  const rolls = Array.from({ length: quantity }, () => Math.floor(Math.random() * sides) + 1);
  return { expression: `${quantity}d${sides}`, rolls, total: rolls.reduce((sum, roll) => sum + roll, 0) };
}