/**
 * F1.12.6 — **Direct Join** (`/mesa/<CODE>` → `/mesa/<uuid>`).
 *
 * Cobre as duas metades da etapa:
 *
 *  **A) Regras puras** (`mesaRoute.ts`) — o desempate do segmento da rota e as
 *     mensagens de falha, sem DOM, sem rede e sem banco.
 *
 *  **B) Contrato REAL do join** contra Postgres/HTTP — as promessas do caminho
 *     `/mesa/<CODE>` → `POST /api/mesa/join` → `GET /api/mesa/<sessionId>`:
 *
 *   1. código válido resolve a sessão e devolve o `sessionId` (o destino do
 *      redirect) com o participante do MESMO token;
 *   2. o token/participante é preservado: repetir o join NÃO cria participante
 *      novo (o redirect não pode "trocar" de jogador no caminho);
 *   3. o uuid devolvido autoriza a leitura do estado (`viewer.participantId`),
 *      ou seja o reload do destino do redirect funciona;
 *   4. código inexistente → 404 `session_not_found`;
 *   5. sessão encerrada → 410 `session_finished`;
 *   6. código malformado → 400 `invalid_join_code`;
 *   7. token ausente/inválido → 401 `missing_token`;
 *   8. display name inválido → 400 `invalid_display_name`;
 *   9. o cliente nunca escolhe o destino: `/mesa/<CODE>` e `/mesa/<sessionId>`
 *      são resolvidos por regras puras, não pelo servidor responder outra coisa.
 *
 * Ambiente sem SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY: a parte (B) é skipped.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  describeJoinFailure,
  hasMesaMembership,
  isMesaSessionId,
  playerMesaHref,
  resolveMesaRoute,
} from "../src/lib/mesa/mesaRoute.ts";

try {
  process.loadEnvFile(".env");
} catch {
  // CI sem secrets executa os testes locais, mas marca a parte (B) como skip.
}

const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const db: SupabaseClient | null = configured
  ? createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  : null;
const postgresTest = configured ? test : test.skip;

// ===========================================================================
// (A) Regras puras do endereço da Mesa
// ===========================================================================

const SESSION_UUID = "0d6f2b3a-1c4d-4e5f-8a9b-0c1d2e3f4a5b";

test("resolveMesaRoute: uuid de sessão vai para a tela do Player", () => {
  assert.deepEqual(resolveMesaRoute(SESSION_UUID), { kind: "session", sessionId: SESSION_UUID });
  assert.deepEqual(resolveMesaRoute(SESSION_UUID.toUpperCase()), { kind: "session", sessionId: SESSION_UUID.toUpperCase() });
  assert.deepEqual(resolveMesaRoute(`  ${SESSION_UUID}  `), { kind: "session", sessionId: SESSION_UUID });
});

test("resolveMesaRoute: código de convite normalizado vira entrada direta", () => {
  assert.deepEqual(resolveMesaRoute("8F4K2"), { kind: "invite", joinCode: "8F4K2" });
  assert.deepEqual(resolveMesaRoute("8f4k2"), { kind: "invite", joinCode: "8F4K2" }, "minúsculas são normalizadas");
  assert.deepEqual(resolveMesaRoute(" ab3d9 "), { kind: "invite", joinCode: "AB3D9" }, "espaço em volta é aparado");
});

test("resolveMesaRoute: código e uuid nunca se confundem (5 caracteres vs 36)", () => {
  // Um código de entrada é curto demais e um uuid é longo demais: a ordem das
  // regras é irrelevante, o que mantém o desempate seguro.
  assert.equal(resolveMesaRoute(SESSION_UUID).kind, "session");
  assert.equal(resolveMesaRoute("8F4K2").kind, "invite");
});

test("resolveMesaRoute: segmento inválido é erro explícito, nunca silêncio", () => {
  for (const segment of ["", "   ", "8F4K", "8F4K22", "8F4K-", "not-a-code", "../../etc/passwd", "8F4K2/../x"]) {
    const target = resolveMesaRoute(segment);
    assert.equal(target.kind, "invalid", `esperado inválido: ${JSON.stringify(segment)}`);
  }
  assert.deepEqual(resolveMesaRoute(undefined), { kind: "invalid", segment: "" });
  assert.deepEqual(resolveMesaRoute(null), { kind: "invalid", segment: "" });
  assert.deepEqual(resolveMesaRoute(42), { kind: "invalid", segment: "" });
  // Não existe sessão nem convite "inventado" a partir de lixo.
  const invalid = resolveMesaRoute("lixo");
  assert.equal(invalid.kind === "session" || invalid.kind === "invite", false);
});

test("isMesaSessionId: só aceita uuid de sessão", () => {
  assert.equal(isMesaSessionId(SESSION_UUID), true);
  assert.equal(isMesaSessionId("8F4K2"), false);
  assert.equal(isMesaSessionId("0d6f2b3a1c4d4e5f8a9b0c1d2e3f4a5b"), false, "sem hífens não é uuid");
  assert.equal(isMesaSessionId("0d6f2b3a-1c4d-9e5f-8a9b-0c1d2e3f4a5b"), false, "versão 9 não é válida");
  assert.equal(isMesaSessionId("0d6f2b3a-1c4d-4e5f-1a9b-0c1d2e3f4a5b"), false, "variante fora da RFC 4122");
  assert.equal(isMesaSessionId(null), false);
  assert.equal(isMesaSessionId(undefined), false);
});

test("playerMesaHref: o redirect aponta para a rota da sessão, com uuid cru", () => {
  assert.equal(playerMesaHref(SESSION_UUID), `/mesa/${SESSION_UUID}`);
  // O destino do redirect só é confiável quando o par guarda-corpo + href é
  // usado junto: um código de convite NUNCA vira href de sessão, senão o
  // jogador cairia de novo no convite e o redirect viraria laço.
  assert.equal(resolveMesaRoute(playerMesaHref(SESSION_UUID).slice("/mesa/".length)).kind, "session");
  assert.equal(isMesaSessionId("8F4K2"), false, "código de convite não passa pelo guarda-corpo do href");
});

test("hasMesaMembership: a assinatura local é o que dispensa o join", () => {
  const entries = { "8F4K2": { sessionId: SESSION_UUID } };
  assert.equal(hasMesaMembership({ entries }, "8F4K2"), true, "reload do convite: já é membro, vai direto");
  assert.equal(hasMesaMembership({ entries }, "8f4k2"), true, "a chave é normalizada");
  assert.equal(hasMesaMembership({ entries }, "ZZZ99"), false, "nunca entrou nesta mesa: precisa do join");
  assert.equal(hasMesaMembership({ entries: {} }, "8F4K2"), false);
});

test("describeJoinFailure: cada recusa do servidor vira mensagem acionável", () => {
  const cases: Array<[string, string]> = [
    ["invalid_join_code", "Código de mesa inválido"],
    ["session_not_found", "Mesa não encontrada"],
    ["session_finished", "Esta Mesa foi encerrada"],
    ["invalid_display_name", "Nome inválido"],
    ["missing_token", "Identidade do navegador indisponível"],
    ["storage_unavailable", "Assinatura da Mesa não guardada"],
  ];
  for (const [code, title] of cases) {
    const described = describeJoinFailure(code);
    assert.equal(described.title, title, `code ${code}`);
    assert.ok(described.hint.length > 0, `code ${code} precisa de uma dica`);
  }
});

test("describeJoinFailure: erro desconhecido nunca some nem promete sucesso", () => {
  for (const code of [null, undefined, "", "network_hiccup", "boom"]) {
    const described = describeJoinFailure(code);
    assert.ok(described.title.length > 0, `${code} precisa de título`);
    assert.ok(described.hint.length > 0, `${code} precisa de dica`);
    assert.equal(/sucesso|entrou|conectado/i.test(described.title), false, "nada prometeu que deu certo por engano");
  }
});

// ===========================================================================
// (B) Contrato real do join contra Postgres/HTTP
// ===========================================================================

const sessionId = randomUUID();
const finishedSessionId = randomUUID();
const joinCode = sessionId.replace(/-/g, "").slice(0, 5).toUpperCase();
const finishedJoinCode = finishedSessionId.replace(/-/g, "").slice(0, 5).toUpperCase();
const gmParticipantId = randomUUID();
const playerToken = `player-${randomUUID()}-direct-join`;

interface JoinPayload {
  ok?: boolean;
  code?: string;
  error?: string;
  session?: { id: string; joinCode: string; status: string };
  participant?: { id: string; displayName: string; role: string };
}

async function postJoin(body: Record<string, unknown>, token?: string): Promise<{ status: number; payload: JoinPayload }> {
  const { POST } = await import("../src/app/api/mesa/join/route.ts");
  const request = new Request("http://localhost/api/mesa/join", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { "x-mesa-token": token } : {}),
    },
    body: JSON.stringify(body),
  });
  const response = await POST(request);
  return { status: response.status, payload: (await response.json()) as JoinPayload };
}

async function getState(session: string, token: string): Promise<{ status: number; payload: Record<string, unknown> }> {
  const { GET } = await import("../src/app/api/mesa/[id]/route.ts");
  const request = new Request(`http://localhost/api/mesa/${session}`, { headers: { "x-mesa-token": token } });
  const response = await GET(request, { params: Promise.resolve({ id: session }) });
  return { status: response.status, payload: (await response.json()) as Record<string, unknown> };
}

postgresTest("Direct Join: /mesa/<CODE> resolve a sessão e entrega o uuid do redirect", async () => {
  const { error: sessionError } = await db!.from("mesa_sessions").insert({
    id: sessionId,
    name: "E2E Direct Join",
    gm_id: gmParticipantId,
    status: "active",
    join_code: joinCode,
  });
  assert.ifError(sessionError);

  const { error: gmError } = await db!.from("mesa_participants").insert({
    id: gmParticipantId,
    session_id: sessionId,
    player_token: `gm-${randomUUID()}-token`,
    display_name: "JOIN GM",
    character_id: null,
    role: "gm",
  });
  assert.ifError(gmError);

  /* 1. código válido resolve a sessão ------------------------------------- */
  const first = await postJoin({ joinCode, displayName: "Zuberi" }, playerToken);
  assert.equal(first.status, 200, JSON.stringify(first.payload));
  assert.equal(first.payload.ok, true);
  assert.equal(first.payload.session?.id, sessionId, "o uuid devolvido é o destino do redirect");
  assert.equal(first.payload.session?.joinCode, joinCode);
  assert.equal(first.payload.session?.status, "active");
  assert.equal(isMesaSessionId(first.payload.session?.id), true, "o destino do redirect é endereçável");
  assert.equal(resolveMesaRoute(first.payload.session?.id).kind, "session");
  assert.equal(resolveMesaRoute(first.payload.session?.joinCode).kind, "invite");
  assert.equal(first.payload.participant?.role, "player");
  assert.equal(first.payload.participant?.displayName, "Zuberi");
  const participantId = first.payload.participant?.id;
  assert.ok(participantId, "o join devolve o participante");

  /* 2. token/participante preservados (idempotente) ------------------------ */
  const second = await postJoin({ joinCode, displayName: "Zuberi" }, playerToken);
  assert.equal(second.status, 200, JSON.stringify(second.payload));
  assert.equal(second.payload.participant?.id, participantId, "repetir o join NÃO troca de participante");
  assert.equal(second.payload.session?.id, sessionId, "o mesmo destino de redirect");

  const { count } = await db!
    .from("mesa_participants")
    .select("*", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .eq("player_token", playerToken);
  assert.equal(count, 1, "uma linha de participante por token, mesmo com o convite aberto várias vezes");

  /* 3. o uuid do redirect autoriza a leitura do estado --------------------- */
  const viewer = await getState(sessionId, playerToken);
  assert.equal(viewer.status, 200, "GET /api/mesa/<sessionId> com o mesmo token — o reload do destino funciona");
  const state = viewer.payload.state as { session: { id: string }; viewer: { participantId: string; role: string } };
  assert.equal(state.session.id, sessionId);
  assert.equal(state.viewer.participantId, participantId, "a tela /mesa/<uuid> reconhece quem entrou pelo convite");
  assert.equal(state.viewer.role, "player");

  /* 9. o cliente não escolhe o destino: o servidor devolve o uuid real ----- */
  const forged = await postJoin({ joinCode, displayName: "Zuberi", sessionId: randomUUID() }, playerToken);
  assert.equal(forged.payload.session?.id, sessionId, "sessionId enviado pelo cliente é ignorado");
});

postgresTest("Direct Join: recusas preservam o motivo e nunca inventam uma Mesa", async () => {
  const { error: sessionError } = await db!.from("mesa_sessions").insert({
    id: finishedSessionId,
    name: "E2E Direct Join encerrada",
    gm_id: gmParticipantId,
    status: "finished",
    join_code: finishedJoinCode,
  });
  assert.ifError(sessionError);

  /* 4. código inexistente → 404 ------------------------------------------- */
  const missing = await postJoin({ joinCode: "ZZZ99", displayName: "Zuberi" }, playerToken);
  assert.equal(missing.status, 404);
  assert.equal(missing.payload.code, "session_not_found");
  assert.equal(missing.payload.session, undefined, "sem sessão, sem redirect possível");

  /* 5. sessão encerrada → 410 -------------------------------------------- */
  const finished = await postJoin({ joinCode: finishedJoinCode, displayName: "Zuberi" }, playerToken);
  assert.equal(finished.status, 410);
  assert.equal(finished.payload.code, "session_finished");
  assert.equal(finished.payload.session, undefined);
  const describedFinished = describeJoinFailure(finished.payload.code);
  assert.equal(describedFinished.title, "Esta Mesa foi encerrada");

  /* 6. código malformado → 400 (o servidor normaliza, igual o cliente) ----- */
  for (const bad of ["8F4K", "8F4K22", "8F4K-", ""]) {
    const malformed = await postJoin({ joinCode: bad, displayName: "Zuberi" }, playerToken);
    assert.equal(malformed.status, 400, `código ${JSON.stringify(bad)}`);
    assert.equal(malformed.payload.code, "invalid_join_code");
  }

  /* 7. token ausente/inválido → 401 (sem identidade não há participante) -- */
  const noToken = await postJoin({ joinCode, displayName: "Zuberi" });
  assert.equal(noToken.status, 401);
  assert.equal(noToken.payload.code, "missing_token");
  const shortToken = await postJoin({ joinCode, displayName: "Zuberi" }, "curto");
  assert.equal(shortToken.status, 401);
  assert.equal(shortToken.payload.code, "missing_token");

  /* 8. nome de exibição inválido → 400 ----------------------------------- */
  for (const name of ["", "   ", "x".repeat(41), 42, null]) {
    const badName = await postJoin({ joinCode, displayName: name }, playerToken);
    assert.equal(badName.status, 400, `nome ${JSON.stringify(name)}`);
    assert.equal(badName.payload.code, "invalid_display_name");
  }
});
