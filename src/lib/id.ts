/**
 * Gera IDs no formato UUID v4 sem assumir que `crypto.randomUUID()` existe.
 *
 * Ordem de preferência:
 * 1. `crypto.randomUUID()`;
 * 2. `crypto.getRandomValues()`;
 * 3. fallback UUID-like baseado em relógio + contador.
 *
 * O último caminho evita quebrar navegadores/contextos HTTP antigos, mas não é
 * criptograficamente seguro. Ele não deve ser usado como credencial, token de
 * autenticação ou segredo; tokens de Mesa continuam sendo validados no servidor.
 */

interface CryptoSource {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
}

let fallbackCounter = 0;

function cryptoSource(): CryptoSource | null {
  const candidate = (globalThis as { crypto?: unknown }).crypto;
  return candidate && typeof candidate === "object" ? candidate as CryptoSource : null;
}

function uuidFromRandomValues(source: CryptoSource): string | null {
  if (typeof source.getRandomValues !== "function") return null;
  try {
    const bytes = source.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } catch {
    return null;
  }
}

function fallbackUuid(): string {
  const timestamp = Date.now().toString(16).padStart(12, "0").slice(-12);
  const counter = (fallbackCounter++ >>> 0).toString(16).padStart(8, "0");
  const hex = `${timestamp}${counter}000000000000`.slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = "8";
  const compact = hex.join("");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

/** Retorna um ID criptograficamente forte, ou null em runtimes sem Web Crypto. */
export function createSecureId(): string | null {
  const source = cryptoSource();
  if (source?.randomUUID) {
    try {
      const id = source.randomUUID();
      if (typeof id === "string" && id.length > 0) return id;
    } catch {
      // Continua para getRandomValues ou para o fallback legado.
    }
  }
  return source ? uuidFromRandomValues(source) : null;
}

export function createId(): string {
  return createSecureId() ?? fallbackUuid();
}
