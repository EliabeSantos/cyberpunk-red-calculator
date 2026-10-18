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
 * perfil. Quando a Mesa vive em outra origem (membership `serverUrl`), a
 * consulta vai para o host da Mesa e as URLs assinadas do manifesto são
 * absolutizadas nessa origem — o arquivo existe no armazenamento do host, não
 * no disco do navegador de quem personalizou.
 *
 * Falhas de carregamento de IMAGEM (403 de URL vencida, rede) são registradas
 * por URL aqui: o resolvedor de estados pula a URL marcada e cai no próximo
 * fallback (ou no boneco genérico), sem derrubar o combate.
 */

import {
  fetchCharacterVisual,
  visualSessionOrigin,
  type CharacterVisualApiError,
} from "@/lib/characterVisual/visualClient";
import type { CharacterVisualIdentity } from "@/lib/characterVisual/visualIdentity";

/** TTL do cache de manifesto — janela segura dentro da validade da URL assinada. */
export const VISUAL_MANIFEST_TTL_MS = 15 * 60 * 1000;

/**
 * TTL para manifestos SEM nenhuma personalização (retrato e estados ausentes):
 * janela curta para a primeira imagem de um personagem aparecer na Mesa sem
 * exigir que ninguém saia e entre de novo (o manifesto vazio é revalidado
 * logo em seguida), mantendo o custo limitado a uma consulta por personagem
 * por minuto.
 */
export const VISUAL_MANIFEST_EMPTY_TTL_MS = 60 * 1000;

interface CacheEntry {
  identity: CharacterVisualIdentity | null;
  fetchedAt: number;
  pending?: Promise<CharacterVisualIdentity | null>;
}

const cache = new Map<string, CacheEntry>();
const failedUrls = new Set<string>();

/**
 * Chave inclui a ORIGEM do host da Mesa: o mesmo personagem pode ser lido do
 * host local e de um host remoto na mesma aba, e as URLs assinadas de um não
 * valem para o outro.
 */
function cacheKey(origin: string | null, characterId: string): string {
  return `${origin ?? ""}|${characterId}`;
}

function isCustomized(identity: CharacterVisualIdentity): boolean {
  return identity.portraitAssetId !== null || identity.configuredStates.length > 0;
}

/**
 * Prefixa as URLs assinadas (relativas) com a origem do host que serviu o
 * manifesto — uma tag `<img>` relativa apontaria para a instância LOCAL e o
 * arquivo existe no host da Mesa.
 */
function absolutizeIdentity(identity: CharacterVisualIdentity, origin: string | null): CharacterVisualIdentity {
  if (!origin) return identity;
  const absolute = (url: string | null): string | null => (url && url.startsWith("/") ? `${origin}${url}` : url);
  return {
    ...identity,
    portraitUrl: absolute(identity.portraitUrl),
    states: identity.states.map((state) => ({ ...state, url: absolute(state.url) })),
  };
}

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
  const origin = visualSessionOrigin(options.sessionId);
  const unique = [...new Set(characterIds.filter((id) => typeof id === "string" && id.length > 0))];
  const settled = await Promise.all(unique.map(async (characterId) => {
    const key = cacheKey(origin, characterId);
    const entry = cache.get(key);
    // Sucesso OU falha memorizada dentro do TTL: não refaz a consulta.
    if (entry && !entry.pending) {
      const ttl = entry.identity && isCustomized(entry.identity)
        ? VISUAL_MANIFEST_TTL_MS
        : VISUAL_MANIFEST_EMPTY_TTL_MS;
      if (now() - entry.fetchedAt < ttl) return [characterId, entry.identity] as const;
    }
    if (entry?.pending) return [characterId, await entry.pending] as const;

    const fallbackName = options.fallbackName?.(characterId);
    const pending = fetcher(characterId, {
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      ...(fallbackName ? { fallbackName } : {}),
    }).then((identity) => {
      const resolved = absolutizeIdentity(identity, origin);
      cache.set(key, { identity: resolved, fetchedAt: now() });
      return resolved;
    }).catch(() => {
      // Falha (rede/permissão/personagem inexistente): registra a ausência por
      // um TTL curto para não martelar a rota a cada renderização.
      cache.set(key, { identity: null, fetchedAt: now() });
      return null;
    });
    cache.set(key, { identity: entry?.identity ?? null, fetchedAt: entry?.fetchedAt ?? 0, pending });
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
 * carregar (a revalidação puxa uma URL assinada nova). Apaga TODAS as origens
 * daquele personagem (local e hosts remotos).
 */
export function invalidateVisualManifest(characterId?: string): void {
  if (characterId === undefined) {
    cache.clear();
    return;
  }
  const suffix = `|${characterId}`;
  for (const key of [...cache.keys()]) {
    if (key.endsWith(suffix)) cache.delete(key);
  }
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
