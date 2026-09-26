"use client";

import { useEffect, useState } from "react";

import CharacterCreator from "@/components/character/CharacterCreator";
import CharacterSheet from "@/components/sheets/CharacterSheet";
import DiscordConsentPrompt from "@/components/discord/DiscordConsentPrompt";
import MesaRoomDock from "@/components/mesa/MesaRoomDock";
import { getDiscordConsent, setDiscordConsent, type DiscordConsent } from "@/lib/discord/consent";
import { findNewRollEntry, notifyDiscordRoll } from "@/lib/discord/rollNotify";
import { getActiveCharacter, upsertCharacter } from "@/lib/storage";
import { maybePushSheet } from "@/lib/mesa/client";
import { publishMesaRoll } from "@/lib/mesa/rollPublish";
import type { Character } from "@/types/character";

type Screen = "sheet" | "creator";

interface Props {
  /**
   * Código de convite vindo de /mesa/CODE. É a MESMA tela da ficha — só abre o
   * painel da mesa por cima, para o jogador não ser tirado da sessão principal.
   */
  initialJoinCode?: string;
}

export default function CharacterToolkit({ initialJoinCode }: Props) {
  const [character, setCharacter] = useState<Character | null>(null);
  const [screen, setScreen] = useState<Screen>("creator");
  const [ready, setReady] = useState(false);
  const [discordConsent, setDiscordConsentState] = useState<DiscordConsent | null>(null);

  useEffect(() => {
    const savedCharacter = getActiveCharacter();
    setCharacter(savedCharacter);
    setScreen(savedCharacter ? "sheet" : "creator");
    setDiscordConsentState(getDiscordConsent());
    setReady(true);
  }, []);

  function handleDiscordConsent(consent: DiscordConsent) {
    setDiscordConsent(consent);
    setDiscordConsentState(consent);
  }

  // O painel da mesa renderiza mesmo durante o carregamento: quem chega pelo
  // link de convite não precisa esperar a ficha para ver a sala.
  if (!ready) {
    return (
      <>
        <main className="loading-screen">Carregando ficha...</main>
        <MesaRoomDock initialJoinCode={initialJoinCode} />
      </>
    );
  }

  const content =
    screen === "creator" ? (
      <CharacterCreator initialCharacter={character ?? undefined} onSaved={(saved) => { setCharacter(saved); setScreen("sheet"); }} />
    ) : character ? (
      <CharacterSheet
        character={character}
        discordConsent={discordConsent}
        onDiscordConsentChange={handleDiscordConsent}
        onUpdate={(updated) => {
          // Espelho das rolagens: envia a entrada nova ao backend sem tocar na lógica de rolagem.
          // notifyDiscordRoll só envia com consentimento explícito ("granted").
          const newRoll = findNewRollEntry(character, updated);
          if (newRoll) notifyDiscordRoll(newRoll, updated);
          // Espelho para a MESA: se este navegador está numa mesa, o dado que o
          // jogador acabou de rolar vira a ação dela e aparece no registro
          // compartilhado. Sem mesa ativa não faz absolutamente nada.
          publishMesaRoll(newRoll);
          upsertCharacter(updated);
          setCharacter(updated);
          // Modo online: mantém a cópia da ficha na servidor em dia.
          // Fire-and-forget — sem mesa ativa (modo local) não faz absolutamente nada.
          void maybePushSheet(updated);
        }}
        onEdit={() => setScreen("creator")}
        onNewCharacter={() => { setCharacter(null); setScreen("creator"); }}
      />
    ) : null;

  return (
    <>
      {discordConsent === null && <DiscordConsentPrompt onDecide={handleDiscordConsent} />}
      {content}
      <MesaRoomDock initialJoinCode={initialJoinCode} />
    </>
  );
}
