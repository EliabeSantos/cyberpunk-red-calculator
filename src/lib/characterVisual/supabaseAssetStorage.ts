/**
 * Storage do Supabase Storage para a identidade visual (modo `supabase`).
 *
 * Bucket PRIVADO `mesa-character-visuals`, criado sob demanda via service
 * role e memoizado por processo. Não existe política de leitura pública nem
 * acesso do navegador ao bucket: o bucket é "privado de fato" porque só o
 * servidor (service role) o lê/escreve, e as rotas `/api/character-visual`
 * autorizam cada acesso pelo token do participante — mesmo desenho das
 * demais tabelas da Mesa, que rodam com RLS habilitado e sem policies.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { isSafeCharacterAssetRef, type CharacterAssetStorage } from "@/lib/characterVisual/infrastructure";

export const CHARACTER_VISUAL_BUCKET = "mesa-character-visuals";

type SupabaseStorageError = { message: string } | null;

const globalForStorage = globalThis as unknown as {
  mesaCharacterVisualBucketReady?: Promise<void>;
};

/** Cria o bucket privado uma vez por processo; erro de "já existe" é ignorado. */
async function ensureBucket(client: SupabaseClient): Promise<void> {
  const existing = globalForStorage.mesaCharacterVisualBucketReady;
  if (existing) return existing;
  const ready = (async () => {
    const { error } = await client.storage.createBucket(CHARACTER_VISUAL_BUCKET, { public: false });
    if (error && !/already exists/i.test(error.message)) throw error;
  })();
  globalForStorage.mesaCharacterVisualBucketReady = ready;
  try {
    await ready;
  } catch (error) {
    globalForStorage.mesaCharacterVisualBucketReady = undefined;
    throw error;
  }
}

function safePath(ref: string): string {
  if (!isSafeCharacterAssetRef(ref)) throw new Error(`ref de asset inválido: ${ref}`);
  return ref;
}

export class SupabaseBucketAssetStorage implements CharacterAssetStorage {
  readonly mode = "supabase" as const;
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  async put(ref: string, bytes: Uint8Array, mimeType: string): Promise<void> {
    await ensureBucket(this.client);
    const { error }: { error: SupabaseStorageError } = await this.client.storage
      .from(CHARACTER_VISUAL_BUCKET)
      .upload(safePath(ref), bytes, { contentType: mimeType, upsert: true });
    if (error) throw new Error(`Falha ao enviar a imagem para o storage: ${error.message}`);
  }

  async get(ref: string): Promise<Uint8Array | null> {
    await ensureBucket(this.client);
    const { data, error }: { data: Blob | null; error: SupabaseStorageError } = await this.client.storage
      .from(CHARACTER_VISUAL_BUCKET)
      .download(safePath(ref));
    if (error) {
      if (/not found/i.test(error.message)) return null;
      throw new Error(`Falha ao baixar a imagem do storage: ${error.message}`);
    }
    return data ? new Uint8Array(await data.arrayBuffer()) : null;
  }

  async delete(ref: string): Promise<void> {
    await ensureBucket(this.client);
    const { error }: { error: SupabaseStorageError } = await this.client.storage
      .from(CHARACTER_VISUAL_BUCKET)
      .remove([safePath(ref)]);
    if (error) throw new Error(`Falha ao remover a imagem do storage: ${error.message}`);
  }
}
