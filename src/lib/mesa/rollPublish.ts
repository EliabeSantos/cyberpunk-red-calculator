/**
 * Espelho das rolagens da ficha PARA A MESA (NAVEGADOR).
 *
 * Chamado no mesmo ponto do espelho do Discord (`CharacterToolkit.onUpdate`,
 * quando o histórico ganha uma entrada nova): se este navegador está em uma
 * mesa, o dado também é enviado para lá — vira a ação da mesa e aparece no
 * Registro do combate de todo mundo. Sem mesa ativa, não faz absolutamente
 * nada: o modo local continua exatamente como estava.
 *
 * Fire-and-forget de verdade: a ficha rola o dado antes, depois e mesmo se a
 * mesa estiver fora do ar ou já encerrada.
 */
import { getActiveMembership } from "@/lib/mesa/membershipStore";
import { summarizeRoll } from "@/lib/mesa/rollPolicy";
import { sendMesaRoll } from "@/lib/mesa/client";
import type { RollHistoryEntry } from "@/types/character";

export function publishMesaRoll(entry: RollHistoryEntry | null | undefined): void {
  if (!entry) return;

  const roll = summarizeRoll(entry);
  if (!roll) return; // ex.: humanidade — não é rolagem de mesa

  const membership = getActiveMembership();
  if (!membership) return; // modo local: nada a enviar

  void sendMesaRoll(membership.sessionId, roll).catch(() => {
    // Mesa encerrada, sessão fechada ou rede fora: a ficha local nunca quebra.
  });
}
