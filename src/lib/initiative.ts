import { rollDice } from "@/lib/dice";
import { getCriticalInjuryModifiers, getWoundPenalty } from "@/lib/calculations";
import { getCyberwareInitiativeModifiers } from "@/lib/cyberwareEffects";
import type { AttackModifier, RollDetail } from "@/types/attack";
import type { Character, RollHistoryEntry } from "@/types/character";

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
  /** Primeiro d10 (é o que a ficha mostra durante a rolagem). */
  diceRoll: number;
  /** Soma dos d10 com o exploding (crítico soma, falha crítica subtrai). */
  diceTotal: number;
  refBonus: number;
  modifiers: AttackModifier[];
  total: number;
  critical: boolean;
  fumble: boolean;
  diceRolls: RollDetail[];
  /** Fórmula legível para a ficha e o histórico. */
  expression: string;
};

function formatExpression(
  refBonus: number,
  modifiers: AttackModifier[],
  diceRoll: number,
  critical: boolean,
  fumble: boolean,
): string {
  const parts = modifiers.map((modifier) => ` ${modifier.value >= 0 ? "+" : ""}${modifier.value} ${modifier.source}`).join("");
  const diceNote = critical ? " (crítico!)" : fumble ? " (falha crítica!)" : "";
  return `REF ${refBonus}${parts} + 1d10 [${diceRoll}]${diceNote}`;
}

/** Rola Iniciativa: REF + modificadores (cyberware, lesões, lesão grave) + 1d10 explodindo.
 * Antes esse cálculo vivia dentro do componente; agora a ficha e os testes usam o mesmo caminho. */
export function rollInitiative(character: Character): { character: Character; result: InitiativeRollResult } {
  const dice = rollDice("1d10");
  const rollValue = dice.rolls[0];
  const isCritical = rollValue === 10;
  const isFumble = rollValue === 1;

  let diceTotal = rollValue;
  const diceRolls: RollDetail[] = [{ value: rollValue, type: "normal" }];
  let extraRoll = 0;

  if (isCritical) {
    const extra = rollDice("1d10");
    extraRoll = extra.rolls[0];
    diceTotal += extraRoll;
    diceRolls[0].type = "crit";
    diceRolls.push({ value: extraRoll, type: "crit_add" });
  } else if (isFumble) {
    const extra = rollDice("1d10");
    extraRoll = extra.rolls[0];
    diceTotal -= extraRoll;
    diceRolls[0].type = "fumble";
    diceRolls.push({ value: extraRoll, type: "fumble_sub" });
  }

  const refBonus = character.stats.REF;
  const modifiers = getInitiativeModifiers(character);
  const modifierTotal = modifiers.reduce((sum, modifier) => sum + modifier.value, 0);
  const total = refBonus + diceTotal + modifierTotal;
  const expression = formatExpression(refBonus, modifiers, rollValue, isCritical, isFumble);

  const result: InitiativeRollResult = {
    initiativeId: crypto.randomUUID(),
    diceRoll: rollValue,
    diceTotal,
    refBonus,
    modifiers,
    total,
    critical: isCritical,
    fumble: isFumble,
    diceRolls,
    expression,
  };

  const entry: RollHistoryEntry = {
    id: crypto.randomUUID(),
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
