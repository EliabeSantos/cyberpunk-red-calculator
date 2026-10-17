"use client";

/**
 * Cliente HTTP da identidade visual (SOMENTE navegador).
 *
 * Mesmo desenho de `toolkitClient.ts`: `fetch` puro para as rotas da própria
 * aplicação, com o player token no header `x-mesa-token` (nunca na URL).
 */

import { getPlayerToken } from "@/lib/mesa/membershipStore";
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

async function request(
  method: "GET" | "PUT" | "DELETE",
  { query, body }: { query?: Record<string, string>; body?: Record<string, unknown> } = {},
): Promise<CharacterVisualIdentity> {
  const search = query
    ? Object.entries(query)
      .filter(([, value]) => value.length > 0)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join("&")
    : "";
  const response = await fetch(`/api/character-visual${search ? `?${search}` : ""}`, {
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

export function slotBody(slot: ClientVisualSlot): Record<string, unknown> {
  return slot.kind === "portrait" ? { slot: "portrait" } : { slot: "combat_state", state: slot.state };
}

export async function fetchCharacterVisual(
  characterId: string,
  options: { sessionId?: string; fallbackName?: string } = {},
): Promise<CharacterVisualIdentity> {
  return request("GET", {
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
