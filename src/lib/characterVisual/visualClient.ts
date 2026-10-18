"use client";

/**
 * Cliente HTTP da identidade visual (SOMENTE navegador).
 *
 * Mesmo desenho de `toolkitClient.ts`: `fetch` puro para as rotas da própria
 * aplicação, com o player token no header `x-mesa-token` (nunca na URL).
 */

import { getPlayerToken, listMemberships } from "@/lib/mesa/membershipStore";
import type { CombatVisualState } from "@/lib/characterVisual/visualStates";
import type { CharacterVisualIdentity } from "@/lib/characterVisual/visualIdentity";

export type ClientVisualSlot = { kind: "portrait" } | { kind: "combat_state"; state: CombatVisualState };

export class CharacterVisualApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = "CharacterVisualApiError";
  }
}

/**
 * Origem do host da Mesa para uma sessão deste navegador.
 *
 * `null` = a Mesa vive na MESMA origem deste aplicativo (nada a rotear). Um
 * `serverUrl` presente significa que a Mesa (e o armazenamento persistente
 * dela) está em outro servidor — mesmo critério de `api()` em
 * `mesa/client.ts`: quem entra numa Mesa remota precisa falar com o host da
 * Mesa, não com a instância local (senão só o caminho do dono funciona e os
 * demais participantes nunca veem as imagens).
 */
export function visualSessionOrigin(sessionId: string | null | undefined): string | null {
  if (!sessionId) return null;
  const membership = listMemberships().find((entry) => entry.sessionId === sessionId);
  return membership?.serverUrl ?? null;
}

async function request(
  method: "GET" | "PUT" | "DELETE",
  { query, body, origin }: {
    query?: Record<string, string>;
    body?: Record<string, unknown>;
    /** Origem do host da Mesa; ausente = mesma origem (caminho local). */
    origin?: string | null;
  } = {},
): Promise<CharacterVisualIdentity> {
  const search = query
    ? Object.entries(query)
      .filter(([, value]) => value.length > 0)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join("&")
    : "";
  const path = `/api/character-visual${search ? `?${search}` : ""}`;
  const response = await fetch(origin ? `${origin}${path}` : path, {
    method,
    headers: { "content-type": "application/json", "x-mesa-token": getPlayerToken() },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const result = await response.json().catch(() => ({})) as {
    ok?: boolean; error?: string; code?: string; identity?: CharacterVisualIdentity;
  };
  if (!response.ok || !result.ok || !result.identity) {
    throw new CharacterVisualApiError(
      result.code ?? "character_visual_request_failed",
      result.error ?? "Não foi possível acessar a personalização visual.",
      response.status,
    );
  }
  return result.identity;
}

/**
 * Requisição bruta da rota `/api/character-visual` (usada também pela
 * sincronização de identidade para o host da Mesa). Lança
 * `CharacterVisualApiError` em qualquer falha.
 */
export async function requestCharacterVisual(
  method: "GET" | "PUT" | "DELETE",
  options: {
    query?: Record<string, string>;
    body?: Record<string, unknown>;
    origin?: string | null;
  } = {},
): Promise<CharacterVisualIdentity> {
  return request(method, options);
}

export function slotBody(slot: ClientVisualSlot): Record<string, unknown> {
  return slot.kind === "portrait" ? { slot: "portrait" } : { slot: "combat_state", state: slot.state };
}

export async function fetchCharacterVisual(
  characterId: string,
  options: { sessionId?: string; fallbackName?: string } = {},
): Promise<CharacterVisualIdentity> {
  // Com `sessionId`, a consulta é roteada para o host da Mesa (membership
  // `serverUrl`); sem sessão, é a leitura local do próprio dono.
  return request("GET", {
    origin: visualSessionOrigin(options.sessionId),
    query: {
      characterId,
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      ...(options.fallbackName ? { name: options.fallbackName } : {}),
    },
  });
}

export async function saveCharacterVisualDisplayName(
  characterId: string,
  displayName: string,
): Promise<CharacterVisualIdentity> {
  return request("PUT", { body: { characterId, displayName } });
}

export async function saveCharacterVisualImage(
  characterId: string,
  slot: ClientVisualSlot,
  imageDataUrl: string,
): Promise<CharacterVisualIdentity> {
  return request("PUT", { body: { characterId, ...slotBody(slot), imageDataUrl } });
}

export async function removeCharacterVisualImage(
  characterId: string,
  slot: ClientVisualSlot,
): Promise<CharacterVisualIdentity> {
  return request("DELETE", { body: { characterId, ...slotBody(slot) } });
}
