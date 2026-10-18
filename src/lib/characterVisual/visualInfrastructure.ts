/**
 * Factory da identidade visual (SOMENTE servidor).
 *
 * A modalidade vem do MESMO mecanismo de configuração da Mesa —
 * `MESA_HOSTING_MODE`, sem fallback silencioso:
 *
 * - `local`    → repositório no PostgreSQL local (pool memoizado do lifecycle
 *   existente) + arquivos em `resolveLocalAssetsRoot()`;
 * - `supabase` → repositório via service role + bucket privado do Supabase
 *   Storage.
 *
 * Os componentes Supabase são importados tardiamente: modo local nunca
 * inicializa nem importa o cliente Supabase (mesma disciplina da factory da
 * Mesa em `hostingInfrastructure.ts`).
 */
import { createMesaHostingInfrastructure, getLocalPostgresLifecycle, resolveMesaHostingMode } from "@/lib/mesa/hostingInfrastructure";
import { CharacterVisualService, createMesaSessionReadGate, createMesaSessionWriteGate } from "@/lib/characterVisual/characterVisualServer";
import type { CharacterAssetStorage, CharacterVisualRepository } from "@/lib/characterVisual/infrastructure";

export async function createCharacterVisualRepository(): Promise<CharacterVisualRepository> {
  const mode = resolveMesaHostingMode();
  if (mode === "local") {
    const lifecycle = await getLocalPostgresLifecycle();
    const { LocalPostgresCharacterVisualRepository } = await import("@/lib/characterVisual/localVisualRepository");
    return new LocalPostgresCharacterVisualRepository(lifecycle.pool);
  }
  const { SupabaseCharacterVisualRepository } = await import("@/lib/characterVisual/supabaseVisualRepository");
  const { getSupabaseAdmin } = await import("@/lib/supabaseAdmin");
  return new SupabaseCharacterVisualRepository(getSupabaseAdmin());
}

export async function createCharacterAssetStorage(): Promise<CharacterAssetStorage> {
  const mode = resolveMesaHostingMode();
  if (mode === "local") {
    const { LocalFileAssetStorage } = await import("@/lib/characterVisual/localAssetStorage");
    return new LocalFileAssetStorage();
  }
  const { SupabaseBucketAssetStorage } = await import("@/lib/characterVisual/supabaseAssetStorage");
  const { getSupabaseAdmin } = await import("@/lib/supabaseAdmin");
  return new SupabaseBucketAssetStorage(getSupabaseAdmin());
}

/** Serviço completo, com os gates de leitura (participantes da Mesa) e de escrita sincronizada (push para host remoto). */
export async function createCharacterVisualService(): Promise<CharacterVisualService> {
  const [repository, storage] = await Promise.all([
    createCharacterVisualRepository(),
    createCharacterAssetStorage(),
  ]);
  return new CharacterVisualService({
    repository,
    storage,
    sessionGate: createMesaSessionReadGate(createMesaHostingInfrastructure),
    sessionWriteGate: createMesaSessionWriteGate(),
  });
}
