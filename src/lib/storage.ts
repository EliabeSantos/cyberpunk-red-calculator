import "client-only";

import {
  calculateMaximumHitPoints,
  calculateMaximumHumanity,
  calculateMaximumHumanityFromCyberware,
} from "@/lib/calculations";
import type { Character, CriticalInjury } from "@/types/character";
import { bodyCriticalInjuries, headCriticalInjuries } from "@/data/criticalInjuries";

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

/** Normaliza fichas antigas e preserva dano/perda de Humanidade já registrados.
 * A Maximum Humanity NÃO é recalculada a partir do EMP, pois ela deve
 * refletir as penalidades do Cyberware instalado.
 */
function normalizeCharacter(character: Character): Character {
  const maximumHitPoints = calculateMaximumHitPoints(character.stats);
  // Maximum Humanity: usa o valor salvo se já existir (pós-criação com cyberware),
  // senão calcula a partir do EMP (fichas antigas/sem cyberware).
  const savedMaxHumanity = character.humanity?.max ?? 0;
  const calculatedMaxHumanity = calculateMaximumHumanity(character.stats);
  const maximumHumanity = savedMaxHumanity > 0 ? Math.min(savedMaxHumanity, calculatedMaxHumanity) : calculatedMaxHumanity;

  const oldHitPoints = character.combat?.hp;
  const oldHumanity = character.humanity;
  
  // Normaliza criticalInjuries: converte strings antigas para objetos CriticalInjury
  const normalizedCriticalInjuries: CriticalInjury[] = (character.combat?.criticalInjuries || []).map((injury: unknown) => {
    if (typeof injury === "string") {
      // String antiga: tenta encontrar na tabela oficial pelo nome
      const allInjuries = [...bodyCriticalInjuries, ...headCriticalInjuries];
      const match = allInjuries.find((ci) => injury.includes(ci.name));
      if (match) return match;
      // Fallback: cria objeto mínimo
      return {
        roll: 0,
        name: injury,
        effect: "",
        quickFix: "",
        treatment: "",
        bonusDamage: 5,
        location: "body" as const,
        modifiers: [],
      };
    }
    return injury as CriticalInjury;
  });

  return {
    ...character,
    // Fichas antigas podem conter `base`; Base agora é sempre calculada sob demanda.
    skills: Object.fromEntries(
      Object.entries(character.skills).map(([id, skill]) => {
        const { base: _legacyBase, ...currentSkill } = skill as typeof skill & { base?: number };
        return [id, currentSkill];
      }),
    ),
    wallet: character.wallet ?? { eurodollars: 0 },
    primaryRole: character.primaryRole ?? null,
    roleAbilities: character.roleAbilities ?? [],
    ip: character.ip ?? character.progression?.improvementPoints ?? 0,
    teamMembers: character.teamMembers ?? [],
    familyVehicles: character.familyVehicles ?? [],
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
      criticalInjuries: normalizedCriticalInjuries,
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