"use client";

/**
 * F1.12.3 — vínculo AUTOMÁTICO da ficha ativa do navegador à Mesa.
 *
 * Quando o jogador ainda não escolheu um personagem, a sessão local já ativa é
 * enviada uma única vez (uma tentativa por sessão: se falhar, ele escolhe
 * manualmente no seletor). Usado pela sala em dock (`MesaRoom`) e pela tela
 * dedicada do Player (`/mesa/[id]`) — antes este efeito vivia duplicado dentro
 * de `MesaRoom`.
 *
 * Falha silenciosa de propósito: sem ficha local ou sem rede o jogador resolve
 * pelo seletor; nada aqui deve quebrar a tela.
 */

import { useEffect, useRef } from "react";

import { linkCharacter } from "@/lib/mesa/client";
import type { MesaState } from "@/lib/mesa/types";
import { getActiveCharacter, loadCharacters } from "@/lib/storage";

export function useAutoLinkCharacter(state: MesaState | null, refresh: () => Promise<void>): void {
  const attemptedLinkRef = useRef<string | null>(null);

  useEffect(() => {
    if (!state) return;
    const me = state.participants.find((entry) => entry.id === state.viewer.participantId);
    if (!me) return;
    // Durante um combate já iniciado, a Mesa é autoritativa e a ficha local
    // não pode sobrescrever HP, munição ou lesões.
    if (state.combat?.status === "finished") return;
    if (state.combat?.status === "active" && state.combat.initiativeStarted) return;
    const character = me.characterId
      ? loadCharacters().find((entry) => entry.id === me.characterId) ?? null
      : getActiveCharacter();
    if (!character) return;
    const attemptKey = `${state.session.id}:${character.id}`;
    if (attemptedLinkRef.current === attemptKey) return;
    attemptedLinkRef.current = attemptKey;
    void linkCharacter(state.session.id, character.id, character)
      .then(() => refresh())
      .catch(() => {
        // Sem ficha local ou falha de rede: o jogador escolhe manualmente.
      });
  }, [state, refresh]);
}
