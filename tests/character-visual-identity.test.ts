/**
 * Resolução da identidade visual (manifesto consumido pelo futuro renderizador).
 *
 * Critérios:
 * - estado sem imagem própria cai para a imagem IDLE;
 * - personagem sem nenhuma personalização (legado) recebe fallback genérico
 *   sem quebrar: todos os estados continuam presentes, com `url: null`;
 * - a conclusão da configuração exige a imagem obrigatória IDLE;
 * - o nome de exibição é independente do identificador persistente.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FALLBACK_DISPLAY_NAME,
  emptyCharacterVisualProfile,
  resolveCharacterVisualIdentity,
  type CharacterVisualAssetRef,
  type CharacterVisualProfileData,
} from "../src/lib/characterVisual/visualIdentity.ts";

function assetRef(assetId: string, state: "IDLE" | "ATTACK" | null): CharacterVisualAssetRef {
  return {
    assetId,
    kind: state === null ? "portrait" : "combat_state",
    state,
    mimeType: "image/png",
    width: 512,
    height: 512,
    byteSize: 1024,
    url: `/api/character-visual/asset/${assetId}?e=1&s=x`,
    updatedAt: "2026-11-01T00:00:00.000Z",
  };
}

test("personagem legado sem personalização recebe fallback genérico e incompleto", () => {
  const profile = emptyCharacterVisualProfile("char-1");
  const identity = resolveCharacterVisualIdentity(profile, "V");
  assert.equal(identity.characterId, "char-1");
  assert.equal(identity.hasIdle, false);
  assert.equal(identity.completion.ready, false);
  assert.deepEqual([...identity.completion.missingRequired], ["IDLE"]);
  assert.equal(identity.portraitUrl, null);
  // Nenhum estado some do manifesto: o renderizador sempre tem o que consultar.
  assert.equal(identity.states.length, 10);
  for (const state of identity.states) {
    assert.equal(state.url, null);
    assert.equal(state.assetId, null);
    assert.equal(state.source, "generic-fallback");
  }
});

test("IDLE configurada vira fallback dos estados opcionais ausentes", () => {
  const profile: CharacterVisualProfileData = {
    characterId: "char-2",
    displayName: "Nova",
    updatedAt: "2026-11-01T00:00:00.000Z",
    portrait: null,
    stateImages: { IDLE: assetRef("a-idle", "IDLE") },
  };
  const identity = resolveCharacterVisualIdentity(profile, "V");
  assert.equal(identity.hasIdle, true);
  assert.equal(identity.completion.ready, true);
  assert.deepEqual([...identity.completion.missingRequired], []);
  assert.deepEqual([...identity.configuredStates], ["IDLE"]);
  const idle = identity.states.find((state) => state.state === "IDLE");
  const attack = identity.states.find((state) => state.state === "ATTACK");
  assert.equal(idle?.source, "state");
  assert.equal(idle?.url, "/api/character-visual/asset/a-idle?e=1&s=x");
  // Sem ATTACK própria, o estado usa a IDLE — nunca some do manifesto.
  assert.equal(attack?.source, "idle-fallback");
  assert.equal(attack?.url, "/api/character-visual/asset/a-idle?e=1&s=x");
  assert.equal(attack?.assetId, "a-idle");
});

test("estado com imagem própria tem prioridade sobre o fallback IDLE", () => {
  const profile: CharacterVisualProfileData = {
    characterId: "char-3",
    displayName: null,
    updatedAt: null,
    portrait: assetRef("a-portrait", null),
    stateImages: {
      IDLE: assetRef("a-idle", "IDLE"),
      ATTACK: assetRef("a-attack", "ATTACK"),
    },
  };
  const identity = resolveCharacterVisualIdentity(profile, "Nome da ficha");
  const attack = identity.states.find((state) => state.state === "ATTACK");
  assert.equal(attack?.source, "state");
  assert.equal(attack?.assetId, "a-attack");
  assert.equal(identity.portraitUrl, "/api/character-visual/asset/a-portrait?e=1&s=x");
  assert.deepEqual(
    [...identity.missingStates].sort(),
    ["AIM", "DEATH", "DEFEATED", "DODGE", "HIT", "MELEE_ATTACK", "RELOAD", "SHOOT"],
  );
});

test("nome de exibição é independente do id e cai para o da ficha/placeholder", () => {
  const custom = resolveCharacterVisualIdentity(
    { ...emptyCharacterVisualProfile("char-4"), displayName: "  Sombra  " },
    "V",
  );
  assert.equal(custom.displayName, "Sombra");
  assert.equal(custom.characterId, "char-4");

  const fromSheet = resolveCharacterVisualIdentity(emptyCharacterVisualProfile("char-4"), " Jackie ");
  assert.equal(fromSheet.displayName, "Jackie");
  assert.equal(fromSheet.fallbackDisplayName, "Jackie");

  const nothing = resolveCharacterVisualIdentity(emptyCharacterVisualProfile("char-4"), "");
  assert.equal(nothing.displayName, FALLBACK_DISPLAY_NAME);
});
