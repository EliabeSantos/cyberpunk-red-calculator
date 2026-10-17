/**
 * Validação de imagens de personalização (SOMENTE módulo puro, compartilhado
 * entre cliente e servidor).
 *
 * A validação confia no CONTEÚDO do arquivo, nunca na extensão nem no MIME
 * informado pelo navegador: o formato é detectado por magic bytes e as
 * dimensões são lidas do próprio cabeçalho (IHDR do PNG, SOF do JPEG,
 * chunk VP8/VP8L/VP8X do WebP). Os bytes são preservados como estão — em
 * especial o canal alfa de PNG e WebP; nada é convertido para JPEG.
 */

export type ImageFormat = "png" | "jpeg" | "webp";

export const IMAGE_FORMATS: readonly ImageFormat[] = ["png", "jpeg", "webp"];

export const IMAGE_MIME_TYPES: Readonly<Record<ImageFormat, string>> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export const IMAGE_EXTENSIONS = { png: "png", jpeg: "jpg", webp: "webp" } as const;

export type CharacterVisualImageErrorCode =
  | "invalid_image_payload"
  | "invalid_image_format"
  | "image_too_large"
  | "image_dimensions_unreadable"
  | "image_dimensions_invalid";

export class CharacterVisualImageError extends Error {
  readonly code: CharacterVisualImageErrorCode;

  constructor(code: CharacterVisualImageErrorCode, message: string) {
    super(message);
    this.name = "CharacterVisualImageError";
    this.code = code;
  }
}

export interface ImageValidationOptions {
  /** Tamanho máximo em bytes. Padrão: `DEFAULT_MAX_IMAGE_BYTES`. */
  maxBytes?: number;
  /** Lado máximo (px). Padrão: `DEFAULT_MAX_IMAGE_DIMENSION`. */
  maxDimension?: number;
  /** Menor lado aceito (px). Padrão: `DEFAULT_MIN_IMAGE_DIMENSION`. */
  minDimension?: number;
  /** Maior razão lado/lado aceita. Padrão: `DEFAULT_MAX_ASPECT_RATIO`. */
  maxAspectRatio?: number;
  /** MIME declarado pelo remetente; precisa corresponder ao conteúdo real. */
  declaredMimeType?: string;
}

export interface ValidatedImage {
  format: ImageFormat;
  mimeType: string;
  width: number;
  height: number;
  byteLength: number;
}

/**
 * Padrão conservador e configurável pela infraestrutura existente: a rota
 * `PATCH /api/hosting/config` já reescreve env; `MESA_VISUAL_MAX_IMAGE_BYTES`
 * segue a mesma convenção de variáveis do host (`MESA_LOCAL_DATABASE_URL`…).
 */
export const DEFAULT_MAX_IMAGE_BYTES = 2_000_000;
export const DEFAULT_MAX_IMAGE_DIMENSION = 4096;
export const DEFAULT_MIN_IMAGE_DIMENSION = 32;
export const DEFAULT_MAX_ASPECT_RATIO = 6;

/** Lê o limite configurado sem quebrar no navegador (onde não há `process.env`). */
export function configuredMaxImageBytes(
  env?: Readonly<Record<string, string | undefined>>,
): number {
  const source = env ?? (typeof process !== "undefined" ? process.env : {});
  const raw = source.MESA_VISUAL_MAX_IMAGE_BYTES?.trim();
  if (!raw) return DEFAULT_MAX_IMAGE_BYTES;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_IMAGE_BYTES;
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[offset + index] !== signature[index]) return false;
  }
  return true;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;

/** Detecta o formato real do arquivo pelos magic bytes; `null` se desconhecido. */
export function sniffImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return "png";
  if (startsWith(bytes, JPEG_SIGNATURE)) return "jpeg";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // "RIFF"
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 // "WEBP"
  ) {
    return "webp";
  }
  return null;
}

function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  // Assinatura (8) + IHDR (4) + tamanho (4) → width/height big-endian em 16..24.
  if (bytes.length < 24) return null;
  const tag = String.fromCharCode(...bytes.subarray(12, 16));
  if (tag !== "IHDR") return null;
  const width = (bytes[16] << 24 | bytes[17] << 16 | bytes[18] << 8 | bytes[19]) >>> 0;
  const height = (bytes[20] << 24 | bytes[21] << 16 | bytes[22] << 8 | bytes[23]) >>> 0;
  return width > 0 && height > 0 ? { width, height } : null;
}

function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    let marker = bytes[offset + 1];
    // Bytes de preenchimento 0xFF antes do marcador real.
    let markerOffset = offset + 1;
    while (marker === 0xff && markerOffset + 1 < bytes.length) {
      markerOffset += 1;
      marker = bytes[markerOffset];
    }
    // Marcadores sem payload e com payload de comprimento fixo.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset = markerOffset + 1;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // EOI/scan sem SOF válido.
    const length = (bytes[markerOffset + 1] << 8) | bytes[markerOffset + 2];
    if (length < 2) return null;
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      const body = markerOffset + 3;
      if (body + 5 > bytes.length) return null;
      const height = (bytes[body + 1] << 8) | bytes[body + 2];
      const width = (bytes[body + 3] << 8) | bytes[body + 4];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset = markerOffset + 1 + length;
  }
  return null;
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readWebpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 20) return null;
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk === "VP8X") {
    if (bytes.length < 30) return null;
    const width = readUint24LE(bytes, 24) + 1;
    const height = readUint24LE(bytes, 27) + 1;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (chunk === "VP8L") {
    if (bytes.length < 25 || bytes[20] !== 0x2f) return null;
    const b1 = bytes[21];
    const b2 = bytes[22];
    const b3 = bytes[23];
    const b4 = bytes[24];
    const width = 1 + (((b2 & 0x3f) << 8) | b1);
    const height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | (b2 >> 6));
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (chunk === "VP8 ") {
    // Frame tag (3 bytes) + start code 0x9D 0x01 0x2A + dimensões de 14 bits.
    if (bytes.length < 30 || bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    const width = ((bytes[26] | (bytes[27] << 8)) & 0x3fff);
    const height = ((bytes[28] | (bytes[29] << 8)) & 0x3fff);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  return null;
}

/** Lê as dimensões do cabeçalho; `null` quando o arquivo está truncado/inválido. */
export function readImageDimensions(
  bytes: Uint8Array,
  format: ImageFormat,
): { width: number; height: number } | null {
  if (format === "png") return readPngDimensions(bytes);
  if (format === "jpeg") return readJpegDimensions(bytes);
  return readWebpDimensions(bytes);
}

/** Valida magic bytes, tamanho e dimensões. Lança `CharacterVisualImageError`. */
export function validateImageBytes(bytes: Uint8Array, options: ImageValidationOptions = {}): ValidatedImage {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES;
  const maxDimension = options.maxDimension ?? DEFAULT_MAX_IMAGE_DIMENSION;
  const minDimension = options.minDimension ?? DEFAULT_MIN_IMAGE_DIMENSION;
  const maxAspectRatio = options.maxAspectRatio ?? DEFAULT_MAX_ASPECT_RATIO;

  if (bytes.length === 0) {
    throw new CharacterVisualImageError("invalid_image_payload", "O arquivo de imagem está vazio.");
  }
  if (bytes.length > maxBytes) {
    throw new CharacterVisualImageError(
      "image_too_large",
      `A imagem excede o limite de ${Math.round(maxBytes / 1_000)} KB.`,
    );
  }
  const format = sniffImageFormat(bytes);
  if (!format) {
    throw new CharacterVisualImageError(
      "invalid_image_format",
      "Formato não suportado: use PNG, JPEG ou WebP.",
    );
  }
  if (options.declaredMimeType) {
    const normalizedDeclared = options.declaredMimeType.split(";")[0].trim().toLowerCase();
    const expected = IMAGE_MIME_TYPES[format];
    // `image/jpg` é um alias comum do JPEG fora do padrão.
    const accepted = normalizedDeclared === expected || (format === "jpeg" && normalizedDeclared === "image/jpg");
    if (!accepted) {
      throw new CharacterVisualImageError(
        "invalid_image_format",
        `O conteúdo do arquivo (${expected}) não corresponde ao tipo declarado (${normalizedDeclared}).`,
      );
    }
  }
  const dimensions = readImageDimensions(bytes, format);
  if (!dimensions) {
    throw new CharacterVisualImageError(
      "image_dimensions_unreadable",
      "Não foi possível ler as dimensões da imagem; o arquivo pode estar corrompido.",
    );
  }
  const { width, height } = dimensions;
  if (width > maxDimension || height > maxDimension || width < minDimension || height < minDimension) {
    throw new CharacterVisualImageError(
      "image_dimensions_invalid",
      `As dimensões precisam ficar entre ${minDimension} e ${maxDimension} pixels.`,
    );
  }
  const ratio = Math.max(width / height, height / width);
  if (ratio > maxAspectRatio) {
    throw new CharacterVisualImageError(
      "image_dimensions_invalid",
      "A proporção da imagem é extrema demais para uso no combate.",
    );
  }
  return { format, mimeType: IMAGE_MIME_TYPES[format], width, height, byteLength: bytes.length };
}

const DATA_URL_PATTERN = /^data:([^;,]+)?(;base64)?,/i;

/** Converte `data:<mime>;base64,…` em bytes. Lança `CharacterVisualImageError`. */
export function decodeImageDataUrl(value: unknown): { bytes: Uint8Array; declaredMimeType: string | null } {
  if (typeof value !== "string" || value.length === 0) {
    throw new CharacterVisualImageError("invalid_image_payload", "Imagem ausente ou em formato inválido.");
  }
  const match = DATA_URL_PATTERN.exec(value);
  if (!match) {
    throw new CharacterVisualImageError("invalid_image_payload", "Imagem enviada não é um data URL válido.");
  }
  const declaredMimeType = match[1] ?? null;
  const isBase64 = Boolean(match[2]);
  const payload = value.slice(match[0].length);
  if (!isBase64) {
    throw new CharacterVisualImageError("invalid_image_payload", "Somente data URLs base64 são aceitos.");
  }
  const atobImpl = (globalThis as { atob?: (input: string) => string }).atob;
  if (typeof atobImpl !== "function") {
    throw new CharacterVisualImageError("invalid_image_payload", "Runtime sem suporte a decodificação base64.");
  }
  let binary: string;
  try {
    binary = atobImpl(payload.replace(/[\r\n\s]/g, ""));
  } catch {
    throw new CharacterVisualImageError("invalid_image_payload", "A imagem base64 está corrompida.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { bytes, declaredMimeType };
}

/** Codifica bytes como data URL base64 (mesmo formato aceito pelo servidor). */
export function encodeImageDataUrl(bytes: Uint8Array, mimeType: string): string {
  const btoaImpl = (globalThis as { btoa?: (input: string) => string }).btoa;
  if (typeof btoaImpl !== "function") {
    throw new CharacterVisualImageError("invalid_image_payload", "Runtime sem suporte a codificação base64.");
  }
  let binary = "";
  const CHUNK = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return `data:${mimeType};base64,${btoaImpl(binary)}`;
}
