import { rollDice } from "@/lib/dice";
import type { RandomSource } from "@/lib/combat/contract";
import { getCriticalInjuryModifiers, getWoundPenalty } from "@/lib/calculations";
import { getCyberwareInitiativeModifiers } from "@/lib/cyberwareEffects";
import type { AttackModifier, RollDetail } from "@/types/attack";
import type { Character, RollHistoryEntry } from "@/types/character";
import { createId } from "@/lib/id";

/** Modificadores de Iniciativa que não são a base REF: cyberware, lesões e lesão grave.
 * A base continua sendo só `REF` (fórmula da ficha — ver pergunta em aberto no PENDENCIAS.md). */
export function getInitiativeModifiers(character: Pick<Character, "cyberware" | "combat">): AttackModifier[] {
  const modifiers: AttackModifier[] = [];

  for (const modifier of getCyberwareInitiativeModifiers(character)) {
    modifiers.push({ source: modifier.source, value: modifier.value });
  }

  const injuries = getCriticalInjuryModifiers(character);
  if (injuries.statModifiers.REF) {
    modifiers.push({ source: "STAT REF (lesão)", value: injuries.statModifiers.REF });
  }
  if (injuries.allActionsModifier !== 0) {
    modifiers.push({ source: "Todas ações (lesão)", value: injuries.allActionsModifier });
  }

  // Lesão grave: −2 em todas as ações (mesma fonte de perícia, ataque, Evasão e First Aid).
  const woundPenalty = getWoundPenalty(character);
  if (woundPenalty !== 0) {
    modifiers.push({ source: "Lesão grave (HP)", value: woundPenalty });
  }

  return modifiers;
}

export type InitiativeRollResult = {
  initiativeId: string;
  /** O único d10 da rolagem (é o que a ficha mostra durante o lançamento). */
  diceRoll: number;
  /** Soma dos d10 — em Iniciativa há UM d10, então é sempre igual a `diceRoll`. */
  diceTotal: number;
  refBonus: number;
  modifiers: AttackModifier[];
  total: number;
  diceRolls: RollDetail[];
  /** Fórmula legível para a ficha e o histórico. */
  expression: string;
};

function formatExpression(
  refBonus: number,
  modifiers: AttackModifier[],
  diceRoll: number,
): string {
  const parts = modifiers.map((modifier) => ` ${modifier.value >= 0 ? "+" : ""}${modifier.value} ${modifier.source}`).join("");
  return `REF ${refBonus}${parts} + 1d10 [${diceRoll}]`;
}

/**
 * Rola Iniciativa: **1d10 + REF** + modificadores (cyberware, lesões, lesão grave).
 *
 * A regra de crítico **não vale aqui** (decisão de 27/09/2026): um natural 10
 * não puxa um d10 extra e um natural 1 não subtrai — a Iniciativa é sempre UM
 * d10, igual na tela do encontro e nos inimigos (`rollEnemyInitiative`).
 * Antes esse cálculo vivia dentro do componente; agora a ficha e os testes
 * usam o mesmo caminho.
 */
export function rollInitiative(character: Character, rng?: RandomSource): { character: Character; result: InitiativeRollResult } {
  const dice = rollDice("1d10", rng);
  const rollValue = dice.rolls[0];
  const diceTotal = rollValue;
  const diceRolls: RollDetail[] = [{ value: rollValue, type: "normal" }];

  const refBonus = character.stats.REF;
  const modifiers = getInitiativeModifiers(character);
  const modifierTotal = modifiers.reduce((sum, modifier) => sum + modifier.value, 0);
  const total = refBonus + diceTotal + modifierTotal;
  const expression = formatExpression(refBonus, modifiers, rollValue);

  const result: InitiativeRollResult = {
    initiativeId: createId(),
    diceRoll: rollValue,
    diceTotal,
    refBonus,
    modifiers,
    total,
    diceRolls,
    expression,
  };

  const entry: RollHistoryEntry = {
    id: createId(),
    type: "free_roll",
    label: "Iniciativa",
    characterId: character.id,
    expression,
    rolls: diceRolls.map((roll) => roll.value),
    total,
    timestamp: new Date().toISOString(),
  };

  return {
    character: { ...character, rollHistory: [entry, ...character.rollHistory] },
    result,
  };
}
