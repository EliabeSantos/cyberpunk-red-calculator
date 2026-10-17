/**
 * Servidor da identidade visual dos personagens (SOMENTE servidor).
 *
 * Camada de domínio entre as rotas `/api/character-visual` e os adapters
 * (PostgreSQL local / Supabase + storage de arquivos/bucket). Aqui vivem:
 *
 * - autorização de escrita: o `player_token` do chamador precisa ser o dono
 *   da identidade visual do personagem (mesma regra de posse de
 *   `linkCharacter` em `store.ts`); o primeiro acesso cria o perfil com o
 *   token de quem escreve, e trocar o id da requisição não muda o dono;
 * - autorização de leitura: o próprio dono, ou — via `sessionGate` — um
 *   participante autenticado de uma Mesa onde o personagem está vinculado
 *   (é o caminho que o futuro renderizador de combate usará);
 * - validação real dos uploads (magic bytes + dimensões), preservando o
 *   canal alfa de PNG/WebP: os bytes são armazenados exatamente como
 *   chegaram, sem conversão para JPEG;
 * - orquestração asset+binário com limpeza best-effort em falha parcial.
 *
 * Este módulo NÃO implementa regras de combate nem altera a ficha mecânica:
 * remover uma imagem opcional só afeta as tabelas de identidade visual.
 */

import { MesaError, authenticate } from "@/lib/mesa/store";
import { createId } from "@/lib/id";
import type { MesaRepository } from "@/lib/mesa/infrastructure";
import { signAssetUrl, verifyAssetUrlSignature } from "@/lib/characterVisual/assetUrlSigning";
import {
  CharacterVisualImageError,
  configuredMaxImageBytes,
  decodeImageDataUrl,
  validateImageBytes,
  IMAGE_EXTENSIONS,
  type ValidatedImage,
} from "@/lib/characterVisual/imageValidation";
import {
  makeCharacterAssetRef,
  type CharacterAssetStorage,
  type CharacterVisualAssetRecord,
  type CharacterVisualRepository,
  type CharacterVisualStorageMode,
} from "@/lib/characterVisual/infrastructure";
import {
  emptyCharacterVisualProfile,
  resolveCharacterVisualIdentity,
  type CharacterVisualAssetRef,
  type CharacterVisualIdentity,
  type CharacterVisualProfileData,
} from "@/lib/characterVisual/visualIdentity";
import { isCombatVisualState, type CombatVisualState } from "@/lib/characterVisual/visualStates";

export const DISPLAY_NAME_MAX_LENGTH = 80;

/** Onde entra a autorização de leitura por participação na Mesa. */
export type CharacterVisualSessionGate = (
  characterId: string,
  sessionId: string,
  token: string,
) => Promise<void>;

export interface CharacterVisualServiceDeps {
  repository: CharacterVisualRepository;
  storage: CharacterAssetStorage;
  /** Autorização de leitura para o futuro renderizador; injetável em testes. */
  sessionGate?: CharacterVisualSessionGate;
  now?: () => number;
  /** Espelha `MESA_VISUAL_MAX_IMAGE_BYTES` quando não informado. */
  maxImageBytes?: number;
}

export type VisualSlot = { kind: "portrait" } | { kind: "combat_state"; state: CombatVisualState };

export interface CharacterVisualImageWrite {
  characterId: unknown;
  token: unknown;
  slot: VisualSlot;
  imageDataUrl: unknown;
}

function requireOwnerToken(token: unknown): string {
  if (typeof token !== "string" || token.length < 16 || token.length > 512) {
    throw new MesaError("Credencial ausente.", 401, "missing_token");
  }
  return token;
}

function requireCharacterId(characterId: unknown): string {
  if (typeof characterId !== "string" || characterId.trim().length === 0 || characterId.length > 200) {
    throw new MesaError("Personagem inválido.", 400, "invalid_character_id");
  }
  return characterId;
}

function parseSlot(slot: VisualSlot): VisualSlot {
  if (slot && slot.kind === "portrait") return { kind: "portrait" };
  if (slot && slot.kind === "combat_state" && isCombatVisualState(slot.state)) {
    return { kind: "combat_state", state: slot.state };
  }
  throw new MesaError("Estado visual inválido.", 400, "invalid_visual_state");
}

function normalizeDisplayName(displayName: unknown): string {
  if (typeof displayName !== "string") {
    throw new MesaError("Nome de exibição inválido.", 400, "invalid_display_name");
  }
  // Caracteres de controle (incluindo quebras de linha) viram espaço simples.
  const withoutControls = Array.from(displayName, (char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127 ? " " : char;
  }).join("");
  const normalized = withoutControls.trim();
  if (normalized.length > DISPLAY_NAME_MAX_LENGTH) {
    throw new MesaError(
      `O nome de exibição pode ter no máximo ${DISPLAY_NAME_MAX_LENGTH} caracteres.`,
      400,
      "invalid_display_name",
    );
  }
  return normalized;
}

function toImageError(error: CharacterVisualImageError): MesaError {
  if (error.code === "image_too_large") {
    return new MesaError(error.message, 413, "visual_image_too_large");
  }
  return new MesaError(error.message, 400, "invalid_visual_image");
}

export class CharacterVisualService {
  private readonly repository: CharacterVisualRepository;
  private readonly storage: CharacterAssetStorage;
  private readonly sessionGate: CharacterVisualSessionGate | undefined;
  private readonly now: () => number;
  private readonly maxImageBytes: number;

  constructor(deps: CharacterVisualServiceDeps) {
    this.repository = deps.repository;
    this.storage = deps.storage;
    this.sessionGate = deps.sessionGate;
    this.now = deps.now ?? (() => Date.now());
    this.maxImageBytes = deps.maxImageBytes ?? configuredMaxImageBytes();
  }

  /** Escrita/leitura do próprio dono: o token precisa bater com o perfil. */
  private async requireOwnership(characterId: string, token: unknown): Promise<string> {
    const owner = requireOwnerToken(token);
    const profile = await this.repository.findProfile(characterId);
    if (profile && profile.owner_token !== owner) {
      throw new MesaError("Esta personalização pertence a outro jogador.", 403, "character_owner_mismatch");
    }
    return owner;
  }

  /** Leitura controlada: dono OU participante de Mesa com o personagem vinculado. */
  private async authorizeRead(characterId: string, token: unknown, sessionId?: unknown): Promise<void> {
    const owner = requireOwnerToken(token);
    const profile = await this.repository.findProfile(characterId);
    if (!profile || profile.owner_token === owner) return;
    if (typeof sessionId === "string" && sessionId.length > 0) {
      if (!this.sessionGate) {
        throw new MesaError("Leitura de outro jogador indisponível nesta configuração.", 403, "visual_read_denied");
      }
      await this.sessionGate(characterId, sessionId, owner);
      return;
    }
    throw new MesaError("Esta personalização pertence a outro jogador.", 403, "character_owner_mismatch");
  }

  private assetRefOf(record: CharacterVisualAssetRecord): CharacterVisualAssetRef {
    return {
      assetId: record.id,
      kind: record.kind,
      state: isCombatVisualState(record.state) ? record.state : null,
      mimeType: record.mime_type,
      width: record.width,
      height: record.height,
      byteSize: record.byte_size,
      url: signAssetUrl(record.id, record.owner_token, this.now()),
      updatedAt: record.updated_at,
    };
  }

  private async buildProfileData(characterId: string): Promise<CharacterVisualProfileData> {
    const [profile, assets] = await Promise.all([
      this.repository.findProfile(characterId),
      this.repository.listAssets(characterId),
    ]);
    if (!profile && assets.length === 0) return emptyCharacterVisualProfile(characterId);
    const data: CharacterVisualProfileData = {
      characterId,
      displayName: profile?.display_name ?? null,
      updatedAt: profile?.updated_at ?? null,
      portrait: null,
      stateImages: {},
    };
    for (const asset of assets) {
      const ref = this.assetRefOf(asset);
      if (asset.kind === "portrait") {
        data.portrait = ref;
        continue;
      }
      if (ref.state) data.stateImages[ref.state] = ref;
    }
    return data;
  }

  async loadIdentity(
    characterId: unknown,
    token: unknown,
    sessionId?: unknown,
    fallbackDisplayName?: unknown,
  ): Promise<CharacterVisualIdentity> {
    const id = requireCharacterId(characterId);
    await this.authorizeRead(id, token, sessionId);
    const fallback = typeof fallbackDisplayName === "string"
      ? fallbackDisplayName.slice(0, DISPLAY_NAME_MAX_LENGTH)
      : "";
    return resolveCharacterVisualIdentity(await this.buildProfileData(id), fallback);
  }

  async saveDisplayName(input: { characterId: unknown; token: unknown; displayName: unknown }): Promise<CharacterVisualIdentity> {
    const characterId = requireCharacterId(input.characterId);
    const owner = await this.requireOwnership(characterId, input.token);
    const displayName = normalizeDisplayName(input.displayName);
    await this.repository.upsertProfile({ characterId, ownerToken: owner, displayName });
    return this.loadIdentity(characterId, owner);
  }

  async saveImage(input: CharacterVisualImageWrite): Promise<CharacterVisualIdentity> {
    const characterId = requireCharacterId(input.characterId);
    const owner = await this.requireOwnership(characterId, input.token);
    const slot = parseSlot(input.slot);

    let decoded: { bytes: Uint8Array; declaredMimeType: string | null };
    try {
      decoded = decodeImageDataUrl(input.imageDataUrl);
    } catch (error) {
      throw error instanceof CharacterVisualImageError ? toImageError(error) : error;
    }
    let validated: ValidatedImage;
    try {
      validated = validateImageBytes(decoded.bytes, {
        maxBytes: this.maxImageBytes,
        declaredMimeType: decoded.declaredMimeType ?? undefined,
      });
    } catch (error) {
      throw error instanceof CharacterVisualImageError ? toImageError(error) : error;
    }

    // O perfil nasce na primeira escrita e já fica com o dono correto.
    const profile = await this.repository.findProfile(characterId);
    await this.repository.upsertProfile({ characterId, ownerToken: owner, displayName: profile?.display_name ?? "" });

    const kind = slot.kind;
    const state = slot.kind === "combat_state" ? slot.state : null;
    const assets = await this.repository.listAssets(characterId);
    const existing = assets.find((asset) => asset.kind === kind && (asset.state ?? null) === state) ?? null;

    const assetId = existing?.id ?? createId();
    const wantedRef = makeCharacterAssetRef(characterId, assetId, IMAGE_EXTENSIONS[validated.format]);
    const previousRef = existing?.storage_ref ?? null;

    await this.storage.put(wantedRef, decoded.bytes, validated.mimeType);
    try {
      await this.repository.upsertAsset({
        id: assetId,
        characterId,
        ownerToken: owner,
        kind,
        state,
        storageMode: this.storage.mode as CharacterVisualStorageMode,
        storageRef: wantedRef,
        mimeType: validated.mimeType,
        width: validated.width,
        height: validated.height,
        byteSize: validated.byteLength,
      });
    } catch (error) {
      // Nada de lixo: se a linha não vingou, o binário recém-escrito é removido.
      await this.storage.delete(wantedRef).catch(() => undefined);
      throw error;
    }
    if (previousRef && previousRef !== wantedRef) {
      await this.storage.delete(previousRef).catch(() => undefined);
    }
    return this.loadIdentity(characterId, owner);
  }

  /** Remove apenas a imagem do slot; a ficha mecânica nunca é tocada. */
  async removeImage(input: { characterId: unknown; token: unknown; slot: VisualSlot }): Promise<CharacterVisualIdentity> {
    const characterId = requireCharacterId(input.characterId);
    const owner = await this.requireOwnership(characterId, input.token);
    const slot = parseSlot(input.slot);
    const kind = slot.kind;
    const state = slot.kind === "combat_state" ? slot.state : null;

    const assets = await this.repository.listAssets(characterId);
    const existing = assets.find((asset) => asset.kind === kind && (asset.state ?? null) === state) ?? null;
    if (!existing) return this.loadIdentity(characterId, owner);

    const removed = await this.repository.deleteAsset(existing.id, characterId);
    if (removed) await this.storage.delete(existing.storage_ref).catch(() => undefined);
    return this.loadIdentity(characterId, owner);
  }

  /** Serve o binário de um asset após validar a assinatura da URL. */
  async readAsset(
    assetId: unknown,
    expiresRaw: unknown,
    signatureRaw: unknown,
  ): Promise<{ bytes: Uint8Array; mimeType: string }> {
    if (typeof assetId !== "string" || assetId.length === 0) {
      throw new MesaError("Imagem não encontrada.", 404, "asset_not_found");
    }
    const asset = await this.repository.findAsset(assetId);
    if (!asset) throw new MesaError("Imagem não encontrada.", 404, "asset_not_found");
    const valid = verifyAssetUrlSignature(
      asset.id,
      asset.owner_token,
      typeof expiresRaw === "string" ? expiresRaw : null,
      typeof signatureRaw === "string" ? signatureRaw : null,
      this.now(),
    );
    if (!valid) throw new MesaError("Assinatura da imagem inválida ou expirada.", 403, "invalid_asset_signature");
    const bytes = await this.storage.get(asset.storage_ref);
    if (!bytes) throw new MesaError("Imagem não encontrada.", 404, "asset_file_missing");
    return { bytes, mimeType: asset.mime_type };
  }
}

/**
 * Gate padrão de leitura por Mesa: o chamador precisa ser participante
 * autenticado da sessão e o personagem precisa estar vinculado nela (link do
 * participante ou combatente inimigo cadastrado pelo mestre).
 */
export function createMesaSessionReadGate(
  resolveInfrastructure: () => Promise<{ repository: MesaRepository }>,
): CharacterVisualSessionGate {
  return async (characterId: string, sessionId: string, token: string): Promise<void> => {
    const actor = await authenticate(sessionId, token);
    // O próprio vínculo do participante já autoriza a leitura.
    if (actor.participant.characterId === characterId) return;
    const { repository } = await resolveInfrastructure();
    const participants = await repository.listParticipantsBySession(sessionId);
    const linked = participants.some((participant) => participant.character_id === characterId);
    if (!linked) {
      throw new MesaError("Este personagem não participa da mesa informada.", 403, "visual_not_in_session");
    }
  };
}
