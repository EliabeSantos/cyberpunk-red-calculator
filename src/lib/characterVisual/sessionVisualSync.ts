"use client";

/**
 * Sincronização da identidade visual para o host da Mesa (SOMENTE navegador).
 *
 * Em uma Mesa compartilhada, o armazenamento persistente autorizado é o do
 * HOST da Mesa — não o disco da instância de quem personalizou. Quando a Mesa
 * vive noutra origem (membership `serverUrl`), este módulo empurra a
 * identidade do personagem (nome + binários) para o host, usando o MESMO
 * token do participante:
 *
 * - leitura local do manifesto (caminho do dono, mesma origem);
 * - leitura do manifesto no host (caminho de participante, `sessionId`);
 * - PUT de cada slot configurado com o binário baixado do armazenamento local;
 * - DELETE dos slots que só existem no host (espelho das remoções locais).
 *
 * Autorização: o servidor valida de novo — posse do perfil E vínculo do
 * participante com o personagem (gate de escrita por sessão). Este módulo só
 * decide QUANDO tentar; nunca decide QUEM pode. Falhas são silenciosas por
 * desenho: quebrar a entrada na Mesa por causa de imagem não é aceitável, e a
 * próxima entrada/vínculo tenta de novo.
 *
 * Estados sem imagem própria (fallback de `IDLE`) NÃO são empurrados como
 * slot: o host resolve o mesmo fallback sozinho.
 */

import { getPlayerToken, listMemberships, type MesaEntry } from "@/lib/mesa/membershipStore";
import {
  requestCharacterVisual,
  slotBody,
  visualSessionOrigin,
  type ClientVisualSlot,
} from "@/lib/characterVisual/visualClient";
import type { CharacterVisualIdentity } from "@/lib/characterVisual/visualIdentity";
import type { CombatVisualState } from "@/lib/characterVisual/visualStates";
import type { MesaState } from "@/lib/mesa/types";

/** Baixa um binário da mesma origem (armazenamento local) como data URL. */
async function fetchDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Falha ao ler a imagem local (HTTP ${response.status}).`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const mimeType = response.headers.get("content-type") ?? "image/png";
  // `btoa` em pedaços: um data URL de vários MB estoura a pilha como string.
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

/** Slots com imagem PRÓPRIA no manifesto local (retrato + estados configurados). */
function ownedLocalSlots(identity: CharacterVisualIdentity): Array<{ slot: ClientVisualSlot; url: string }> {
  const slots: Array<{ slot: ClientVisualSlot; url: string }> = [];
  if (identity.portraitAssetId && identity.portraitUrl) {
    slots.push({ slot: { kind: "portrait" }, url: identity.portraitUrl });
  }
  for (const state of identity.states) {
    if (state.source === "state" && state.assetId && state.url) {
      slots.push({ slot: { kind: "combat_state", state: state.state }, url: state.url });
    }
  }
  return slots;
}

function slotKeyOf(identity: CharacterVisualIdentity): Set<string> {
  return new Set<string>([
    ...(identity.portraitAssetId ? ["portrait"] : []),
    ...identity.configuredStates.map((state) => `state:${state}`),
  ]);
}

function slotFromKey(key: string): ClientVisualSlot {
  if (key === "portrait") return { kind: "portrait" };
  return { kind: "combat_state", state: key.slice("state:".length) as CombatVisualState };
}

/**
 * Espelha a identidade visual LOCAL deste personagem no host da Mesa da
 * sessão informada. A Mesa precisa pertencer a este navegador com `serverUrl`
 * (sem `serverUrl` a origem local JÁ é o host e não há nada a fazer).
 */
export async function syncCharacterVisualToSession(characterId: string, sessionId: string): Promise<void> {
  const origin = visualSessionOrigin(sessionId);
  if (!origin) return;

  // Manifesto local (dono) — a fonte autoritativa do que deve existir no host.
  const local = await requestCharacterVisual("GET", { query: { characterId } });

  // Manifesto atual no host (leitura de participante). Recusa aqui significa
  // sessão expirada ou personagem fora da mesa: nada a sincronizar.
  let host: CharacterVisualIdentity;
  try {
    host = await requestCharacterVisual("GET", { origin, query: { characterId, sessionId } });
  } catch {
    return;
  }

  // Nome de exibição configurado (o fallback nunca é escrito como nome).
  if (local.displayName !== local.fallbackDisplayName && local.displayName !== host.displayName) {
    await requestCharacterVisual("PUT", {
      origin,
      body: { characterId, sessionId, displayName: local.displayName },
    });
  }

  // Cada slot com imagem própria: baixa o binário local e envia ao host.
  for (const { slot, url } of ownedLocalSlots(local)) {
    const imageDataUrl = await fetchDataUrl(url);
    await requestCharacterVisual("PUT", {
      origin,
      body: { characterId, sessionId, ...slotBody(slot), imageDataUrl },
    });
  }

  // Slots removidos localmente são removidos no host (espelho exato).
  const localKeys = slotKeyOf(local);
  for (const key of slotKeyOf(host)) {
    if (localKeys.has(key)) continue;
    await requestCharacterVisual("DELETE", {
      origin,
      body: { characterId, sessionId, ...slotBody(slotFromKey(key)) },
    });
  }
}

/** A membership deste navegador aponta este personagem na sessão remota? */
async function sessionLinksCharacter(membership: MesaEntry, characterId: string): Promise<boolean> {
  const response = await fetch(`${membership.serverUrl}/api/mesa/${encodeURIComponent(membership.sessionId)}`, {
    headers: { "x-mesa-token": getPlayerToken() },
  });
  if (!response.ok) return false;
  const payload = await response.json().catch(() => ({})) as { ok?: boolean; state?: MesaState };
  const state = payload.state;
  if (!payload.ok || !state) return false;
  const me = state.participants.find((entry) => entry.id === state.viewer.participantId);
  return me?.characterId === characterId;
}

/**
 * Sincroniza para TODAS as Mesas remotas deste navegador onde este personagem
 * está vinculado (chamado após salvar/remover imagens na personalização).
 * O estado da Mesa é consultado antes de enviar bytes: um personagem não
 * vinculado nunca dispara upload inútil — e, mesmo assim, o servidor revalida
 * posse + vínculo em cada escrita.
 */
export async function maybeSyncCharacterVisualToSessions(characterId: string): Promise<void> {
  if (typeof window === "undefined") return;
  for (const membership of listMemberships()) {
    if (!membership.serverUrl) continue;
    try {
      if (await sessionLinksCharacter(membership, characterId)) {
        await syncCharacterVisualToSession(characterId, membership.sessionId);
      }
    } catch {
      // Silencioso: a próxima entrada na Mesa (re-vínculo) tenta de novo.
    }
  }
}
