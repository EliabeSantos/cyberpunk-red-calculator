import assert from "node:assert/strict";
import test from "node:test";

/**
 * O `membershipStore` checa `typeof window` antes de tocar em qualquer coisa,
 * então um window mínimo basta para exercitar a regra de conexão da mesa:
 *
 *   • conectar grava a assinatura e ela CONTINUA valendo (não some sozinha);
 *   • só sair clicando (removeMembership) ou o Mestre encerrar a sessão.
 *
 * Os testes são uma sequência: o cache do módulo é único por processo, então
 * cada um parte do estado deixado pelo anterior (node:test roda em ordem).
 */
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

const {
  getMembership,
  getMembershipSnapshot,
  getServerMembershipSnapshot,
  rememberMembership,
  removeMembership,
  subscribeToMembership,
} = await import("../src/lib/mesa/membershipStore.ts");

test("nenhuma mesa antes de conectar", () => {
  assert.deepEqual(getMembershipSnapshot(), { activeJoinCode: null, entries: {} });
  assert.equal(getMembership("8F4K2"), null);
});

test("conectar grava a assinatura e a torna ativa", () => {
  rememberMembership("8F4K2", {
    sessionId: "sessao-1",
    participantId: "part-1",
    displayName: "Zuberi",
    role: "player",
  });

  const snapshot = getMembershipSnapshot();
  assert.equal(snapshot.activeJoinCode, "8F4K2");
  assert.deepEqual(snapshot.entries["8F4K2"], {
    sessionId: "sessao-1",
    participantId: "part-1",
    displayName: "Zuberi",
    role: "player",
  });
  assert.equal(getMembership("8F4K2")?.sessionId, "sessao-1");
  assert.equal(getMembership("8f4k2")?.sessionId, "sessao-1", "código normalizado");
});

test("a conexão sobrevive a fechar o painel: nada a mais é gravado nem apagado", () => {
  const before = getMembershipSnapshot();
  // Fechar o painel só mexe no mesaUiStore (em memória) — o membershipStore
  // não é tocado, então o snapshot nem muda de identidade.
  assert.equal(getMembershipSnapshot(), before, "snapshot estável = sem re-render sem motivo");
  assert.equal(storage.get("cyberpunk-red-toolkit:mesa-membership:v1"), JSON.stringify(before));
});

test("entrar numa segunda mesa mantém as duas, com a nova ativa", () => {
  rememberMembership("AB3D9", {
    sessionId: "sessao-2",
    participantId: "part-2",
    displayName: "Zuberi",
    role: "gm",
  });

  const snapshot = getMembershipSnapshot();
  assert.equal(Object.keys(snapshot.entries).length, 2, "nenhuma mesa some ao entrar em outra");
  assert.equal(snapshot.activeJoinCode, "AB3D9");
  assert.equal(snapshot.entries["8F4K2"].role, "player");
  assert.equal(snapshot.entries["AB3D9"].role, "gm");
});

test("sair de uma mesa que não é a ativa não derruba a ativa", () => {
  removeMembership("8F4K2");

  const snapshot = getMembershipSnapshot();
  assert.equal(snapshot.entries["8F4K2"], undefined, "assinatura apagada");
  assert.equal(snapshot.activeJoinCode, "AB3D9", "ativa continua sendo a outra");
  assert.equal(getMembership("8F4K2"), null);
});

test("sair da mesa ativa passa a ativa para a próxima (ou nenhuma)", () => {
  removeMembership("AB3D9");

  const snapshot = getMembershipSnapshot();
  assert.deepEqual(snapshot, { activeJoinCode: null, entries: {} });
});

test("sair de mesa desconhecida não emite evento (nada mudou)", () => {
  let notifications = 0;
  const unsubscribe = subscribeToMembership(() => {
    notifications += 1;
  });

  removeMembership("ZZZZ9");

  assert.equal(notifications, 0, "sem mudança não deve notificar quem assiste");
  assert.deepEqual(getMembershipSnapshot(), { activeJoinCode: null, entries: {} });
  unsubscribe();
});

test("quem assina é avisado quando alguém sai da mesa", () => {
  rememberMembership("KK3M7", {
    sessionId: "sessao-3",
    participantId: "part-3",
    displayName: "Takemura",
    role: "player",
  });

  let notifications = 0;
  const unsubscribe = subscribeToMembership(() => {
    notifications += 1;
  });

  removeMembership("KK3M7");

  assert.equal(notifications, 1, "uma única notificação por desconexão");
  assert.equal(getMembershipSnapshot().activeJoinCode, null, "nenhuma mesa ativa depois de sair da última");
  unsubscribe();
});

test("o snapshot do servidor é sempre vazio (sem divergência de hidratação)", () => {
  rememberMembership("QQ1T4", {
    sessionId: "sessao-4",
    participantId: "part-4",
    displayName: "Zuberi",
    role: "player",
  });
  assert.deepEqual(getServerMembershipSnapshot(), { activeJoinCode: null, entries: {} });
  removeMembership("QQ1T4");
});
