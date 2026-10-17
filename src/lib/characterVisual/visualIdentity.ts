/**
 * Identidade visual de um personagem (SOMENTE módulo puro).
 *
 * Montagem do "manifesto" que o futuro renderizador de combate vai consultar:
 * retrato de perfil, imagem por estado com fallback para `IDLE`, fallback
 * genérico para personagens legados sem personalização e o estado de
 * conclusão da configuração (obrigatória apenas a imagem `IDLE`).
 *
 * Este módulo não fala com banco nem com rede: recebe o perfil/ativos já
 * carregados e as URLs assinadas geradas pelo servidor.
 */

import {
  COMBAT_VISUAL_STATE_CATALOG,
  REQUIRED_VISUAL_STATES,
  isCombatVisualState,
  type CombatVisualState,
} from "@/lib/characterVisual/visualStates";

export type CharacterVisualAssetKind = "portrait" | "combat_state";

/** Referência de um asset persistido, com a URL assinada para exibição. */
export interface CharacterVisualAssetRef {
  assetId: string;
  kind: CharacterVisualAssetKind;
  /** Estado de combate; `null` para o retrato de perfil. */
  state: CombatVisualState | null;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  /** URL assinada de curta duração servida pela própria aplicação. */
  url: string;
  updatedAt: string;
}

/** Origem da imagem resolvida para um estado. */
export type VisualImageSource = "state" | "idle-fallback" | "generic-fallback";

export interface ResolvedStateVisual {
  state: CombatVisualState;
  label: string;
  /** `null` quando não há imagem nem `IDLE`: o renderizador usa o sprite genérico. */
  url: string | null;
  assetId: string | null;
  source: VisualImageSource;
}

export interface CharacterVisualCompletion {
  ready: boolean;
  missingRequired: CombatVisualState[];
}

export interface CharacterVisualIdentity {
  characterId: string;
  /** Nome de exibição da identidade visual (não confundir com o id persistente). */
  displayName: string;
  fallbackDisplayName: string;
  portraitUrl: string | null;
  portraitAssetId: string | null;
  hasIdle: boolean;
  configuredStates: CombatVisualState[];
  missingStates: CombatVisualState[];
  /** Todos os estados do catálogo, resolvidos com fallback — nunca vazio. */
  states: ResolvedStateVisual[];
  completion: CharacterVisualCompletion;
  updatedAt: string | null;
}

/** Dados persistidos do personagem prontos para resolução (sem binários). */
export interface CharacterVisualProfileData {
  characterId: string;
  displayName: string | null;
  updatedAt: string | null;
  portrait: CharacterVisualAssetRef | null;
  stateImages: Partial<Record<CombatVisualState, CharacterVisualAssetRef>>;
}

export const FALLBACK_DISPLAY_NAME = "Personagem sem identidade visual";

function isKnownState(value: string | null): value is CombatVisualState {
  return isCombatVisualState(value);
}

/** Estado vazio para personagens que nunca foram personalizados. */
export function emptyCharacterVisualProfile(characterId: string): CharacterVisualProfileData {
  return { characterId, displayName: null, updatedAt: null, portrait: null, stateImages: {} };
}

/**
 * Resolve o manifesto final:
 * - estado com imagem própria → `source: "state"`;
 * - estado sem imagem mas com `IDLE` → `source: "idle-fallback"` (mesma URL/asset);
 * - sem nada → `source: "generic-fallback"`, `url: null` (sprite genérico);
 * - `completion.ready` exige a imagem obrigatória `IDLE`.
 */
export function resolveCharacterVisualIdentity(
  profile: CharacterVisualProfileData,
  fallbackDisplayName: string,
): CharacterVisualIdentity {
  const configuredStates = (Object.keys(profile.stateImages) as string[])
    .filter(isKnownState);
  const hasIdle = profile.stateImages.IDLE !== undefined;

  const states: ResolvedStateVisual[] = COMBAT_VISUAL_STATE_CATALOG.map((definition) => {
    const own = profile.stateImages[definition.id];
    if (own) {
      return { state: definition.id, label: definition.label, url: own.url, assetId: own.assetId, source: "state" as const };
    }
    const idle = profile.stateImages.IDLE;
    if (idle) {
      return { state: definition.id, label: definition.label, url: idle.url, assetId: idle.assetId, source: "idle-fallback" as const };
    }
    return { state: definition.id, label: definition.label, url: null, assetId: null, source: "generic-fallback" as const };
  });

  const missingRequired = REQUIRED_VISUAL_STATES.filter((state) => profile.stateImages[state] === undefined);
  const configuredName = typeof profile.displayName === "string" ? profile.displayName.trim() : "";
  const fallbackName = fallbackDisplayName.trim();

  return {
    characterId: profile.characterId,
    displayName: configuredName || fallbackName || FALLBACK_DISPLAY_NAME,
    fallbackDisplayName: fallbackName || FALLBACK_DISPLAY_NAME,
    portraitUrl: profile.portrait?.url ?? null,
    portraitAssetId: profile.portrait?.assetId ?? null,
    hasIdle,
    configuredStates,
    missingStates: COMBAT_VISUAL_STATE_CATALOG
      .map((definition) => definition.id)
      .filter((state) => profile.stateImages[state] === undefined),
    states,
    completion: { ready: missingRequired.length === 0, missingRequired },
    updatedAt: profile.updatedAt,
  };
}
