/**
 * Mesa compartilhada ponta a ponta (modo LOCAL, rotas reais + PostgreSQL real).
 *
 * Exercita exatamente o roteiro do compartilhamento de imagens:
 * A envia a imagem pela rota dono; B, participante da MESMA mesa, lê o
 * manifesto com `sessionId` e carrega o arquivo assinado; B não lê sem
 * `sessionId`, não lê personagem de outra mesa, não escreve a imagem de A, e
 * não cria perfil alheio (anti-sequestro de posse); o dono vinculado consegue
 * fazer o PUSH sincronizado (escrita com `sessionId`); ids adulterados
 * (sessão alheia, uuid malformado) são negados limpo — nunca 5xx.
 *
 * Roda onde existe `MESA_LOCAL_TEST_DATABASE_URL` (CI e validação local);
 * sem ela o teste é pulado, como nos demais testes com banco local.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import test from "node:test";

const databaseUrl = process.env.MESA_LOCAL_TEST_DATABASE_URL;
const postgresTest = databaseUrl ? test : test.skip;

const OWNER = `tok-owner-${randomUUID()}`;
const OBSERVER = `tok-observer-${randomUUID()}`;
const CHARACTER = randomUUID();
const CHARACTER_SQUAT = randomUUID();

function poolConfig(url: string): { host?: string; database?: string; connectionString?: string } {
  const socket = url.match(/^(?:postgres|postgresql):\/\/(?:[^/@]*@)?\/([^?#]+)/);
  return socket
    ? { host: process.env.MESA_LOCAL_PG_SOCKET_DIR || "/var/run/postgresql", database: socket[1] }
    : { connectionString: url };
}

/** PNG mínimo válido (magic bytes + IHDR; 64×64 ≥ mínimo de 32px). */
function pngDataUrl(): string {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 64);
  view.setUint32(20, 64);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${Buffer.from(binary, "binary").toString("base64")}`;
}

postgresTest("mesa compartilhada: A envia, B lê autorizado; IDOR e escrita sincronizada negados", async () => {
  if (!databaseUrl) return;
  process.env.MESA_HOSTING_MODE = "local";
  process.env.MESA_LOCAL_DATABASE_URL = databaseUrl;
  const assetsDir = await mkdtemp(join(tmpdir(), "visual-e2e-assets-"));
  process.env.MESA_ASSETS_DIR = assetsDir;
  const pool = new Pool(poolConfig(databaseUrl));

  const sessionShared = randomUUID();
  const sessionOther = randomUUID();
  const gmShared = randomUUID();
  const gmOther = randomUUID();

  const { GET: visualGet, PUT: visualPut, DELETE: visualDelete } = await import("../src/app/api/character-visual/route.ts");
  const { GET: assetGet } = await import("../src/app/api/character-visual/asset/[assetId]/route.ts");

  const jsonRequest = (method: string, token: string, body?: unknown): Request => new Request("http://localhost/api/character-visual", {
    method,
    headers: { "content-type": "application/json", "x-mesa-token": token },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const getRequest = (query: string, token: string): Request =>
    new Request(`http://localhost/api/character-visual${query}`, { headers: { "x-mesa-token": token } });
  const payloadOf = async (response: Response) => await response.json() as {
    ok?: boolean; code?: string;
    identity?: { portraitUrl?: string | null };
  };

  try {
    await pool.query(
      "insert into public.mesa_sessions (id,name,gm_id,status,join_code) values ($1,'Compartilhada',$2,'active',$3)",
      [sessionShared, gmShared, "SHCOM"],
    );
    await pool.query(
      "insert into public.mesa_sessions (id,name,gm_id,status,join_code) values ($1,'Outra',$2,'active',$3)",
      [sessionOther, gmOther, "OUTRA"],
    );
    // Mesa compartilhada: dono vinculado ao personagem + observador B.
    await pool.query(
      "insert into public.mesa_participants (id,session_id,player_token,display_name,role,character_id) values ($1,$2,$3,'A','player',$4)",
      [gmShared, sessionShared, OWNER, CHARACTER],
    );
    await pool.query(
      "insert into public.mesa_participants (id,session_id,player_token,display_name,role) values ($1,$2,$3,'B','player')",
      [randomUUID(), sessionShared, OBSERVER],
    );
    // Outra mesa: só o B participa; o personagem NÃO está vinculado nela.
    await pool.query(
      "insert into public.mesa_participants (id,session_id,player_token,display_name,role) values ($1,$2,$3,'B','player')",
      [gmOther, sessionOther, OBSERVER],
    );

    // --- A envia a imagem (caminho do dono) --------------------------------
    const saved = await visualPut(jsonRequest("PUT", OWNER, {
      characterId: CHARACTER, slot: "portrait", imageDataUrl: pngDataUrl(),
    }));
    assert.equal(saved.status, 200, JSON.stringify(await payloadOf(saved)));

    // --- B lê o manifesto da mesma mesa e carrega o arquivo ---------------
    const manifest = await visualGet(getRequest(`?characterId=${CHARACTER}&sessionId=${sessionShared}`, OBSERVER));
    const manifestPayload = await payloadOf(manifest);
    assert.equal(manifest.status, 200, JSON.stringify(manifestPayload));
    const portraitUrl = manifestPayload.identity?.portraitUrl;
    assert.ok(portraitUrl, "B não recebeu URL do retrato de A");

    const assetPath = portraitUrl!.match(/^\/api\/character-visual\/asset\/([^?]+)\?(.*)$/);
    assert.ok(assetPath, `URL de asset inesperada: ${portraitUrl}`);
    const asset = await assetGet(
      new Request(`http://localhost/api/character-visual/asset/${assetPath[1]}?${assetPath[2]}`),
      { params: Promise.resolve({ assetId: assetPath[1] }) },
    );
    assert.equal(asset.status, 200, "B não conseguiu carregar o arquivo da imagem de A");
    assert.equal(asset.headers.get("content-type"), "image/png");
    assert.ok((await asset.arrayBuffer()).byteLength > 0);

    // --- B sem sessionId: caminho do dono nega -----------------------------
    const noSession = await visualGet(getRequest(`?characterId=${CHARACTER}`, OBSERVER));
    const noSessionPayload = await payloadOf(noSession);
    assert.equal(noSession.status, 403);
    assert.equal(noSessionPayload.code, "character_owner_mismatch");

    // --- IDOR: B tenta ler o personagem usando a OUTRA mesa ----------------
    const crossMesa = await visualGet(getRequest(`?characterId=${CHARACTER}&sessionId=${sessionOther}`, OBSERVER));
    const crossMesaPayload = await payloadOf(crossMesa);
    assert.equal(crossMesa.status, 403);
    assert.equal(crossMesaPayload.code, "visual_not_in_session");

    // --- sessionId malformado: NEGA limpo (nunca 502 de banco) ------------
    const malformed = await visualGet(getRequest(`?characterId=${CHARACTER}&sessionId=nao-e-uuid`, OBSERVER));
    const malformedPayload = await payloadOf(malformed);
    assert.equal(malformed.status, 403, "id malformado deve negar, não virar erro de infra");
    assert.equal(malformedPayload.code, "visual_not_in_session");

    // --- B tenta ESCREVER a imagem de A com sessionId da mesa -------------
    const writeOther = await visualPut(jsonRequest("PUT", OBSERVER, {
      characterId: CHARACTER, slot: "portrait", imageDataUrl: pngDataUrl(), sessionId: sessionShared,
    }));
    assert.ok(writeOther.status >= 400 && writeOther.status < 500, "escrita do observador deve ser negada");

    // --- B tenta nascer como dono de personagem não vinculado (sequestro) -
    const squat = await visualPut(jsonRequest("PUT", OBSERVER, {
      characterId: CHARACTER_SQUAT, slot: "portrait", imageDataUrl: pngDataUrl(), sessionId: sessionShared,
    }));
    const squatPayload = await payloadOf(squat);
    assert.equal(squat.status, 403, JSON.stringify(squatPayload));
    assert.equal(squatPayload.code, "visual_write_not_linked");
    const squatProfile = await pool.query(
      "select 1 from public.mesa_character_visual_profiles where character_id = $1",
      [CHARACTER_SQUAT],
    );
    assert.equal(squatProfile.rowCount, 0, "não-dono não pode criar perfil para personagem que não vincula");

    // --- A (dono vinculado) faz o PUSH sincronizado -----------------------
    const pushNamed = await visualPut(jsonRequest("PUT", OWNER, {
      characterId: CHARACTER, displayName: "V", sessionId: sessionShared,
    }));
    assert.equal(pushNamed.status, 200, JSON.stringify(await payloadOf(pushNamed)));
    const pushIdle = await visualPut(jsonRequest("PUT", OWNER, {
      characterId: CHARACTER, slot: "combat_state", state: "IDLE", imageDataUrl: pngDataUrl(), sessionId: sessionShared,
    }));
    assert.equal(pushIdle.status, 200, JSON.stringify(await payloadOf(pushIdle)));

    // --- ids adulterados do dono: sessão alheia nega ----------------------
    const foreignSession = await visualPut(jsonRequest("PUT", OWNER, {
      characterId: CHARACTER, slot: "portrait", imageDataUrl: pngDataUrl(), sessionId: sessionOther,
    }));
    assert.ok(foreignSession.status >= 400 && foreignSession.status < 500, "dono de fora da mesa não escreve nela");

    // --- B tenta remover; A remove com sessionId ---------------------------
    const removeByB = await visualDelete(jsonRequest("DELETE", OBSERVER, {
      characterId: CHARACTER, slot: "combat_state", state: "IDLE", sessionId: sessionShared,
    }));
    assert.ok(removeByB.status >= 400 && removeByB.status < 500, "remoção do observador deve ser negada");
    const removeByA = await visualDelete(jsonRequest("DELETE", OWNER, {
      characterId: CHARACTER, slot: "combat_state", state: "IDLE", sessionId: sessionShared,
    }));
    assert.equal(removeByA.status, 200, JSON.stringify(await payloadOf(removeByA)));
    const leftover = await pool.query(
      "select 1 from public.mesa_character_visual_assets where character_id = $1 and kind = 'combat_state'",
      [CHARACTER],
    );
    assert.equal(leftover.rowCount, 0, "remoção sincronizada deve apagar o asset no host");
  } finally {
    await pool.query("delete from public.mesa_character_visual_assets where character_id = any($1)", [[CHARACTER, CHARACTER_SQUAT]]);
    await pool.query("delete from public.mesa_character_visual_profiles where character_id = any($1)", [[CHARACTER, CHARACTER_SQUAT]]);
    await pool.query("delete from public.mesa_sessions where id = any($1)", [[sessionShared, sessionOther]]);
    await pool.end();
    await rm(assetsDir, { recursive: true, force: true });
  }
});
