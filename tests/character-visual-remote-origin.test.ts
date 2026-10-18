/**
 * Mesa em outra origem: roteamento de leitura/escrita e sincronização.
 *
 * O cenário do bug: o jogador personaliza a ficha na própria instância e entra
 * numa Mesa hospedada em OUTRO servidor (membership `serverUrl`). Antes da
 * correção, o cliente visual sempre consultava a origem LOCAL — onde só o
 * caminho do dono (ou um perfil inexistente) resolvia, e os demais
 * participantes nunca viam as imagens.
 *
 * Cobertura:
 * 1. `visualSessionOrigin` segue a MESMA regra de `api()` da Mesa;
 * 2. o manifesto é consultado no host da Mesa (URL absoluta + token no header);
 * 3. as URLs assinadas do manifesto são absolutizadas na origem do host;
 * 4. identidades vazias são revalidadas em janela curta (primeira imagem
 *    aparece sem sair e entrar de novo) e a invalidação refaz a consulta;
 * 5. a sincronização empurra nome + binários ao host, apaga slots removidos e
 *    não vira fallback de IDLE em slot próprio;
 * 6. sem `serverUrl` nada é roteado (Mesa local continua local);
 * 7. a rota entrega CORS (preflight com `x-mesa-token`/PUT) no próprio handler;
 * 8. os ganchos de entrada/vínculo/salvar estão ligados.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// ==== polyfills de navegador (antes de qualquer import dinâmico) ====

const storage = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  },
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => undefined,
};

const HOST = "http://mesa-host.local:3000";
const OTHER_HOST = "http://outro-host.local:3000";
const SESSION = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER_SESSION = "ffffffff-1111-4222-8333-444444444444";
const CHARACTER = "11111111-2222-4333-8444-555555555555";
const TOKEN = "tok-owner-0123456789abcdef";

const TOKEN_KEY = "cyberpunk-red-toolkit:mesa-player:v1";

let seededJoinCodes: string[] = [];

/**
 * Semeia as memberships pela API REAL da store (o snapshot é memoizado por
 * conteúdo bruto e ignora escritas cruas no localStorage — no navegador as
 * mudanças passam por `rememberMembership`/`removeMembership`).
 */
async function seedMemberships(entries: Array<{ joinCode: string; sessionId: string; serverUrl?: string }>): Promise<void> {
  const { rememberMembership, removeMembership } = await import("@/lib/mesa/membershipStore");
  storage.set(TOKEN_KEY, TOKEN);
  for (const code of seededJoinCodes) removeMembership(code);
  seededJoinCodes = [];
  for (const entry of entries) {
    rememberMembership(entry.joinCode, {
      sessionId: entry.sessionId,
      participantId: `p-${entry.sessionId}`,
      displayName: "Jogador",
      role: "player",
      ...(entry.serverUrl ? { serverUrl: entry.serverUrl } : {}),
    });
    seededJoinCodes.push(entry.joinCode);
  }
}

// ==== stub de fetch: registra chamadas e responde pelo roteador ====

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let calls: FetchCall[] = [];
type Responder = (url: string, init: RequestInit | undefined) => Response;
let responder: Responder = () => new Response("sem rota no teste", { status: 500 });

(globalThis as unknown as { fetch: unknown }).fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  const headers: Record<string, string> = {};
  const raw = (init?.headers ?? {}) as Record<string, string>;
  for (const [key, value] of Object.entries(raw)) headers[key.toLowerCase()] = String(value);
  calls.push({
    url,
    method: (init?.method ?? "GET").toUpperCase(),
    headers,
    body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body ?? null,
  });
  return responder(url, init);
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function pngBytes(): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([73, 72, 68, 82], 12);
  return bytes;
}

function identityOf(options: {
  displayName?: string;
  fallbackDisplayName?: string;
  portraitUrl?: string | null;
  portraitAssetId?: string | null;
  configuredStates?: Array<"IDLE" | "ATTACK" | "HIT">;
  ownStateUrls?: Record<string, string | null>;
}): Record<string, unknown> {
  const configured = options.configuredStates ?? [];
  const catalog = ["IDLE", "ATTACK", "HIT"];
  return {
    characterId: CHARACTER,
    displayName: options.displayName ?? "Personagem sem identidade visual",
    fallbackDisplayName: options.fallbackDisplayName ?? "Personagem sem identidade visual",
    portraitUrl: options.portraitUrl ?? null,
    portraitAssetId: options.portraitAssetId ?? null,
    hasIdle: configured.includes("IDLE"),
    configuredStates: configured,
    missingStates: catalog.filter((state) => !configured.includes(state as "IDLE")),
    states: catalog.map((state) => ({
      state,
      label: state,
      url: options.ownStateUrls?.[state] ?? (options.ownStateUrls?.IDLE ?? null),
      assetId: configured.includes(state as "IDLE") ? `asset-${state}` : null,
      source: configured.includes(state as "IDLE")
        ? "state"
        : options.ownStateUrls?.IDLE
          ? "idle-fallback"
          : "generic-fallback",
    })),
    completion: { ready: configured.includes("IDLE"), missingRequired: configured.includes("IDLE") ? [] : ["IDLE"] },
    updatedAt: "2026-11-01T00:00:00.000Z",
  };
}

async function modules() {
  const client = await import("@/lib/characterVisual/visualClient");
  const cache = await import("@/lib/characterVisual/visualManifestCache");
  const sync = await import("@/lib/characterVisual/sessionVisualSync");
  return { client, cache, sync };
}

// ==== 1. origem da sessão ====

test("1. visualSessionOrigin segue a membership (mesma regra de api() da Mesa)", async () => {
  const { client } = await modules();
  await seedMemberships([
    { joinCode: "REM1", sessionId: SESSION, serverUrl: HOST },
    { joinCode: "LOC1", sessionId: OTHER_SESSION },
  ]);
  assert.equal(client.visualSessionOrigin(SESSION), HOST);
  assert.equal(client.visualSessionOrigin(OTHER_SESSION), null);
  assert.equal(client.visualSessionOrigin("sessao-desconhecida"), null);
  assert.equal(client.visualSessionOrigin(undefined), null);
});

// ==== 2. manifesto consultado no host ====

test("2. fetchCharacterVisual com sessionId roteia para o host da Mesa", async () => {
  const { client } = await modules();
  await seedMemberships([{ joinCode: "REM1", sessionId: SESSION, serverUrl: HOST }]);
  calls = [];
  responder = () => json({ ok: true, identity: identityOf({}) });

  await client.fetchCharacterVisual(CHARACTER, { sessionId: SESSION });
  const [call] = calls;
  assert.equal(call.url, `${HOST}/api/character-visual?characterId=${CHARACTER}&sessionId=${SESSION}`);
  assert.equal(call.headers["x-mesa-token"], TOKEN, "token deve ir no header, nunca na URL");
  assert.ok(!call.url.includes(TOKEN), "token não pode aparecer na URL");

  // Sem sessionId continua local (personalização da ficha).
  calls = [];
  await client.fetchCharacterVisual(CHARACTER);
  assert.equal(calls[0].url, `/api/character-visual?characterId=${CHARACTER}`);
});

// ==== 3+4. cache: URLs absolutas, TTL curto de vazio, invalidação ====

test("3. manifesto remoto absolutiza as URLs assinadas no host e a invalidação refaz a consulta", async () => {
  const { cache } = await modules();
  await seedMemberships([{ joinCode: "REM1", sessionId: SESSION, serverUrl: HOST }]);
  cache.resetVisualManifestCache();
  calls = [];
  responder = (url) => {
    if (url.startsWith(`${HOST}/api/character-visual`)) {
      return json({
        ok: true,
        identity: identityOf({
          displayName: "V",
          fallbackDisplayName: "V",
          portraitUrl: "/api/character-visual/asset/p1?e=1&s=abc",
          portraitAssetId: "p1",
          configuredStates: ["IDLE"],
          ownStateUrls: { IDLE: "/api/character-visual/asset/i1?e=1&s=abc" },
        }),
      });
    }
    return new Response("sem rota", { status: 404 });
  };

  const resolved = await cache.ensureVisualManifests([CHARACTER], { sessionId: SESSION });
  const identity = resolved[CHARACTER];
  assert.ok(identity, "manifesto deveria resolver");
  assert.equal(identity.portraitUrl, `${HOST}/api/character-visual/asset/p1?e=1&s=abc`);
  const idleState = identity.states.find((entry) => entry.state === "IDLE");
  assert.ok(idleState, "estado IDLE ausente do manifesto");
  assert.equal(
    idleState.url,
    `${HOST}/api/character-visual/asset/i1?e=1&s=abc`,
    "URL de estado também precisa apontar para o host",
  );
  const fetchCount = calls.length;

  // Cacheado: segunda consulta não consulta de novo.
  await cache.ensureVisualManifests([CHARACTER], { sessionId: SESSION });
  assert.equal(calls.length, fetchCount);

  // Invalidação (após salvar na personalização) força nova consulta ao host.
  cache.invalidateVisualManifest(CHARACTER);
  await cache.ensureVisualManifests([CHARACTER], { sessionId: SESSION });
  assert.equal(calls.length, fetchCount + 1);
});

test("4. manifesto vazio é revalidado em janela curta (primeira imagem sem rejoin)", async () => {
  const { cache } = await modules();
  await seedMemberships([{ joinCode: "REM1", sessionId: SESSION, serverUrl: HOST }]);
  cache.resetVisualManifestCache();
  calls = [];
  let version = 0;
  responder = () => {
    version += 1;
    return json({
      ok: true,
      identity: version === 1
        ? identityOf({})
        : identityOf({
          displayName: "V",
          fallbackDisplayName: "V",
          portraitUrl: "/api/character-visual/asset/p1?e=1&s=abc",
          portraitAssetId: "p1",
          configuredStates: ["IDLE"],
          ownStateUrls: { IDLE: "/api/character-visual/asset/i1?e=1&s=abc" },
        }),
    });
  };

  const t0 = 1_000_000;
  const first = await cache.ensureVisualManifests([CHARACTER], { now: () => t0 });
  assert.equal(first[CHARACTER].portraitAssetId, null);

  // Dentro da janela de vazio (60s): servido do cache.
  const cached = await cache.ensureVisualManifests([CHARACTER], { now: () => t0 + 30_000 });
  assert.equal(cached[CHARACTER].portraitAssetId, null);
  assert.equal(calls.length, 1);

  // Depois da janela: revalida e a primeira imagem aparece — sem sair/entrar.
  const refreshed = await cache.ensureVisualManifests([CHARACTER], { now: () => t0 + 61_000 });
  assert.equal(refreshed[CHARACTER].portraitAssetId, "p1");
  assert.equal(calls.length, 2);
});

// ==== 5. sincronização para o host ====

function hostRoutes(): Responder {
  return (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null;
    if (url === `${HOST}/api/character-visual?characterId=${CHARACTER}&sessionId=${SESSION}`) {
      // Host ainda tem um slot antigo (ATTACK) que foi removido localmente.
      return json({
        ok: true,
        identity: identityOf({
          portraitUrl: "/api/character-visual/asset/old?e=1&s=abc",
          portraitAssetId: "old",
          configuredStates: ["IDLE", "ATTACK"],
          ownStateUrls: {
            IDLE: "/api/character-visual/asset/old-idle?e=1&s=abc",
            ATTACK: "/api/character-visual/asset/old-attack?e=1&s=abc",
          },
        }),
      });
    }
    if (url === `/api/character-visual?characterId=${CHARACTER}`) {
      return json({
        ok: true,
        identity: identityOf({
          displayName: "V",
          fallbackDisplayName: "Personagem sem identidade visual",
          portraitUrl: "/api/character-visual/asset/local-p?e=1&s=abc",
          portraitAssetId: "local-p",
          configuredStates: ["IDLE"],
          ownStateUrls: { IDLE: "/api/character-visual/asset/local-i?e=1&s=abc" },
        }),
      });
    }
    if (url.startsWith("/api/character-visual/asset/")) {
      return new Response(pngBytes().buffer as ArrayBuffer, { status: 200, headers: { "content-type": "image/png" } });
    }
    if (url === `${HOST}/api/character-visual` && (method === "PUT" || method === "DELETE")) {
      assert.ok(typeof body?.sessionId === "string" && body.sessionId === SESSION, "push deve carregar o sessionId");
      return json({ ok: true, identity: identityOf({}) });
    }
    return new Response(`rota não mapeada: ${method} ${url}`, { status: 404 });
  };
}

test("5. sincronização empurra nome+imagens ao host e apaga slot removido localmente", async () => {
  const { sync } = await modules();
  await seedMemberships([{ joinCode: "REM1", sessionId: SESSION, serverUrl: HOST }]);
  calls = [];
  responder = hostRoutes();

  await sync.syncCharacterVisualToSession(CHARACTER, SESSION);

  const mutations = calls.filter((call) => call.method !== "GET");
  const putBodies = mutations.filter((call) => call.method === "PUT").map((call) => call.body as Record<string, unknown>);
  const deleteBodies = mutations.filter((call) => call.method === "DELETE").map((call) => call.body as Record<string, unknown>);

  assert.ok(putBodies.some((body) => body.displayName === "V"), "nome configurado deve ser empurrado");
  const portraitPut = putBodies.find((body) => body.slot === "portrait");
  assert.ok(portraitPut, "retrato deve ser enviado ao host");
  assert.match(String(portraitPut.imageDataUrl), /^data:image\/png;base64,/, "binário baixado do storage local como data URL");
  assert.ok(putBodies.some((body) => body.slot === "combat_state" && body.state === "IDLE"), "IDLE própria é empurrada");
  assert.ok(
    !putBodies.some((body) => body.slot === "combat_state" && body.state === "HIT"),
    "estado que só cai no fallback de IDLE NÃO vira slot próprio no host",
  );
  assert.ok(
    deleteBodies.some((body) => body.slot === "combat_state" && body.state === "ATTACK"),
    "slot que só existe no host (removido localmente) é apagado",
  );
});

test("5b. sincronização aborta em silêncio quando o host recusa a leitura", async () => {
  const { sync } = await modules();
  await seedMemberships([{ joinCode: "REM1", sessionId: SESSION, serverUrl: HOST }]);
  calls = [];
  responder = (url) => {
    if (url.startsWith(`${HOST}/api/character-visual`)) {
      return json({ ok: false, error: "Sem vínculo.", code: "visual_not_in_session" }, 403);
    }
    if (url === `/api/character-visual?characterId=${CHARACTER}`) {
      return json({
        ok: true,
        identity: identityOf({
          displayName: "V",
          fallbackDisplayName: "V",
          portraitUrl: "/api/character-visual/asset/local-p?e=1&s=abc",
          portraitAssetId: "local-p",
        }),
      });
    }
    return new Response("sem rota", { status: 404 });
  };
  await sync.syncCharacterVisualToSession(CHARACTER, SESSION);
  assert.equal(calls.filter((call) => call.method !== "GET").length, 0, "nenhuma escrita após recusa do host");
});

test("5c. Mesa na própria origem não gera tráfego de sincronização", async () => {
  const { sync } = await modules();
  await seedMemberships([{ joinCode: "LOC1", sessionId: SESSION }]);
  calls = [];
  responder = hostRoutes();
  await sync.syncCharacterVisualToSession(CHARACTER, SESSION);
  assert.equal(calls.length, 0);
});

test("5d. maybeSync só fala com Mesas remotas onde o personagem está vinculado", async () => {
  const { sync } = await modules();
  await seedMemberships([
    { joinCode: "REM1", sessionId: SESSION, serverUrl: HOST },
    { joinCode: "REM2", sessionId: OTHER_SESSION, serverUrl: OTHER_HOST },
  ]);
  calls = [];
  responder = (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (url === `${HOST}/api/mesa/${SESSION}`) {
      return json({
        ok: true,
        state: { viewer: { participantId: `p-${SESSION}` }, participants: [{ id: `p-${SESSION}`, characterId: CHARACTER }] },
      });
    }
    if (url === `${OTHER_HOST}/api/mesa/${OTHER_SESSION}`) {
      return json({
        ok: true,
        state: { viewer: { participantId: `p-${OTHER_SESSION}` }, participants: [{ id: `p-${OTHER_SESSION}`, characterId: null }] },
      });
    }
    if (url.startsWith(`${HOST}/`)) return hostRoutes()(url, init);
    if (method === "GET") {
      return json({
        ok: true,
        identity: identityOf({
          displayName: "V",
          fallbackDisplayName: "V",
          portraitUrl: "/api/character-visual/asset/local-p?e=1&s=abc",
          portraitAssetId: "local-p",
        }),
      });
    }
    return new Response(`escrita inesperada em ${url}`, { status: 500 });
  };

  await sync.maybeSyncCharacterVisualToSessions(CHARACTER);

  assert.ok(calls.some((call) => call.url.startsWith(HOST) && call.method === "PUT"), "mesa vinculada recebe a sincronização");
  assert.ok(
    !calls.some((call) => call.url.startsWith(OTHER_HOST) && call.method !== "GET"),
    "mesa sem vínculo não recebe escrita alguma",
  );
});

// ==== 6. Mesa local: nada roteado ====

test("6. sem serverUrl nenhuma requisição visual sai da origem local", async () => {
  const { client, cache } = await modules();
  await seedMemberships([{ joinCode: "LOC1", sessionId: SESSION }]);
  cache.resetVisualManifestCache();
  calls = [];
  responder = () => json({ ok: true, identity: identityOf({}) });
  await client.fetchCharacterVisual(CHARACTER, { sessionId: SESSION });
  await cache.ensureVisualManifests([CHARACTER], { sessionId: SESSION });
  assert.ok(calls.every((call) => !call.url.startsWith("http")), "nenhuma chamada absoluta para host externo");
});

// ==== 7. CORS na própria rota visual ====

test("7. OPTIONS da rota visual entrega CORS (preflight com x-mesa-token e PUT)", async () => {
  const route = await import("../src/app/api/character-visual/route.ts");
  const response = route.OPTIONS();
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.ok(String(response.headers.get("access-control-allow-methods")).includes("PUT"));
  assert.ok(String(response.headers.get("access-control-allow-headers")).includes("x-mesa-token"));
});

// ==== 8. ganchos de entrada/vínculo/salvar ligados ====

test("8. vínculo, auto-link e tela de personalização disparam a sincronização", async () => {
  const clientSource = await readFile(new URL("../src/lib/mesa/client.ts", import.meta.url), "utf8");
  const linkBlock = clientSource.slice(clientSource.indexOf("export async function linkCharacter"), clientSource.indexOf("export async function leaveMesa"));
  assert.ok(linkBlock.includes("syncCharacterVisualToSession(characterId, sessionId)"), "linkCharacter deve sincronizar a identidade");

  const autoLink = await readFile(new URL("../src/lib/mesa/useAutoLinkCharacter.ts", import.meta.url), "utf8");
  const syncIndex = autoLink.indexOf("syncCharacterVisualToSession");
  const guardIndex = autoLink.indexOf('state.combat?.status === "active" && state.combat.initiativeStarted');
  assert.ok(syncIndex > 0 && syncIndex < guardIndex, "sincronização visual deve rodar antes dos guards de combate da ficha");

  const customizer = await readFile(new URL("../src/components/character/CharacterVisualCustomizer.tsx", import.meta.url), "utf8");
  const invalidateIndex = customizer.indexOf("invalidateVisualManifest(characterId)");
  const maybeSyncIndex = customizer.indexOf("maybeSyncCharacterVisualToSessions(characterId)");
  assert.ok(invalidateIndex > 0 && maybeSyncIndex > invalidateIndex, "salvar na personalização deve empurrar para as Mesas remotas");

  const routeSource = await readFile(new URL("../src/app/api/character-visual/route.ts", import.meta.url), "utf8");
  assert.equal(
    (routeSource.match(/sessionId: body\.sessionId/g) ?? []).length,
    3,
    "PUT (nome e imagem) e DELETE da rota devem repassar o sessionId do push",
  );
});
