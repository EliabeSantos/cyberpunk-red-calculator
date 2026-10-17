/**
 * Adapter SUPABASE das tabelas de identidade visual.
 *
 * Usa apenas o cliente service-role (`getSupabaseAdmin()`), igual aos demais
 * adapters de Mesa. Nenhum acesso direto do navegador ao banco ou ao storage:
 * todo binário entra e sai pelas rotas `/api/character-visual`, que autorizam
 * pelo token do participante.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { DatabaseQueryError, getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type {
  CharacterVisualAssetKind,
  CharacterVisualAssetRecord,
  CharacterVisualAssetWrite,
  CharacterVisualProfileRecord,
  CharacterVisualProfileWrite,
  CharacterVisualRepository,
} from "@/lib/characterVisual/infrastructure";

type SupabaseError = { message: string } | null;

async function result<T>(
  request: PromiseLike<{ data: T | null; error: SupabaseError }>,
  context: string,
): Promise<T | null> {
  const response = await request;
  if (response.error) throw new DatabaseQueryError(`${context}: ${response.error.message}`);
  return response.data;
}

export class SupabaseCharacterVisualRepository implements CharacterVisualRepository {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient = getSupabaseAdmin()) {
    this.client = client;
  }

  findProfile(characterId: string): Promise<CharacterVisualProfileRecord | null> {
    return result(
      this.client.from("mesa_character_visual_profiles").select("*").eq("character_id", characterId).maybeSingle(),
      "Falha ao consultar a identidade visual",
    ) as Promise<CharacterVisualProfileRecord | null>;
  }

  async upsertProfile(input: CharacterVisualProfileWrite): Promise<CharacterVisualProfileRecord> {
    // Update-then-insert (mesmo padrão do toolkit): o PostgREST não aceita
    // índice parcial/com expressão como conflict target.
    const updated = await result(
      this.client
        .from("mesa_character_visual_profiles")
        .update({ display_name: input.displayName, updated_at: new Date().toISOString() })
        .eq("character_id", input.characterId)
        .eq("owner_token", input.ownerToken)
        .select("*")
        .maybeSingle(),
      "Falha ao salvar a identidade visual",
    );
    if (updated) return updated as CharacterVisualProfileRecord;
    const inserted = await result(
      this.client
        .from("mesa_character_visual_profiles")
        .insert({
          character_id: input.characterId,
          owner_token: input.ownerToken,
          display_name: input.displayName,
        })
        .select("*")
        .single(),
      "Falha ao salvar a identidade visual",
    );
    if (!inserted) {
      throw new DatabaseQueryError("Falha ao salvar a identidade visual: personagem pertence a outro jogador");
    }
    return inserted as CharacterVisualProfileRecord;
  }

  async listAssets(characterId: string): Promise<CharacterVisualAssetRecord[]> {
    return ((await result(
      this.client
        .from("mesa_character_visual_assets")
        .select("*")
        .eq("character_id", characterId)
        .order("kind")
        .order("state", { ascending: true, nullsFirst: false }),
      "Falha ao listar as imagens do personagem",
    )) ?? []) as CharacterVisualAssetRecord[];
  }

  findAsset(assetId: string): Promise<CharacterVisualAssetRecord | null> {
    return result(
      this.client.from("mesa_character_visual_assets").select("*").eq("id", assetId).maybeSingle(),
      "Falha ao consultar a imagem",
    ) as Promise<CharacterVisualAssetRecord | null>;
  }

  private async findSlotAsset(
    characterId: string,
    kind: CharacterVisualAssetKind,
    state: string | null,
  ): Promise<CharacterVisualAssetRecord | null> {
    let request = this.client
      .from("mesa_character_visual_assets")
      .select("*")
      .eq("character_id", characterId)
      .eq("kind", kind);
    request = state === null ? request.is("state", null) : request.eq("state", state);
    return result(request.maybeSingle(), "Falha ao consultar a imagem") as Promise<CharacterVisualAssetRecord | null>;
  }

  async upsertAsset(input: CharacterVisualAssetWrite): Promise<CharacterVisualAssetRecord> {
    const patch = {
      owner_token: input.ownerToken,
      storage_mode: input.storageMode,
      storage_ref: input.storageRef,
      mime_type: input.mimeType,
      width: input.width,
      height: input.height,
      byte_size: input.byteSize,
      updated_at: new Date().toISOString(),
    };
    const existing = await this.findSlotAsset(input.characterId, input.kind, input.state);
    if (existing) {
      if (existing.owner_token !== input.ownerToken) {
        throw new DatabaseQueryError("Falha ao salvar a imagem do personagem: slot ocupado por outro jogador");
      }
      const updated = await result(
        this.client.from("mesa_character_visual_assets").update(patch).eq("id", existing.id).select("*").maybeSingle(),
        "Falha ao salvar a imagem do personagem",
      );
      if (!updated) throw new DatabaseQueryError("Falha ao salvar a imagem do personagem: linha ausente após atualização");
      return updated as CharacterVisualAssetRecord;
    }
    const inserted = await result(
      this.client
        .from("mesa_character_visual_assets")
        .insert({
          id: input.id,
          character_id: input.characterId,
          kind: input.kind,
          state: input.state,
          ...patch,
          created_at: new Date().toISOString(),
        })
        .select("*")
        .single(),
      "Falha ao salvar a imagem do personagem",
    );
    if (!inserted) throw new DatabaseQueryError("Falha ao salvar a imagem do personagem: nenhuma linha retornada");
    return inserted as CharacterVisualAssetRecord;
  }

  async deleteAsset(assetId: string, characterId: string): Promise<boolean> {
    const rows = (await result(
      this.client
        .from("mesa_character_visual_assets")
        .delete()
        .eq("id", assetId)
        .eq("character_id", characterId)
        .select("id"),
      "Falha ao remover a imagem do personagem",
    )) ?? [];
    return rows.length > 0;
  }
}
