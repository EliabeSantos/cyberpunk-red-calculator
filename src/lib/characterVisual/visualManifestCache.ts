"use client";

/**
 * Cache de sessão dos manifestos visuais consumidos pelo combate.
 *
 * A tela de combate consulta o manifesto dos personagens UMA VEZ por sessão
 * (não a cada renderização): o resultado fica num Map de módulo com TTL curto
 * — muito menor que a validade das URLs assinadas (24h) — e é revalidado
 * quando expira ou quando uma imagem falha ao carregar.
 *
 * Nenhuma fonte nova de dados: o manifesto vem da MESMA rota
 * `/api/character-visual` da Etapa 1, autenticada pelo player token do
 * navegador (header `x-mesa-token`, nunca na URL). O `sessionId` é repassado
 * para que o gate de participante permita ler os personagens vinculados da
 * mesa (inclusive os dos outros jogadores) — sem ele, só o dono lê o próprio
 * perfil.
 *
 * Falhas de carregamento de IMAGEM (403 de URL vencida, rede) são registradas
 * por URL aqui: o resolvedor de estados pula a URL marcada e cai no próximo
 * fallback (ou no boneco genérico), sem derrubar o combate.
 */

import {
  fetchCharacterVisual,
  type CharacterVisualApiError,
} from "@/lib/characterVisual/visualClient";
import type { CharacterVisualIdentity } from "@/lib/characterVisual/visualIdentity";

/** TTL do cache de manifesto — janela segura dentro da validade da URL assinada. */
export const VISUAL_MANIFEST_TTL_MS = 15 * 60 * 1000;

interface CacheEntry {
  identity: CharacterVisualIdentity | null;
  fetchedAt: number;
  pending?: Promise<CharacterVisualIdentity | null>;
}

const cache = new Map<string, CacheEntry>();
const failedUrls = new Set<string>();

/** Fetch injetável para testes; em produção usa o `fetchCharacterVisual` real. */
export type VisualManifestFetcher = (
  characterId: string,
  options: { sessionId?: string; fallbackName?: string },
) => Promise<CharacterVisualIdentity>;

function defaultFetcher(characterId: string, options: { sessionId?: string; fallbackName?: string }) {
  return fetchCharacterVisual(characterId, options);
}

let fetcher: VisualManifestFetcher = defaultFetcher;

/** Troca o fetcher (testes). Chame `resetVisualManifestCache()` ao restaurar. */
export function setVisualManifestFetcher(next: VisualManifestFetcher): void {
  fetcher = next;
}

/**
 * Garante os manifestos dos personagens pedidos. Personagens sem
 * personalização (ou sem permissão de leitura) resolvem para ausência no mapa
 * — o renderizador usa o boneco genérico; nunca lança para o caller, para que
 * uma falha de manifesto não interrompa o combate.
 */
export async function ensureVisualManifests(
  characterIds: readonly string[],
  options: { sessionId?: string; fallbackName?: (characterId: string) => string; now?: () => number } = {},
): Promise<Record<string, CharacterVisualIdentity>> {
  const now = options.now ?? Date.now;
  const unique = [...new Set(characterIds.filter((id) => typeof id === "string" && id.length > 0))];
  const settled = await Promise.all(unique.map(async (characterId) => {
    const entry = cache.get(characterId);
    // Sucesso OU falha memorizada dentro do TTL: não refaz a consulta.
    if (entry && !entry.pending && now() - entry.fetchedAt < VISUAL_MANIFEST_TTL_MS) {
      return [characterId, entry.identity] as const;
    }
    if (entry?.pending) return [characterId, await entry.pending] as const;

    const fallbackName = options.fallbackName?.(characterId);
    const pending = fetcher(characterId, {
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      ...(fallbackName ? { fallbackName } : {}),
    }).then((identity) => {
      cache.set(characterId, { identity, fetchedAt: now() });
      return identity;
    }).catch(() => {
      // Falha (rede/permissão/personagem inexistente): registra a ausência por
      // um TTL curto para não martelar a rota a cada renderização.
      cache.set(characterId, { identity: null, fetchedAt: now() });
      return null;
    });
    cache.set(characterId, { identity: entry?.identity ?? null, fetchedAt: entry?.fetchedAt ?? 0, pending });
    return [characterId, await pending] as const;
  }));

  const result: Record<string, CharacterVisualIdentity> = {};
  for (const [characterId, identity] of settled) {
    if (identity) result[characterId] = identity;
  }
  return result;
}

/**
 * Invalida o manifesto de um personagem (ou de todos) — chamado após salvar
 * ou remover imagens na tela de personalização e quando uma URL falha ao
 * carregar (a revalidação puxa uma URL assinada nova).
 */
export function invalidateVisualManifest(characterId?: string): void {
  if (characterId === undefined) cache.clear();
  else cache.delete(characterId);
}

/** Marca uma URL como falha para o resolvedor de estados pular no fallback. */
export function markVisualUrlFailed(url: string): void {
  failedUrls.add(url);
}

export function isVisualUrlFailed(url: string): boolean {
  return failedUrls.has(url);
}

/** Zera cache de manifesto e URLs falhas (testes / nova sessão de mesa). */
export function resetVisualManifestCache(): void {
  cache.clear();
  failedUrls.clear();
}

export type { CharacterVisualApiError };
