"use client";

/**
 * Leitura de imagem escolhida pelo jogador (SOMENTE navegador).
 *
 * Valida o CONTEÚDO do arquivo com o mesmo módulo do servidor (magic bytes +
 * dimensões) antes de qualquer envio; os bytes são preservados como chegaram
 * (PNG/WebP com alfa intactos, sem conversão automática para JPEG).
 */

import {
  CharacterVisualImageError,
  configuredMaxImageBytes,
  decodeImageDataUrl,
  encodeImageDataUrl,
  validateImageBytes,
  type ValidatedImage,
} from "@/lib/characterVisual/imageValidation";

export interface SelectedVisualImage {
  dataUrl: string;
  bytes: Uint8Array;
  validated: ValidatedImage;
}

/** Converte um `File`/`Blob` de imagem em data URL validado. */
export async function readImageFileAsDataUrl(
  file: Blob,
  maxBytes: number = configuredMaxImageBytes(),
): Promise<SelectedVisualImage> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const validated = validateImageBytes(bytes, {
    maxBytes,
    declaredMimeType: typeof file.type === "string" && file.type.length > 0 ? file.type : undefined,
  });
  const dataUrl = encodeImageDataUrl(bytes, validated.mimeType);
  // Sanidade: o data URL que vai subir precisa decodificar de volta.
  const roundtrip = decodeImageDataUrl(dataUrl);
  if (roundtrip.bytes.length !== bytes.length) {
    throw new CharacterVisualImageError("invalid_image_payload", "Não foi possível preparar a imagem para envio.");
  }
  return { dataUrl, bytes, validated };
}
