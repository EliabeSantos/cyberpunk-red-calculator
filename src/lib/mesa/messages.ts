/**
 * Mensagens compartilhadas da Mesa — usadas pelo SERVIDOR (para rejeitar com
 * texto útil) e pelo CLIENTE (para desabilitar botões com o mesmo motivo).
 *
 * Módulo puro de propósito: importar `store.ts` no navegador levaria
 * `@supabase/supabase-js` + service role para o bundle do cliente.
 */

import type { CombatActionType } from "@/lib/combatEngine";

export const DENIAL_MESSAGES: Record<string, string> = {
  combat_not_active: "O combate ainda não foi iniciado.",
  combat_not_started: "O combate ainda não foi iniciado.",
  combat_finished: "O combate já terminou.",
  initiative_not_started: "Role a iniciativa antes de agir.",
  not_your_turn: "Agora não é o seu turno.",
  not_allowed: "Você só pode agir com o seu próprio personagem.",
  insufficient_actions: "Você não tem ações restantes neste turno.",
  invalid_action: "Ação inválida.",
  movement_exhausted: "Você já gastou todo o movimento deste turno.",
  combatant_defeated: "Este combatente está fora do combate.",
};

export const ACTION_LABELS: Record<CombatActionType, string> = {
  attack: "Ataque",
  move: "Movimento",
  item: "Item",
  other: "Ação",
};

export function denialMessage(reason: string): string {
  return DENIAL_MESSAGES[reason] ?? "Ação não permitida.";
}
