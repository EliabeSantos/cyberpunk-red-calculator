/**
 * F1.2 — CONDIÇÕES do participante no encontro.
 *
 * Extraído de `src/lib/gmStorage.ts` sem mudança de assinatura, corpo ou
 * regra (os re-exports de compatibilidade no `gmStorage` mantêm os
 * consumidores atuais intactos).
 *
 * Módulo puro: nada de `client-only`, `gmStorage`, React, Next, `window`,
 * `localStorage` ou Supabase.
 *
 * Arquivo próprio porque condições são um domínio de regra à parte — é nele
 * que o F1.8 (condições mecânicas) vai crescer, sem mexer em ataque/dano/
 * mochila. Hoje ele só adiciona e remove, exatamente como antes: a ficha do
 * jogador não modela condições e a MESA guarda `string[]`
 * (conversão pendente, F1.0 §13 nº 12).
 */
import type { EncounterData } from "@/types/encounter";

export function addParticipantCondition(
  encounter: EncounterData,
  participantIndex: number,
  condition: { id: string; name: string }
): EncounterData {
  const participants = [...encounter.participants];
  const existing = participants[participantIndex].conditions.find((c) => c.id === condition.id);
  if (existing) return encounter;
  participants[participantIndex] = {
    ...participants[participantIndex],
    conditions: [...participants[participantIndex].conditions, condition],
  };
  return { ...encounter, participants };
}

export function removeParticipantCondition(
  encounter: EncounterData,
  participantIndex: number,
  conditionId: string
): EncounterData {
  const participants = [...encounter.participants];
  participants[participantIndex] = {
    ...participants[participantIndex],
    conditions: participants[participantIndex].conditions.filter((c) => c.id !== conditionId),
  };
  return { ...encounter, participants };
}
