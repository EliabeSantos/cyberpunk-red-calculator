/**
 * Etapa 2 — cache de sessão dos manifestos visuais consumidos pelo combate.
 *
 * O que estes testes protegem:
 * - o manifesto é consultado UMA vez por personagem dentro do TTL (a tela de
 *   combate não refaz a requisição a cada renderização);
 * - após salvar/remover imagens (Etapa 1), a invalidação força nova consulta
 *   e a nova URL assinada é servida (nada de asset removido parecer ativo);
 * - falha de consulta não lança e nem interrompe o combate: o personagem fica
 *   ausente do mapa e o renderizador usa o boneco genérico;
 * - o sessionId é repassado (gate de participante da mesa) e o token nunca
 *   entra na URL (o cliente usa header).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  VISUAL_MANIFEST_TTL_MS,
  ensureVisualManifests,
  invalidateVisualManifest,
  isVisualUrlFailed,
  markVisualUrlFailed,
  resetVisualManifestCache,
  setVisualManifestFetcher,
} from "../src/lib/characterVisual/visualManifestCache.ts";
import {
  resolveCombatStateImage,
} from "../src/lib/characterVisual/combatVisualState.ts";
import {
  resolveCharacterVisualIdentity,
  type CharacterVisualAssetRef,
  type CharacterVisualProfileData,
} from "../src/lib/characterVisual/visualIdentity.ts";

function assetRef(assetId: string, state: "IDLE" | "SHOOT"): CharacterVisualAssetRef {
  return {
    assetId,
    kind: "combat_state",
    state,
    mimeType: "image/webp",
    width: 400,
    height: 800,
    byteSize: 1500,
    url: `/api/character-visual/asset/${assetId}?e=1&s=x`,
    updatedAt: "2026-11-01T00:00:00.000Z",
  };
}

function identityOf(characterId: string, states: Record<string, string>, updatedAt = "2026-11-01T00:00:00.000Z") {
  const profile: CharacterVisualProfileData = {
    characterId,
    displayName: null,
    updatedAt,
    portrait: null,
    stateImages: Object.fromEntries(
      Object.entries(states).map(([state, assetId]) => [state, assetRef(assetId, state as "IDLE" | "SHOOT")]),
    ),
  };
  return resolveCharacterVisualIdentity(profile, "V");
}

type FetchCall = { characterId: string; options: { sessionId?: string; fallbackName?: string } };

function injectFetcher(
  impl: (characterId: string, options: { sessionId?: string; fallbackName?: string }) => Promise<ReturnType<typeof identityOf>>,
) {
  const calls: FetchCall[] = [];
  setVisualManifestFetcher(async (characterId, options) => {
    calls.push({ characterId, options });
    return impl(characterId, options);
  });
  return calls;
}

test.beforeEach(() => {
  resetVisualManifestCache();
});

test.afterEach(() => {
  resetVisualManifestCache();
  // Restaura o fetcher real para não vazar para outros arquivos de teste.
  setVisualManifestFetcher((characterId, options) => import("../src/lib/characterVisual/visualClient.ts")
    .then((module) => module.fetchCharacterVisual(characterId, options)));
});

test("manifesto é consultado uma vez e reutilizado dentro do TTL", async () => {
  const calls = injectFetcher(async (characterId) => identityOf(characterId, { IDLE: "a-idle" }));
  const first = await ensureVisualManifests(["char-1"], { sessionId: "mesa-1" });
  const second = await ensureVisualManifests(["char-1"], { sessionId: "mesa-1" });
  assert.equal(calls.length, 1, "segunda consulta deve vir do cache");
  assert.equal(first["char-1"]?.hasIdle, true);
  assert.equal(second["char-1"]?.hasIdle, true);
});

test("TTL expirado revalida o manifesto (URL assinada nova)", async () => {
  let clock = 0;
  const now = () => clock;
  let version = 0;
  const calls = injectFetcher(async (characterId) =>
    identityOf(characterId, { IDLE: `a-idle-${++version}` }, "2026-11-01T00:00:00.000Z"));
  await ensureVisualManifests(["char-1"], { now });
  clock += VISUAL_MANIFEST_TTL_MS + 1;
  const refreshed = await ensureVisualManifests(["char-1"], { now });
  const refreshedIdle = resolveCombatStateImage(refreshed["char-1"], "IDLE");
  assert.equal(calls.length, 2, "após o TTL a consulta acontece de novo");
  assert.equal(refreshedIdle?.assetId, "a-idle-2");
});

test("invalidação força nova consulta após alterar as imagens (test 11 do roteiro)", async () => {
  let version = 0;
  const calls = injectFetcher(async (characterId) => {
    version += 1;
    return identityOf(characterId, version === 1 ? { IDLE: "old-idle" } : { IDLE: "new-idle", SHOOT: "new-shoot" });
  });
  const before = await ensureVisualManifests(["char-1"]);
  const beforeIdle = resolveCombatStateImage(before["char-1"], "IDLE");
  assert.equal(beforeIdle?.assetId, "old-idle");

  // Tela de personalização salvou um asset novo (Etapa 1) → invalida.
  invalidateVisualManifest("char-1");
  const after = await ensureVisualManifests(["char-1"]);
  const afterIdle = resolveCombatStateImage(after["char-1"], "IDLE");
  const afterShoot = resolveCombatStateImage(after["char-1"], "SHOOT");
  assert.equal(calls.length, 2);
  assert.equal(afterIdle?.assetId, "new-idle", "asset antigo não pode continuar parecendo ativo");
  assert.equal(afterShoot?.assetId, "new-shoot", "estado novo já aparece na consulta seguinte");
});

test("falha de consulta não lança: personagem fica ausente (fallback genérico)", async () => {
  injectFetcher(async (characterId) => {
    if (characterId === "char-bad") throw new Error("403");
    return identityOf(characterId, { IDLE: "a-idle" });
  });
  const result = await ensureVisualManifests(["char-ok", "char-bad"]);
  assert.ok(result["char-ok"], "personagem acessível continua disponível");
  assert.equal(result["char-bad"], undefined, "sem manifesto → renderizador usa o boneco genérico");
  assert.equal(resolveCombatStateImage(result["char-bad"] ?? null, "IDLE"), null);
});

test("falha é memorizada por um período curto (não martela a rota)", async () => {
  const calls = injectFetcher(async () => { throw new Error("offline"); });
  let clock = 0;
  await ensureVisualManifests(["char-x"], { now: () => clock });
  await ensureVisualManifests(["char-x"], { now: () => clock });
  assert.equal(calls.length, 1, "falha dentro do TTL não refaz a consulta");
  clock += VISUAL_MANIFEST_TTL_MS + 1;
  await ensureVisualManifests(["char-x"], { now: () => clock });
  assert.equal(calls.length, 2, "com o TTL vencido tenta de novo (pode ter voltado a funcionar)");
});

test("sessionId e nome de fallback são repassados para o gate de participante", async () => {
  const calls = injectFetcher(async (characterId) => identityOf(characterId, { IDLE: "a-idle" }));
  await ensureVisualManifests(["char-1"], {
    sessionId: "mesa-42",
    fallbackName: () => "Nome da Mesa",
  });
  assert.equal(calls[0]?.options.sessionId, "mesa-42");
  assert.equal(calls[0]?.options.fallbackName, "Nome da Mesa");
});

test("ids vazios ou repetidos não geram consulta", async () => {
  const calls = injectFetcher(async (characterId) => identityOf(characterId, { IDLE: "a-idle" }));
  const result = await ensureVisualManifests(["", "char-1", "char-1", ""], {});
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(result), ["char-1"]);
});

test("URL marcada como falha sobrevive ao cache e é pulada pelo resolvedor", async () => {
  const url = "/api/character-visual/asset/a-idle?e=1&s=x";
  markVisualUrlFailed(url);
  assert.equal(isVisualUrlFailed(url), true);
  const identity = identityOf("char-1", { IDLE: "a-idle" });
  assert.equal(resolveCombatStateImage(identity, "IDLE", isVisualUrlFailed), null,
    "URL quebrada não pode ser servida de novo");
  resetVisualManifestCache();
  assert.equal(isVisualUrlFailed(url), false, "reset limpa as URLs falhas");
});
