/**
 * SELEÇÃO DE PARTICIPANTE por identidade ESTÁVEL — nunca por posição.
 *
 * O problema (F0.5): a tela de encontros guardava `selectedParticipant` como
 * **índice** e comparava `selectedParticipant === index` no render. Mas existe
 * uma reordenação real de `encounter.participants`: `handleRollInitiative`
 * reescreve a lista ordenada por total de iniciativa. Depois da rolagem o
 * índice parado na seleção passa a apontar para OUTRO participante:
 *
 *   antes : A | B | C   seleciona B (índice 1)
 *   depois: C | A | B   índice 1 = A → o destaque e o painel de dano/condições
 *                       migraram do B para o A (reproduzido em F0.5).
 *
 * A correção guarda o **id** e deriva o participante quando precisa — mesma
 * identidade que já sustenta `source_key` na mesa, o espelho de HP e
 * `ensureEncounterIds`. `EncountersPageClient` usa este módulo; a ordenação de
 * iniciativa, as rolagens e o armazenamento não mudam nada.
 */

/** O mínimo que a seleção precisa ler de um participante: a identidade estável. */
export interface SelectableParticipant {
  id?: string;
}

/**
 * Clique num cartão: mesmo id → desmarca; outro id → seleciona.
 *
 * Um participante sem `id` (só possível em ficha salva anterior ao
 * `ensureEncounterIds`, que roda na carga) nunca fica selecionado — devolve
 * `null` em vez de inventar identidade por posição.
 */
export function toggleParticipantSelection(
  currentId: string | null,
  participantId: string | null,
): string | null {
  return currentId === participantId ? null : participantId;
}

/**
 * Participante selecionado AGORA, derivado do id.
 *
 * `null` quando não há seleção, quando o id sumiu (remoção, troca de encontro)
 * ou quando o participante não tem `id` — a seleção nunca "anda" para a posição
 * que ficou no lugar.
 */
export function findParticipantById<T extends SelectableParticipant>(
  participants: readonly T[],
  selectedId: string | null,
): T | null {
  if (selectedId == null) return null;
  return participants.find((participant) => participant.id === selectedId) ?? null;
}
