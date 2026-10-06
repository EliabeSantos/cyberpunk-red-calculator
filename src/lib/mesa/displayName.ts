/**
 * F1.12.6 — nome de exibição padrão na Mesa (navegador).
 *
 * O `joinMesa` exige `displayName` (1–40 caracteres, validado no servidor), mas
 * o jogador não deveria ter que digitá-lo de novo se a ficha deste navegador
 * já sabe quem ele é. Compartilhado entre a entrada pelo convite (`/mesa/CODE`)
 * e o modal "Mesa online" da ficha para que as duas telas ofereçam o mesmo
 * nome sugerido.
 *
 * Lê `localStorage`, então só pode ser chamado no cliente.
 */

import { getActiveCharacter } from "@/lib/storage";

/** Nome do personagem (ou do jogador) da ficha ativa; vazio se não houver ficha. */
export function defaultMesaDisplayName(): string {
  const character = getActiveCharacter();
  if (!character) return "";
  return (character.identity.player || character.identity.name || "").slice(0, 40);
}
