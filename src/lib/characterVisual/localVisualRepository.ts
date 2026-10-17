/**
 * Adapter PostgreSQL LOCAL das tabelas de identidade visual.
 *
 * Mesmo desenho dos demais adapters locais: SQL parametrizado direto sobre o
 * pool compartilhado do lifecycle (`getLocalPostgresLifecycle`), colunas no
 * mesmo formato snake_case que o PostgREST devolve no modo Supabase, zero
 * regra de negócio e zero fallback para Supabase.
 */
import type { Pool } from "pg";

import { DatabaseQueryError } from "@/lib/supabaseAdmin";
import type {
  CharacterVisualAssetRecord,
  CharacterVisualAssetWrite,
  CharacterVisualProfileRecord,
  CharacterVisualProfileWrite,
  CharacterVisualRepository,
} from "@/lib/characterVisual/infrastructure";

type Queryable = Pick<Pool, "query">;

export class LocalPostgresCharacterVisualRepository implements CharacterVisualRepository {
  private readonly pool: Queryable;

  constructor(pool: Queryable) {
    this.pool = pool;
  }

  private async rows<T>(sql: string, params: unknown[], context: string): Promise<T[]> {
    try {
      const result = await this.pool.query(sql, params);
      return result.rows as T[];
    } catch (error) {
      throw new DatabaseQueryError(`${context}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async findProfile(characterId: string): Promise<CharacterVisualProfileRecord | null> {
    const rows = await this.rows<CharacterVisualProfileRecord>(
      "select * from public.mesa_character_visual_profiles where character_id = $1 limit 1",
      [characterId],
      "Falha ao consultar a identidade visual",
    );
    return rows[0] ?? null;
  }

  async upsertProfile(input: CharacterVisualProfileWrite): Promise<CharacterVisualProfileRecord> {
    const rows = await this.rows<CharacterVisualProfileRecord>(
      `insert into public.mesa_character_visual_profiles (character_id,owner_token,display_name)
       values ($1,$2,$3)
       on conflict (character_id) do update set display_name = excluded.display_name, updated_at = now()
       where public.mesa_character_visual_profiles.owner_token = $2
       returning *`,
      [input.characterId, input.ownerToken, input.displayName],
      "Falha ao salvar a identidade visual",
    );
    if (!rows[0]) {
      // Sem linha retornada significa conflito de posse: o personagem já tem
      // identidade visual gravada com outro token.
      throw new DatabaseQueryError("Falha ao salvar a identidade visual: personagem pertence a outro jogador");
    }
    return rows[0];
  }

  async listAssets(characterId: string): Promise<CharacterVisualAssetRecord[]> {
    return this.rows<CharacterVisualAssetRecord>(
      `select * from public.mesa_character_visual_assets
       where character_id = $1
       order by kind, coalesce(state, '')`,
      [characterId],
      "Falha ao listar as imagens do personagem",
    );
  }

  async findAsset(assetId: string): Promise<CharacterVisualAssetRecord | null> {
    const rows = await this.rows<CharacterVisualAssetRecord>(
      "select * from public.mesa_character_visual_assets where id = $1 limit 1",
      [assetId],
      "Falha ao consultar a imagem",
    );
    return rows[0] ?? null;
  }

  async upsertAsset(input: CharacterVisualAssetWrite): Promise<CharacterVisualAssetRecord> {
    // O slot é único por `(character_id, kind, coalesce(state, ''))`. O `where`
    // do ON CONFLICT reforça a posse mesmo se o domínio tiver um descuido: um
    // slot ocupado por outro token nunca é sobrescrito.
    const rows = await this.rows<CharacterVisualAssetRecord>(
      `insert into public.mesa_character_visual_assets
         (id,character_id,owner_token,kind,state,storage_mode,storage_ref,mime_type,width,height,byte_size)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (character_id, kind, coalesce(state, '')) do update set
         owner_token = excluded.owner_token,
         storage_mode = excluded.storage_mode,
         storage_ref = excluded.storage_ref,
         mime_type = excluded.mime_type,
         width = excluded.width,
         height = excluded.height,
         byte_size = excluded.byte_size,
         updated_at = now()
       where public.mesa_character_visual_assets.owner_token = $3
       returning *`,
      [
        input.id, input.characterId, input.ownerToken, input.kind, input.state,
        input.storageMode, input.storageRef, input.mimeType, input.width, input.height, input.byteSize,
      ],
      "Falha ao salvar a imagem do personagem",
    );
    if (!rows[0]) {
      throw new DatabaseQueryError("Falha ao salvar a imagem do personagem: slot ocupado por outro jogador");
    }
    return rows[0];
  }

  async deleteAsset(assetId: string, characterId: string): Promise<boolean> {
    const rows = await this.rows<{ id: string }>(
      "delete from public.mesa_character_visual_assets where id = $1 and character_id = $2 returning id",
      [assetId, characterId],
      "Falha ao remover a imagem do personagem",
    );
    return rows.length > 0;
  }
}
