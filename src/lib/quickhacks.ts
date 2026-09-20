import { rollDice } from "@/lib/dice";
import type { Character, RollHistoryEntry } from "@/types/character";
import { quickhackDefinitions } from "@/data/quickhacks";
import type { Quickhack, QuickhackCategory } from "@/data/quickhacks";

export type { Quickhack, QuickhackCategory } from "@/data/quickhacks";

export interface QuickhackRollResult {
  quickhackId: string;
  quickhackName: string;
  category: QuickhackCategory;
  dv: number;
  stat: { id: "INT"; value: number };
  skill: { id: "interface"; value: number };
  roll: { expression: string; rolls: number[]; total: number };
  total: number;
  success: boolean;
  effect: string;
  duration: string;
  notes?: string;
}

export function rollQuickhack(
  character: Character,
  quickhackId: string,
):
  | {
      character: Character;
      result: QuickhackRollResult;
    }
  | { error: string; character: Character } {
  const quickhack = quickhackDefinitions[quickhackId];
  if (!quickhack) {
    return { error: `Quickhack "${quickhackId}" não encontrado.`, character };
  }

  const interfaceSkill = character.skills.interface;
  if (!interfaceSkill || interfaceSkill.level <= 0) {
    return {
      error: "Personagem não possui a perícia Interface ou está no nível 0.",
      character,
    };
  }

  const roll = rollDice("1d10");
  const total = interfaceSkill.level + roll.total;
  const success = total >= quickhackDefinitions[quickhackId].dv;

  const result: QuickhackRollResult = {
    quickhackId,
    quickhackName: quickhackDefinitions[quickhackId].name,
    category: quickhackDefinitions[quickhackId].category,
    dv: quickhackDefinitions[quickhackId].dv,
    stat: { id: "INT", value: 0 },
    skill: { id: "interface", value: interfaceSkill.level },
    roll,
    total,
    success,
    effect: quickhackDefinitions[quickhackId].effect,
    duration: quickhackDefinitions[quickhackId].duration,
    notes: quickhackDefinitions[quickhackId].notes,
  };

  const historyEntry: RollHistoryEntry = {
    id: crypto.randomUUID(),
    type: "skill_check",
    label: `Quickhack: ${quickhackDefinitions[quickhackId].name}`,
    characterId: character.id,
    expression: `1d10 + Interface`,
    rolls: roll.rolls,
    total,
    timestamp: new Date().toISOString(),
    stat: { id: "INT", value: 0 },
    skill: { id: "interface", value: interfaceSkill.level },
    modifiers: [],
  };

  const updatedCharacter: Character = {
    ...character,
    rollHistory: [historyEntry, ...character.rollHistory],
  };

  return { character: updatedCharacter, result };
}
