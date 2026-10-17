/**
 * Validação de imagens da identidade visual.
 *
 * Critérios:
 * - o formato é detectado por magic bytes (PNG, JPEG, WebP), nunca por extensão
 *   ou pelo MIME declarado pelo navegador;
 * - arquivos vazios, desconhecidos ou grandes demais são rejeitados com código
 *   estável;
 * - o limite de bytes é configurável pela infraestrutura (`MESA_VISUAL_MAX_IMAGE_BYTES`);
 * - os bytes validados são preservados como chegaram (nenhuma conversão para
 *   JPEG; canal alfa de PNG/WebP intocado por definição do pipeline).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CharacterVisualImageError,
  DEFAULT_MAX_IMAGE_BYTES,
  configuredMaxImageBytes,
  decodeImageDataUrl,
  encodeImageDataUrl,
  readImageDimensions,
  sniffImageFormat,
  validateImageBytes,
} from "../src/lib/characterVisual/imageValidation.ts";

// ==== (A) fixtures com magic bytes reais ====

function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0); // assinatura PNG
  bytes.set([73, 72, 68, 82], 12); // "IHDR"
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([1, 8], 24); // profundidade/cor
  return bytes;
}

function jpegBytes(width: number, height: number): Uint8Array {
  const bytes: number[] = [255, 216]; // SOI
  bytes.push(255, 192, 0, 17, 8); // SOF0 + comprimento + precisão
  bytes.push((height >> 8) & 255, height & 255);
  bytes.push((width >> 8) & 255, width & 255);
  bytes.push(1, 3, 17, 0, 2, 17, 1, 3, 17, 1); // componentes + EOI parcial
  bytes.push(255, 217);
  return Uint8Array.from(bytes);
}

function webpVp8lBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(25);
  bytes.set([82, 73, 70, 70], 0); // "RIFF"
  bytes.set([87, 69, 66, 80], 8); // "WEBP"
  bytes.set([86, 80, 56, 76], 12); // "VP8L"
  bytes[20] = 47; // assinatura 0x2F
  const packed = (width - 1) | ((height - 1) << 14);
  bytes[21] = packed & 255;
  bytes[22] = (packed >> 8) & 255;
  bytes[23] = (packed >> 16) & 255;
  bytes[24] = (packed >> 24) & 255;
  return bytes;
}

function webpVp8xBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([82, 73, 70, 70], 0);
  bytes.set([87, 69, 66, 80], 8);
  bytes.set([86, 80, 56, 88], 12); // "VP8X"
  bytes[24] = (width - 1) & 255;
  bytes[25] = ((width - 1) >> 8) & 255;
  bytes[26] = ((width - 1) >> 16) & 255;
  bytes[27] = (height - 1) & 255;
  bytes[28] = ((height - 1) >> 8) & 255;
  bytes[29] = ((height - 1) >> 16) & 255;
  return bytes;
}

function webpVp8Bytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([82, 73, 70, 70], 0);
  bytes.set([87, 69, 66, 80], 8);
  bytes.set([86, 80, 56, 32], 12); // "VP8 "
  bytes.set([157, 1, 42], 23); // start code do frame key
  bytes[26] = width & 255;
  bytes[27] = (width >> 8) & 255;
  bytes[28] = height & 255;
  bytes[29] = (height >> 8) & 255;
  return bytes;
}

// ==== (B) detecção de formato por magic bytes ====

test("sniffImageFormat reconhece PNG, JPEG e WebP e recusa o resto", () => {
  assert.equal(sniffImageFormat(pngBytes(4, 4)), "png");
  assert.equal(sniffImageFormat(jpegBytes(4, 4)), "jpeg");
  assert.equal(sniffImageFormat(webpVp8lBytes(4, 4)), "webp");
  assert.equal(sniffImageFormat(webpVp8xBytes(4, 4)), "webp");
  assert.equal(sniffImageFormat(webpVp8Bytes(4, 4)), "webp");
  // GIF, HTML e binário aleatório não passam.
  assert.equal(sniffImageFormat(Uint8Array.from([71, 73, 70, 56, 57, 97])), null);
  assert.equal(sniffImageFormat(Uint8Array.from([60, 33, 100, 111, 99, 116, 121, 112, 101])), null);
  assert.equal(sniffImageFormat(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])), null);
  // "RIFF" sem "WEBP" não é imagem válida.
  assert.equal(sniffImageFormat(Uint8Array.from([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69])), null);
});

// ==== (C) dimensões lidas do cabeçalho ====

test("readImageDimensions lê PNG, JPEG e os três formatos de WebP", () => {
  assert.deepEqual(readImageDimensions(pngBytes(640, 360), "png"), { width: 640, height: 360 });
  assert.deepEqual(readImageDimensions(jpegBytes(1920, 1080), "jpeg"), { width: 1920, height: 1080 });
  assert.deepEqual(readImageDimensions(webpVp8lBytes(512, 768), "webp"), { width: 512, height: 768 });
  assert.deepEqual(readImageDimensions(webpVp8xBytes(2048, 1024), "webp"), { width: 2048, height: 1024 });
  assert.deepEqual(readImageDimensions(webpVp8Bytes(800, 600), "webp"), { width: 800, height: 600 });
  // Arquivo truncado devolve null em vez de adivinhar.
  assert.equal(readImageDimensions(pngBytes(4, 4).subarray(0, 10), "png"), null);
  assert.equal(readImageDimensions(Uint8Array.from([82, 73, 70, 70]), "webp"), null);
});

// ==== (D) validação de conteúdo ====

test("validateImageBytes aceita os três formatos e preserva os bytes originais", () => {
  const png = pngBytes(256, 256);
  const validated = validateImageBytes(png);
  assert.equal(validated.format, "png");
  assert.equal(validated.mimeType, "image/png");
  assert.deepEqual({ width: validated.width, height: validated.height }, { width: 256, height: 256 });
  assert.equal(validated.byteLength, png.length);
  // Nada de conversão: o pipeline devolve exatamente o que recebeu.
  assert.deepEqual(validateImageBytes(jpegBytes(300, 200)).mimeType, "image/jpeg");
  assert.equal(validateImageBytes(webpVp8lBytes(300, 200)).mimeType, "image/webp");
});

test("validateImageBytes rejeita payloads inválidos com códigos estáveis", () => {
  assert.throws(
    () => validateImageBytes(Uint8Array.from([])),
    (error: unknown) => error instanceof CharacterVisualImageError && error.code === "invalid_image_payload",
  );
  assert.throws(
    () => validateImageBytes(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])),
    (error: unknown) => error instanceof CharacterVisualImageError && error.code === "invalid_image_format",
  );
  // Extensão/MIME bonito não engana: conteúdo GIF com cara de imagem rejeitado.
  assert.throws(
    () => validateImageBytes(Uint8Array.from([71, 73, 70, 56, 57, 97, 1, 2, 3]), { declaredMimeType: "image/png" }),
    (error: unknown) => error instanceof CharacterVisualImageError && error.code === "invalid_image_format",
  );
});

test("validateImageBytes rejeita MIME declarado que não corresponde ao conteúdo", () => {
  assert.throws(
    () => validateImageBytes(pngBytes(64, 64), { declaredMimeType: "image/jpeg" }),
    (error: unknown) => error instanceof CharacterVisualImageError && error.code === "invalid_image_format",
  );
  // `image/jpg` (alias comum) do JPEG continua aceito.
  assert.equal(validateImageBytes(jpegBytes(64, 64), { declaredMimeType: "image/jpg" }).format, "jpeg");
});

test("validateImageBytes respeita o limite de tamanho configurável", () => {
  assert.throws(
    () => validateImageBytes(pngBytes(64, 64), { maxBytes: 10 }),
    (error: unknown) => error instanceof CharacterVisualImageError && error.code === "image_too_large",
  );
  // O padrão da infraestrutura é 2 MB.
  assert.equal(configuredMaxImageBytes({}), DEFAULT_MAX_IMAGE_BYTES);
  assert.equal(configuredMaxImageBytes({ MESA_VISUAL_MAX_IMAGE_BYTES: "500000" }), 500_000);
  assert.equal(configuredMaxImageBytes({ MESA_VISUAL_MAX_IMAGE_BYTES: "abc" }), DEFAULT_MAX_IMAGE_BYTES);
  // Cabe dentro do limite default: não dispara.
  assert.equal(validateImageBytes(pngBytes(64, 64)).byteLength < DEFAULT_MAX_IMAGE_BYTES, true);
});

test("validateImageBytes rejeita dimensões extremas e arquivos truncados", () => {
  assert.throws(
    () => validateImageBytes(pngBytes(8192, 32)),
    (error: unknown) => error instanceof CharacterVisualImageError && error.code === "image_dimensions_invalid",
  );
  assert.throws(
    () => validateImageBytes(pngBytes(2000, 100)),
    (error: unknown) => error instanceof CharacterVisualImageError && error.code === "image_dimensions_invalid",
  );
  assert.throws(
    () => validateImageBytes(pngBytes(8, 8)),
    (error: unknown) => error instanceof CharacterVisualImageError && error.code === "image_dimensions_invalid",
  );
  assert.throws(
    () => validateImageBytes(pngBytes(64, 64).subarray(0, 20)),
    (error: unknown) => error instanceof CharacterVisualImageError && error.code === "image_dimensions_unreadable",
  );
});

// ==== (E) data URLs ====

test("decodeImageDataUrl e encodeImageDataUrl fazem ida e volta sem alterar bytes", () => {
  const png = pngBytes(48, 48);
  const dataUrl = encodeImageDataUrl(png, "image/png");
  assert.ok(dataUrl.startsWith("data:image/png;base64,"));
  const decoded = decodeImageDataUrl(dataUrl);
  assert.deepEqual(decoded.bytes, png);
  assert.equal(decoded.declaredMimeType, "image/png");
});

test("decodeImageDataUrl rejeita entradas que não são data URL base64", () => {
  assert.throws(
    () => decodeImageDataUrl("https://exemplo.com/logo.png"),
    (error: unknown) => error instanceof CharacterVisualImageError && error.code === "invalid_image_payload",
  );
  assert.throws(
    () => decodeImageDataUrl(null),
    (error: unknown) => error instanceof CharacterVisualImageError && error.code === "invalid_image_payload",
  );
  assert.throws(
    () => decodeImageDataUrl("data:image/png,nao-base64"),
    (error: unknown) => error instanceof CharacterVisualImageError && error.code === "invalid_image_payload",
  );
  assert.throws(
    () => decodeImageDataUrl("data:image/png;base64,***"),
    (error: unknown) => error instanceof CharacterVisualImageError && error.code === "invalid_image_payload",
  );
});
