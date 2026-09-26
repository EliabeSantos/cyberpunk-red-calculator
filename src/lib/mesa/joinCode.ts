/**
 * Código de entrada da Mesa (modo online) — módulo puro, sem cliente/servidor.
 *
 * Formato exibido para os jogadores: 5 caracteres, ex.: `8F4K2`.
 * O alfabeto deixa de fora 0/O/1/I para o código não ser confundido ao ser lido
 * em voz alta ou digitado à mão.
 *
 * ATENÇÃO: isto NÃO é o `sessionCode` do Discord (`src/lib/discord/sessionCode.ts`),
 * que continua existindo com o seu próprio formato e persistência. São conceitos
 * distintos e não foram fundidos para não alterar comportamento existente.
 */

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const JOIN_CODE_LENGTH = 5;
/** 35^5 ≈ 52 milhões — espaço grande o bastante para não ser adivinhado. */
const CODE_PATTERN = /^[A-Z0-9]{5}$/;

function defaultRandomByte(): number {
  const bytes = new Uint8Array(1);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
    return bytes[0];
  }
  return Math.floor(Math.random() * 256);
}

/** Gera um código novo. `randomByte` é injetável para testes determinísticos. */
export function generateJoinCode(randomByte: () => number = defaultRandomByte): string {
  let code = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i += 1) {
    code += ALPHABET[randomByte() % ALPHABET.length];
  }
  return code;
}

/**
 * Normaliza o que o usuário digitou (trim + maiúsculas) e valida.
 * Devolve `null` quando não é um código aceitável.
 */
export function normalizeJoinCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) return null;
  return code;
}

/** Conveniência para a UI: mostra o placeholder do formato. */
export const JOIN_CODE_PLACEHOLDER = "8F4K2";
