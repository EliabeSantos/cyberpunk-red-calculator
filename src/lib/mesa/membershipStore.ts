/**
 * Assinatura do localStorage das mesas — SÓ leitura reativa.
 *
 * `useSyncExternalStore` lê isto sem efeito nenhum: o snapshot é estável (mesmo
 * objeto enquanto o conteúdo bruto não muda), então não há renderização em
 * cascata nem divergência de hidratação — o servidor lê `getServerSnapshot`
 * (vazio) e o cliente só troca depois da hidratação.
 *
 * Toda escrita dispara o evento `cyberpunk-red-toolkit:mesa-changed`, para que
 * quem escreveu (mesmo documento) também seja notificado — o evento nativo
 * `storage` só dispara em OUTRAS abas.
 */

export interface MesaEntry {
  sessionId: string;
  participantId: string;
  displayName: string;
  role: "gm" | "player";
}

export interface StoredMembership {
  activeJoinCode: string | null;
  entries: Record<string, MesaEntry>;
}

const TOKEN_KEY = "cyberpunk-red-toolkit:mesa-player:v1";
const MEMBERSHIP_KEY = "cyberpunk-red-toolkit:mesa-membership:v1";
const CHANGE_EVENT = "cyberpunk-red-toolkit:mesa-changed";

const EMPTY: StoredMembership = { activeJoinCode: null, entries: {} };

let cachedRaw: string | null | undefined;
let cachedSnapshot: StoredMembership = EMPTY;

function canUseStorage(): boolean {
  return typeof window !== "undefined";
}

/**
 * Identidade deste navegador: gerada uma vez e reutilizada em todas as mesas.
 * Não é uma conta — é só o segredo que as rotas usam para saber quem pediu.
 */
export function getPlayerToken(): string {
  if (!canUseStorage()) return "";
  try {
    const existing = window.localStorage.getItem(TOKEN_KEY);
    if (existing && existing.length >= 16) return existing;
    const token = crypto.randomUUID();
    window.localStorage.setItem(TOKEN_KEY, token);
    return token;
  } catch {
    // Sem storage: a sessão da mesa não sobrevive ao reload, mas nada quebra.
    return crypto.randomUUID();
  }
}

function parse(raw: string | null): StoredMembership {
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredMembership>;
    return {
      activeJoinCode: typeof parsed.activeJoinCode === "string" ? parsed.activeJoinCode : null,
      entries: parsed.entries && typeof parsed.entries === "object" ? parsed.entries : {},
    };
  } catch {
    return EMPTY;
  }
}

/** Lê o snapshot atual (memoizado por conteúdo bruto). */
export function getMembershipSnapshot(): StoredMembership {
  if (!canUseStorage()) return EMPTY;
  if (cachedRaw !== undefined) return cachedSnapshot;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(MEMBERSHIP_KEY);
  } catch {
    return EMPTY;
  }
  cachedRaw = raw;
  cachedSnapshot = parse(raw);
  return cachedSnapshot;
}

/** Durante SSR e na primeira leitura da hidratação: sempre vazio. */
export function getServerMembershipSnapshot(): StoredMembership {
  return EMPTY;
}

export function subscribeToMembership(onChange: () => void): () => void {
  if (!canUseStorage()) return () => {};
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function commit(next: StoredMembership): void {
  cachedSnapshot = next;
  try {
    const raw = JSON.stringify(next);
    cachedRaw = raw;
    window.localStorage.setItem(MEMBERSHIP_KEY, raw);
  } catch {
    cachedRaw = null;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Registra que este navegador entrou numa mesa e (por padrão) a torna ativa. */
export function rememberMembership(joinCode: string, entry: MesaEntry, active = true): void {
  if (!canUseStorage()) return;
  const current = getMembershipSnapshot();
  commit({
    activeJoinCode: active ? joinCode : current.activeJoinCode,
    entries: { ...current.entries, [joinCode]: entry },
  });
}

/** Vínculo deste navegador com uma mesa específica (pelo código de entrada). */
export function getMembership(joinCode: string): MesaEntry | null {
  return getMembershipSnapshot().entries[joinCode.toUpperCase()] ?? null;
}

export function getActiveMembership(): MesaEntry | null {
  const snapshot = getMembershipSnapshot();
  if (!snapshot.activeJoinCode) return null;
  return snapshot.entries[snapshot.activeJoinCode] ?? null;
}

export function clearActiveMembership(): void {
  const current = getMembershipSnapshot();
  commit({ ...current, activeJoinCode: null });
}

/**
 * Sai de uma mesa: apaga a assinatura deste navegador.
 *
 * É um dos dois únicos caminhos de desconexão (o outro é o Mestre encerrar a
 * sessão). Fechar o painel da mesa NÃO mexe aqui — o vínculo continua valendo
 * enquanto esta assinatura existir.
 */
export function removeMembership(joinCode: string): void {
  if (!canUseStorage()) return;
  const code = joinCode.toUpperCase();
  const current = getMembershipSnapshot();
  if (!current.entries[code]) return;

  const entries = { ...current.entries };
  delete entries[code];

  commit({
    // Se a mesa ativa era esta, a próxima (ou nenhuma) assume.
    activeJoinCode: current.activeJoinCode === code ? (Object.keys(entries)[0] ?? null) : current.activeJoinCode,
    entries,
  });
}

export function listMemberships(): Array<{ joinCode: string } & MesaEntry> {
  return Object.entries(getMembershipSnapshot().entries).map(([joinCode, entry]) => ({
    joinCode,
    ...entry,
  }));
}
