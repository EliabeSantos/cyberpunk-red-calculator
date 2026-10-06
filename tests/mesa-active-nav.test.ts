/**
 * F1.12.7 — **Player Mesa Navigation**: o que o botão "Mesa" faz quando há
 * (ou não) uma Mesa ativa.
 *
 * Prova os critérios de aceitação da etapa:
 *
 *   • membership de JOGADOR apontando para sessão viva  → `navigate` para
 *     `/mesa/<uuid>` (e aí o modal NÃO é aberto: `MesaEntry` só chama
 *     `setPanel("home")` para as decisões que não são `navigate`);
 *   • membership stale/encerrado                        → `stale`, limpo com a
 *     infraestrutura existente (`removeMembership`), NUNCA um redirect inválido;
 *   • falha de rede                                     → `entry` sem apagar o
 *     vínculo (mesma regra do `MesaRoomDock`);
 *   • sem membership / entrada corrompida               → `entry` (fluxo de
 *     entrada/seleção/criação intacto);
 *   • Mestre                                             → `navigate` para a
 *     mesma tela dedicada, com os controles derivados do papel;
 *   • `/mesa/<CODE>` e `/mesa/<uuid>`                    → intocados (F1.12.6).
 *
 * O `window` mínimo abaixo é o mesmo truque do `mesa-membership-store`: o store
 * checa `typeof window` antes de tocar em qualquer coisa, então um `localStorage`
 * em Map basta. `fetch` é substituído pelo resumo das respostas REAIS de
 * `GET /api/mesa/[id]` — nada de banco nesta parte.
 */
import assert from "node:assert/strict";
import test from "node:test";

const storage = new Map<string, string>();
const listeners = new Set<() => void>();

(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  },
  addEventListener: (_type: string, listener: () => void) => void listeners.add(listener),
  removeEventListener: (_type: string, listener: () => void) => void listeners.delete(listener),
  dispatchEvent: () => {
    for (const listener of listeners) listener();
    return true;
  },
};

const { getMembershipSnapshot, rememberMembership, removeMembership } = await import(
  "../src/lib/mesa/membershipStore.ts"
);
const {
  activeMesaCandidate,
  livenessFromError,
  livenessFromState,
  navigatesToPlayerScreen,
  resolveActiveMesa,
} = await import("../src/lib/mesa/activeMesa.ts");
const { MesaApiError } = await import("../src/lib/mesa/client.ts");
const { resolveMesaRoute } = await import("../src/lib/mesa/mesaRoute.ts");

// ---------------------------------------------------------------------------
// Cenário: um jogador já conectado, cuja sessão o servidor confirma ou não.
// ---------------------------------------------------------------------------

const SESSION_ID = "0d6f2b3a-1c4d-4e5f-8a9b-0c1d2e3f4a5b";
const JOIN_CODE = "8F4K2";

type Mode = "active" | "finished-state" | "not-found" | "finished-error" | "not-participant" | "network";
let mode: Mode = "active";
let fetchCalls = 0;
const seenUrls: string[] = [];

/**
 * Mesmas formas de `GET /api/mesa/[id]` (rota real): 200 `{ ok, state }` ou
 * erro `{ ok:false, error, code }` com o status do `MesaError`.
 */
globalThis.fetch = (async (input: unknown) => {
  fetchCalls += 1;
  seenUrls.push(String(input));
  switch (mode) {
    case "network":
      throw new TypeError("fetch failed");
    case "not-found":
      return Response.json(
        { ok: false, error: "Mesa não encontrada com este código.", code: "session_not_found" },
        { status: 404 },
      );
    case "finished-error":
      return Response.json({ ok: false, error: "Esta sessão foi encerrada.", code: "session_finished" }, { status: 410 });
    case "not-participant":
      return Response.json({ ok: false, error: "Você não está nesta Mesa.", code: "not_participant" }, { status: 403 });
    case "finished-state":
      return Response.json(
        { ok: true, state: { session: { id: SESSION_ID, joinCode: JOIN_CODE, status: "finished" } } },
        { status: 200 },
      );
    default:
      return Response.json(
        { ok: true, state: { session: { id: SESSION_ID, joinCode: JOIN_CODE, status: "active" } } },
        { status: 200 },
      );
  }
}) as typeof fetch;

function connect(role: "player" | "gm", sessionId = SESSION_ID): void {
  removeMembership(JOIN_CODE);
  rememberMembership(JOIN_CODE, {
    sessionId,
    participantId: "part-1",
    displayName: "Zuberi",
    role,
  });
  fetchCalls = 0;
  seenUrls.length = 0;
}

const hasMembership = (code: string): boolean => Boolean(getMembershipSnapshot().entries[code]);

// ===========================================================================
// (A) A candidata a "Mesa ativa" vem do membership de sempre
// ===========================================================================

test("sem assinatura não há candidata: o botão entra pelo fluxo atual", () => {
  removeMembership(JOIN_CODE);
  assert.equal(activeMesaCandidate(getMembershipSnapshot()), null);
});

test("assinatura de jogador com uuid válido É a candidata", () => {
  connect("player");
  assert.deepEqual(activeMesaCandidate(getMembershipSnapshot()), {
    joinCode: JOIN_CODE,
    sessionId: SESSION_ID,
    role: "player",
  });
});

test("activeJoinCode apontando para entrada que não existe não é candidata", () => {
  removeMembership(JOIN_CODE);
  // activeJoinCode foi para uma entrada removida à mão: nada a redirecionar.
  const snapshot = { activeJoinCode: "ZZZ99", entries: getMembershipSnapshot().entries };
  assert.equal(activeMesaCandidate(snapshot), null);
});

test("entrada corrompida (sessionId fora de uuid) não vira redirect", async () => {
  connect("player", "sessao-que-nao-e-uuid");
  assert.equal(activeMesaCandidate(getMembershipSnapshot()), null, "sem candidata sem navegação");
  const decision = await resolveActiveMesa();
  assert.equal(decision.kind, "entry");
  assert.equal(hasMembership(JOIN_CODE), true, "entradas ilegíveis são do fluxo de entrada, não desta etapa");
});

// ===========================================================================
// (B) Qualquer participante vai para /mesa/[uuid]
// ===========================================================================

test("o Mestre também é levado para a tela dedicada e confirma a sessão", async () => {
  connect("gm");
  assert.equal(navigatesToPlayerScreen({ joinCode: JOIN_CODE, sessionId: SESSION_ID, role: "gm" }), true);
  assert.equal(navigatesToPlayerScreen({ joinCode: JOIN_CODE, sessionId: SESSION_ID, role: "player" }), true);

  const decision = await resolveActiveMesa();
  assert.equal(decision.kind, "navigate", "fluxo GM usa a tela dedicada");
  assert.equal(fetchCalls, 1, "a sessão é confirmada antes do redirect");
  assert.equal(hasMembership(JOIN_CODE), true, "assinatura do Mestre intacta");
});

// ===========================================================================
// (C) Classificação da resposta do servidor (regras puras)
// ===========================================================================

test("livenessFromState: só sessão 'finished' é stale", () => {
  const state = (status: string) => ({ session: { status } }) as never;
  assert.equal(livenessFromState(state("active")), "active");
  assert.equal(livenessFromState(state("lobby")), "active", "sessão em lobby continua viva");
  assert.equal(livenessFromState(state("finished")), "stale");
});

test("livenessFromError: stale SÓ quando o servidor diz que a assinatura morreu", () => {
  const staleCodes = ["session_not_found", "session_finished", "not_participant"];
  for (const code of staleCodes) {
    assert.equal(livenessFromError(new MesaApiError("x", 410, code)), "stale", code);
  }
  for (const code of ["missing_token", "database_error", "unknown"]) {
    assert.equal(livenessFromError(new MesaApiError("x", 500, code)), "unconfirmed", code);
  }
  assert.equal(livenessFromError(new TypeError("fetch failed")), "unconfirmed", "queda de rede não é staleness");
  assert.equal(livenessFromError(undefined), "unconfirmed");
});

// ===========================================================================
// (D) O caminho completo do botão
// ===========================================================================

test("Mesa ativa de jogador confirmada → navigate para /mesa/<uuid>, sem tocar na assinatura", async () => {
  connect("player");
  mode = "active";

  const decision = await resolveActiveMesa();

  assert.equal(decision.kind, "navigate");
  if (decision.kind !== "navigate") throw new Error("unreachable");
  assert.equal(decision.sessionId, SESSION_ID);
  assert.equal(decision.href, `/mesa/${SESSION_ID}`, "redirect canônico, idêntico ao do convite (F1.12.6)");
  assert.equal(resolveMesaRoute(decision.href.slice("/mesa/".length)).kind, "session", "o href cai numa sessão");
  assert.equal(seenUrls.at(-1), `/api/mesa/${SESSION_ID}`, "confirma no MESMO estado que a tela leria");
  assert.equal(hasMembership(JOIN_CODE), true, "assinatura preservada");
});

test("sessão encerrada pelo Mestre → stale, limpa com a infra existente, SEM redirect", async () => {
  connect("player");
  mode = "finished-state";

  const decision = await resolveActiveMesa();

  assert.equal(decision.kind, "stale", "não é navigate: o modal de entrada é o que segue");
  assert.equal(hasMembership(JOIN_CODE), false, "removeMembership já aplicado");
  assert.equal(getMembershipSnapshot().activeJoinCode, null, "nenhuma Mesa ativa sobrando");
});

test("código de staleness vindo como erro (404/410/403) → stale e limpa", async () => {
  for (const next of ["not-found", "finished-error", "not-participant"] as Mode[]) {
    connect("player");
    mode = next;
    const decision = await resolveActiveMesa();
    assert.equal(decision.kind, "stale", next);
    assert.equal(hasMembership(JOIN_CODE), false, `${next}: assinatura expirada é apagada`);
  }
});

test("falha de rede → entry, mas o vínculo NÃO é apagado", async () => {
  connect("player");
  mode = "network";

  const decision = await resolveActiveMesa();

  assert.equal(decision.kind, "entry", "sem confirmação não se navega para uma Mesa possivelmente inválida");
  assert.equal(hasMembership(JOIN_CODE), true, "vínculo só cai por pedido ou por decisão do servidor");
  assert.equal(getMembershipSnapshot().activeJoinCode, JOIN_CODE);
});

test("sem Mesa ativa → entry: o fluxo atual de entrada/seleção/criação fica intacto", async () => {
  mode = "active";
  removeMembership(JOIN_CODE);
  fetchCalls = 0;

  const decision = await resolveActiveMesa();

  assert.equal(decision.kind, "entry", "é a única decisão que abre o modal");
  assert.equal(fetchCalls, 0, "sem candidata não há o que perguntar ao servidor");
});

test("recuperação: a stale limpa devolve o botão ao fluxo de entrada", async () => {
  connect("player");
  mode = "finished-error";

  const first = await resolveActiveMesa();
  assert.equal(first.kind, "stale");

  // Depois da limpeza a próxima leitura é do zero: sem candidata, `entry`.
  const second = await resolveActiveMesa();
  assert.equal(second.kind, "entry");
  assert.equal(fetchCalls, 1, "só a primeira tentativa foi ao servidor");
});

test("navegação não deixa estado paralelo: o membershipStore é a única fonte", async () => {
  connect("player");
  mode = "active";
  await resolveActiveMesa();

  const snapshot = getMembershipSnapshot();
  assert.deepEqual(Object.keys(snapshot), ["activeJoinCode", "entries"], "mesmo formato do store");
  assert.equal(snapshot.activeJoinCode, JOIN_CODE);
  assert.equal(snapshot.entries[JOIN_CODE].sessionId, SESSION_ID);
  assert.equal(snapshot.entries[JOIN_CODE].role, "player");
});
