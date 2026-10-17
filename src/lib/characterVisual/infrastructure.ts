/**
 * Contratos de persistência da identidade visual dos personagens (SOMENTE
 * servidor).
 *
 * A identidade visual é um anexo da ficha persistente — nunca uma segunda
 * ficha. As linhas referenciam o id persistente do personagem (o UUID
 * gerado no cliente por `createId()`, mesmo id de `mesa_characters.id` e de
 * `mesa_toolkit_records.id`), e os binários ficam FORA do banco:
 *
 * - modo `supabase`: bucket privado do Supabase Storage;
 * - modo `local`: arquivos sob `MESA_ASSETS_DIR` (Electron: `%ProgramData%\…`).
 *
 * A modalidade vem do mesmo mecanismo de configuração de sempre
 * (`MESA_HOSTING_MODE`); não existe fallback silencioso entre as duas.
 */

import type { CombatVisualState } from "@/lib/characterVisual/visualStates";

export type CharacterVisualStorageMode = "supabase" | "local";
export type CharacterVisualAssetKind = "portrait" | "combat_state";

export interface CharacterVisualProfileRecord {
  character_id: string;
  owner_token: string;
  display_name: string;
  created_at: string;
  updated_at: string;
  [column: string]: unknown;
}

export interface CharacterVisualAssetRecord {
  id: string;
  character_id: string;
  owner_token: string;
  kind: CharacterVisualAssetKind;
  /** Estado de combate; `null` quando `kind = 'portrait'`. */
  state: string | null;
  storage_mode: CharacterVisualStorageMode;
  /** Relativo ao root do storage (nunca caminho absoluto nem `..`). */
  storage_ref: string;
  mime_type: string;
  width: number;
  height: number;
  byte_size: number;
  created_at: string;
  updated_at: string;
  [column: string]: unknown;
}

export interface CharacterVisualProfileWrite {
  characterId: string;
  ownerToken: string;
  displayName: string;
}

export interface CharacterVisualAssetWrite {
  id: string;
  characterId: string;
  ownerToken: string;
  kind: CharacterVisualAssetKind;
  /** `CombatVisualState` validado pelo domínio; `null` para retrato. */
  state: CombatVisualState | null;
  storageMode: CharacterVisualStorageMode;
  storageRef: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
}

/**
 * Repositório das tabelas `mesa_character_visual_profiles` e
 * `mesa_character_visual_assets`. O "no máximo um asset por slot" é garantido
 * pelo índice único `(character_id, kind, coalesce(state, ''))`; o adapter só
 * cumpre o upert do slot já autorizado pelo domínio.
 */
export interface CharacterVisualRepository {
  findProfile(characterId: string): Promise<CharacterVisualProfileRecord | null>;
  upsertProfile(input: CharacterVisualProfileWrite): Promise<CharacterVisualProfileRecord>;
  listAssets(characterId: string): Promise<CharacterVisualAssetRecord[]>;
  findAsset(assetId: string): Promise<CharacterVisualAssetRecord | null>;
  upsertAsset(input: CharacterVisualAssetWrite): Promise<CharacterVisualAssetRecord>;
  /** Remove o asset dentro do escopo do personagem; devolve `false` se não existia. */
  deleteAsset(assetId: string, characterId: string): Promise<boolean>;
}

/**
 * Storage de objetos/binários. Os refs são controlados pelo servidor
 * (nunca vêm do cliente) e o contrato não permite escrita fora do root.
 */
export interface CharacterAssetStorage {
  readonly mode: CharacterVisualStorageMode;
  put(ref: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  get(ref: string): Promise<Uint8Array | null>;
  delete(ref: string): Promise<void>;
}

/** Extensão de arquivo aceita pelo storage (vem de `IMAGE_EXTENSIONS`). */
export type AssetFileExtension = "png" | "jpg" | "webp";

const SAFE_CHARACTER_ID = /^[A-Za-z0-9-]{1,64}$/;
const SAFE_ASSET_ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * Monta o ref de arquivo `${characterId}/${assetId}.${ext}`. Os dois
 * segmentos são validados aqui: nenhum outro formato é aceito pelo storage.
 */
export function makeCharacterAssetRef(
  characterId: string,
  assetId: string,
  extension: AssetFileExtension,
): string {
  if (!SAFE_CHARACTER_ID.test(characterId)) throw new Error(`characterId inválido para asset: ${characterId}`);
  if (!SAFE_ASSET_ID.test(assetId)) throw new Error(`assetId inválido para asset: ${assetId}`);
  return `${characterId}/${assetId}.${extension}`;
}

const ASSET_FILE_NAME = /^[A-Za-z0-9-]{1,64}\.(png|jpg|webp)$/;

export function isSafeCharacterAssetRef(ref: unknown): ref is string {
  if (typeof ref !== "string") return false;
  const parts = ref.split("/");
  if (parts.length !== 2) return false;
  return SAFE_CHARACTER_ID.test(parts[0]) && ASSET_FILE_NAME.test(parts[1]);
}
