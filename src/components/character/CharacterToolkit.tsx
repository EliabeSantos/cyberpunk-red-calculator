"use client";

import { useEffect, useState } from "react";

import CharacterCreator from "@/components/character/CharacterCreator";
import CharacterSheet from "@/components/sheets/CharacterSheet";
import DiscordConsentPrompt from "@/components/discord/DiscordConsentPrompt";
import { getDiscordConsent, setDiscordConsent, type DiscordConsent } from "@/lib/discord/consent";
import { findNewRollEntry, notifyDiscordRoll } from "@/lib/discord/rollNotify";
import { getActiveCharacter, upsertCharacter } from "@/lib/storage";
import type { Character } from "@/types/character";

type Screen = "sheet" | "creator";

export default function CharacterToolkit() {
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

  if (!ready) return <main className="loading-screen">Carregando ficha...</main>;

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
          upsertCharacter(updated);
          setCharacter(updated);
        }}
        onEdit={() => setScreen("creator")}
        onNewCharacter={() => { setCharacter(null); setScreen("creator"); }}
      />
    ) : null;

  return (
    <>
      {discordConsent === null && <DiscordConsentPrompt onDecide={handleDiscordConsent} />}
      {content}
    </>
  );
}
