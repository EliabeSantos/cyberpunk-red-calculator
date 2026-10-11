"use client";

/**
 * F1.12.3 — seletor de "qual ficha local eu jogo nesta Mesa".
 *
 * Extraído de `MesaRoom` para ser usado TAMBÉM pela tela dedicada do Player
 * (`/mesa/[id]`): antes, quem abria a rota direta não tinha nenhum jeito de
 * vincular um personagem se o vínculo automático não encontrasse ficha.
 *
 * A cópia vai para o servidor; a ficha original continua no navegador.
 * Nada aqui é estado autoritativo — o vínculo é só uma REFERÊNCIA
 * (`mesa_participants.character_id`).
 */

import { useState } from "react";

import { linkCharacter, MesaApiError } from "@/lib/mesa/client";
import { loadCharacters } from "@/lib/storage";

function listLocalCharacters(): Array<{ id: string; name: string }> {
  return loadCharacters().map((character) => ({
    id: character.id,
    name: character.identity.name || "Sem nome",
  }));
}

interface Props {
  sessionId: string;
  /** `characterId` já vinculado ao participante, conforme o estado da Mesa. */
  selectedCharacterId: string | null;
  disabled?: boolean;
  onNotice: (message: string, kind: "error" | "ok") => void;
  onChanged: () => Promise<void>;
}

export default function MesaCharacterLink({
  sessionId,
  selectedCharacterId,
  disabled,
  onNotice,
  onChanged,
}: Props) {
  // Inicialização preguiçosa: este bloco só monta com o estado da Mesa já
  // carregado (cliente), então não existe divergência de hidratação.
  const [characters] = useState(listLocalCharacters);
  const [linking, setLinking] = useState(false);

  async function handleLink(characterId: string, force = false) {
    if ((!force && characterId === selectedCharacterId) || (!characterId && !selectedCharacterId)) return;
    setLinking(true);
    try {
      if (!characterId) {
        await linkCharacter(sessionId, null);
        await onChanged();
        onNotice("Ficha desvinculada.", "ok");
        return;
      }
      const character = loadCharacters().find((entry) => entry.id === characterId);
      if (!character) throw new MesaApiError("Personagem não encontrado no navegador.", 400, "not_found");
      await linkCharacter(sessionId, character.id, character);
      await onChanged();
      onNotice(`Ficha "${character.identity.name}" vinculada.`, "ok");
    } catch (caught) {
      onNotice(
        caught instanceof MesaApiError ? caught.message : "Falha ao vincular a ficha.",
        "error",
      );
    } finally {
      setLinking(false);
    }
  }

  return (
    <div className="mesa-link-character">
      <label>
        Meu personagem nesta mesa
      <select
          value={selectedCharacterId ?? ""}
          disabled={linking || disabled}
          onChange={(event) => void handleLink(event.target.value)}
        >
          <option value="">— nenhum —</option>
          {characters.map((character) => (
            <option key={character.id} value={character.id}>
              {character.name}
            </option>
          ))}
        </select>
      </label>
      {selectedCharacterId && (
        <button
          type="button"
          className="mesa-secondary mesa-refresh-character-link"
          disabled={linking || disabled}
          onClick={() => void handleLink(selectedCharacterId, true)}
        >
          {linking ? "Atualizando ficha…" : "Atualizar ficha na Mesa"}
        </button>
      )}
      <small>
        A ficha continua no seu navegador. Atualize a cópia da Mesa depois de equipar itens importantes.
      </small>
    </div>
  );
}
