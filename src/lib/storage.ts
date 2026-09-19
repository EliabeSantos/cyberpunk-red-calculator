import "client-only";

import {
  calculateMaximumHitPoints,
  calculateMaximumHumanity,
} from "@/lib/calculations";
import type { Character } from "@/types/character";

const STORAGE_PREFIX = "cyberpunk-red-toolkit";
const CHARACTERS_KEY = `${STORAGE_PREFIX}:characters:v1`;
const ACTIVE_CHARACTER_KEY = `${STORAGE_PREFIX}:active-character:v1`;

function canUseStorage() {
  return typeof window !== "undefined";
}
function isCharacter(value: unknown): value is Character {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "schemaVersion" in value &&
    (value as Character).schemaVersion === 2
  );
}

/** Normaliza fichas antigas e preserva dano/perda de Humanidade já registrados. */
function normalizeCharacter(character: Character): Character {
  const maximumHitPoints = calculateMaximumHitPoints(character.stats);
  const maximumHumanity = calculateMaximumHumanity(character.stats);
  const oldHitPoints = character.combat?.hp;
  const oldHumanity = character.humanity;
  return {
    ...character,
    wallet: character.wallet ?? { eurodollars: 0 },
    progression: character.progression ?? { improvementPoints: 0 },
    rollHistory: character.rollHistory ?? [],
    humanity: {
      max: maximumHumanity,
      current:
        !oldHumanity || oldHumanity.max === 0
          ? maximumHumanity
          : Math.min(oldHumanity.current, maximumHumanity),
    },
    combat: {
      ...character.combat,
      hp: {
        max: maximumHitPoints,
        current:
          !oldHitPoints || oldHitPoints.max === 0
            ? maximumHitPoints
            : Math.min(oldHitPoints.current, maximumHitPoints),
      },
    },
  };
}

export function loadCharacters(): Character[] {
  if (!canUseStorage()) return [];
  try {
    const value = window.localStorage.getItem(CHARACTERS_KEY);
    const parsed: unknown = value ? JSON.parse(value) : [];
    return Array.isArray(parsed)
      ? parsed.filter(isCharacter).map(normalizeCharacter)
      : [];
  } catch {
    return [];
  }
}
export function saveCharacters(characters: Character[]) {
  if (canUseStorage())
    window.localStorage.setItem(CHARACTERS_KEY, JSON.stringify(characters));
}
export function upsertCharacter(character: Character): Character[] {
  const updated = { ...character, updatedAt: new Date().toISOString() };
  const characters = loadCharacters();
  const exists = characters.some(({ id }) => id === character.id);
  const next = exists
    ? characters.map((item) => (item.id === character.id ? updated : item))
    : [...characters, updated];
  saveCharacters(next);
  return next;
}
export function removeCharacter(characterId: string): Character[] {
  const next = loadCharacters().filter(({ id }) => id !== characterId);
  saveCharacters(next);
  if (getActiveCharacterId() === characterId && canUseStorage())
    window.localStorage.removeItem(ACTIVE_CHARACTER_KEY);
  return next;
}
export function getActiveCharacterId(): string | null {
  return canUseStorage()
    ? window.localStorage.getItem(ACTIVE_CHARACTER_KEY)
    : null;
}
export function setActiveCharacterId(characterId: string | null) {
  if (!canUseStorage()) return;
  if (characterId === null)
    window.localStorage.removeItem(ACTIVE_CHARACTER_KEY);
  else window.localStorage.setItem(ACTIVE_CHARACTER_KEY, characterId);
}
export function getActiveCharacter(): Character | null {
  const id = getActiveCharacterId();
  return loadCharacters().find((character) => character.id === id) ?? null;
}
