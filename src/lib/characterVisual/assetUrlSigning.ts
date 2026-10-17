/**
 * URLs assinadas de curta duração para os binários da identidade visual
 * (SOMENTE servidor).
 *
 * As rotas `/api/elementos` da Mesa proíbem o player token em query string ou
 * URL; imagens, porém, precisam ser carregáveis por tags `<img>`, que não
 * enviam headers customizados. A solução é a mesma adotada por CDNs e pelo
 * Supabase Storage: uma assinatura HMAC-SHA256 de uso limitado.
 *
 * A chave deriva do `owner_token` persistido no próprio asset — portanto não
 * existe novo segredo de ambiente, a assinatura continua válida após reiniciar
 * o aplicativo e quem tem a URL não obtém o token. A verificação usa
 * comparação em tempo constante e valida o expirado.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const ASSET_URL_TTL_MS = 24 * 60 * 60 * 1000;

export function assetSigningKey(ownerToken: string): Buffer {
  return createHash("sha256").update(ownerToken, "utf8").digest();
}

function signatureFor(assetId: string, expiresAt: number, key: Buffer): string {
  return createHmac("sha256", key).update(`${assetId}:${expiresAt}`, "utf8").digest("hex");
}

/** Gera `/api/character-visual/asset/<id>?e=<exp>&s=<assinatura>`. */
export function signAssetUrl(assetId: string, ownerToken: string, now: number = Date.now()): string {
  const expiresAt = Math.floor((now + ASSET_URL_TTL_MS) / 1000);
  const signature = signatureFor(assetId, expiresAt, assetSigningKey(ownerToken));
  return `/api/character-visual/asset/${encodeURIComponent(assetId)}?e=${expiresAt}&s=${signature}`;
}

/** Verifica assinatura e expiração; `false` em qualquer tentativa de adulteração. */
export function verifyAssetUrlSignature(
  assetId: string,
  ownerToken: string,
  expiresRaw: string | null | undefined,
  signatureRaw: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (typeof expiresRaw !== "string" || typeof signatureRaw !== "string") return false;
  const expiresAt = Number.parseInt(expiresRaw, 10);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < now) return false;
  const expected = signatureFor(assetId, expiresAt, assetSigningKey(ownerToken));
  if (!/^[0-9a-f]+$/i.test(signatureRaw) || expected.length !== signatureRaw.length) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signatureRaw, "hex"));
}
