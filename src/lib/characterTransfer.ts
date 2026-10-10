import { normalizeCharacter } from "@/lib/storage";
import type { Character } from "@/types/character";

export const CHARACTER_TRANSFER_KIND = "cyberpunk-red-character" as const;
export const CHARACTER_TRANSFER_VERSION = 1 as const;

export interface CharacterTransferFile {
  kind: typeof CHARACTER_TRANSFER_KIND;
  version: typeof CHARACTER_TRANSFER_VERSION;
  exportedAt: string;
  character: Character;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidFile(message: string): never {
  throw new Error(`Arquivo de ficha inválido: ${message}`);
}

export function parseCharacterTransferFile(raw: unknown): Character {
  if (!isRecord(raw) || raw.kind !== CHARACTER_TRANSFER_KIND || raw.version !== CHARACTER_TRANSFER_VERSION) {
    invalidFile("formato ou versão não suportados.");
  }
  if (!isRecord(raw.character)) invalidFile("a ficha não foi encontrada.");

  const value = raw.character;
  if (value.schemaVersion !== 2 || typeof value.id !== "string" || !value.id.trim()) {
    invalidFile("a versão da ficha não é suportada.");
  }
  if (!isRecord(value.identity) || typeof value.identity.name !== "string") {
    invalidFile("identidade ausente.");
  }
  if (!isRecord(value.stats) || !isRecord(value.skills) || !isRecord(value.combat)) {
    invalidFile("dados básicos ausentes.");
  }
  if (!Array.isArray(value.weapons) || !Array.isArray(value.cyberware) || !Array.isArray(value.inventory)) {
    invalidFile("equipamentos da ficha inválidos.");
  }

  try {
    return normalizeCharacter(value as unknown as Character);
  } catch {
    invalidFile("não foi possível ler os dados da ficha.");
  }
}

export function characterTransferPayload(character: Character): CharacterTransferFile {
  return { kind: CHARACTER_TRANSFER_KIND, version: CHARACTER_TRANSFER_VERSION, exportedAt: new Date().toISOString(), character };
}

export function downloadCharacterFile(character: Character): void {
  const name = character.identity.name.trim().replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "personagem";
  const blob = new Blob([JSON.stringify(characterTransferPayload(character), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${name}.cyberpunk-red-character.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
