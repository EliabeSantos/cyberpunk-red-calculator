"use client";

import { useEffect, useState } from "react";

import CharacterCreator from "@/components/character/CharacterCreator";
import CharacterSheet from "@/components/sheets/CharacterSheet";
import { getActiveCharacter, upsertCharacter } from "@/lib/storage";
import type { Character } from "@/types/character";

type Screen = "sheet" | "creator";

export default function CharacterToolkit() {
  const [character, setCharacter] = useState<Character | null>(null);
  const [screen, setScreen] = useState<Screen>("creator");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const savedCharacter = getActiveCharacter();
    setCharacter(savedCharacter);
    setScreen(savedCharacter ? "sheet" : "creator");
    setReady(true);
  }, []);

  if (!ready) return <main className="loading-screen">Carregando ficha...</main>;

  if (screen === "creator") {
    return <CharacterCreator initialCharacter={character ?? undefined} onSaved={(saved) => { setCharacter(saved); setScreen("sheet"); }} />;
  }

  return character ? <CharacterSheet character={character} onUpdate={(updated) => { upsertCharacter(updated); setCharacter(updated); }} onEdit={() => setScreen("creator")} onNewCharacter={() => { setCharacter(null); setScreen("creator"); }} /> : null;
}