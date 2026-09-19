import { rollDice, type DiceResult } from "@/lib/dice";
import type { Character, RollHistoryEntry } from "@/types/character";

export type HumanityLossResult = { cyberwareId: string; cyberwareName: string; expression?: string; rolls: number[]; humanityLost: number; humanityBefore: number; humanityAfter: number };

export function applyHumanityLoss(character: Character, amount: number, reason: string, metadata: Partial<RollHistoryEntry> = {}): { character: Character; humanityBefore: number; humanityAfter: number } {
  const humanityBefore = character.humanity.current; const humanityAfter = Math.max(0, humanityBefore - Math.max(0, amount));
  const entry: RollHistoryEntry = { id: crypto.randomUUID(), type: "humanity_loss", label: reason, characterId: character.id, expression: metadata.expression ?? "fixed", rolls: metadata.rolls ?? [], total: amount, timestamp: new Date().toISOString(), cyberwareId: metadata.cyberwareId, cyberwareName: metadata.cyberwareName, humanityBefore, humanityAfter };
  return { humanityBefore, humanityAfter, character: { ...character, humanity: { ...character.humanity, current: humanityAfter }, rollHistory: [entry, ...character.rollHistory] } };
}

/** Interpreta a perda configurada no catálogo sem alterar o personagem. */
export function rollHumanityLoss(cyberware: { id: string; name: string; humanityLoss?: string | number }): Omit<HumanityLossResult, "humanityBefore" | "humanityAfter"> | null {
  if (cyberware.humanityLoss === undefined || cyberware.humanityLoss === null) return null;
  const result: DiceResult | null = typeof cyberware.humanityLoss === "string" ? rollDice(cyberware.humanityLoss) : null;
  return { cyberwareId: cyberware.id, cyberwareName: cyberware.name, expression: result?.expression, rolls: result?.rolls ?? [], humanityLost: result?.total ?? (typeof cyberware.humanityLoss === "number" ? cyberware.humanityLoss : 0) };
}