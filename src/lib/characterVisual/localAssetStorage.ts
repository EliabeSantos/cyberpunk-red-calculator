/**
 * Storage local de arquivos da identidade visual (modo `local`).
 *
 * Raiz persistente, em ordem de precedência:
 *
 * 1. `MESA_ASSETS_DIR` — override explícito do host;
 * 2. `<MESA_DATA_DIR>/assets` — no Electron o `desktop/main.cjs` define
 *    `MESA_DATA_DIR` como `%ProgramData%\Cyberpunk RED Calculator` (ou
 *    `%LOCALAPPDATA%` em instalação por usuário), e o bootstrap do Windows
 *    já usa esse diretório para `config/`, `logs/` e `postgres/`;
 * 3. `<cwd>/.local/assets` — fallback de desenvolvimento (`.local/` já é
 *    gitignorado e abriga o cluster PostgreSQL do dev).
 *
 * Nada é gravado em diretório temporário nem no diretório de instalação do
 * aplicativo: os arquivos sobrevivem a atualizações e reinícios.
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import { isSafeCharacterAssetRef, type CharacterAssetStorage } from "@/lib/characterVisual/infrastructure";

export function resolveLocalAssetsRoot(
  env: Readonly<Record<string, string | undefined>> = process.env,
  cwd: string = process.cwd(),
): string {
  const explicit = env.MESA_ASSETS_DIR?.trim();
  if (explicit) return resolve(explicit);
  const dataDir = env.MESA_DATA_DIR?.trim();
  if (dataDir) return resolve(dataDir, "assets");
  return resolve(cwd, ".local", "assets");
}

function safePath(root: string, ref: string): string {
  if (!isSafeCharacterAssetRef(ref)) throw new Error(`ref de asset inválido: ${ref}`);
  const full = resolve(root, ref);
  // Defesa extra: o caminho resolvido precisa permanecer sob o root mesmo se
  // a validação de formato evoluir de forma permissiva no futuro.
  if (!full.startsWith(root.endsWith(sep) ? root : root + sep)) {
    throw new Error(`ref de asset fora do root: ${ref}`);
  }
  return full;
}

export class LocalFileAssetStorage implements CharacterAssetStorage {
  readonly mode = "local" as const;
  private readonly root: string;

  constructor(root: string = resolveLocalAssetsRoot()) {
    this.root = resolve(root);
  }

  // O modo local não distingue MIME no disco: o tipo é servido a partir da
  // linha do banco (`mime_type`), e a extensão já vem validada no ref.
  async put(ref: string, bytes: Uint8Array): Promise<void> {
    const full = safePath(this.root, ref);
    await mkdir(dirname(full), { recursive: true });
    // Escrita atômica: arquivo temporário no MESMO diretório + rename. Um
    // crash no meio nunca deixa um asset parcialmente escrito.
    const temporary = `${full}.upload-${process.pid}-${Date.now()}`;
    try {
      await writeFile(temporary, bytes, { mode: 0o600 });
      await rename(temporary, full);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async get(ref: string): Promise<Uint8Array | null> {
    const full = safePath(this.root, ref);
    try {
      return new Uint8Array(await readFile(full));
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(ref: string): Promise<void> {
    const full = safePath(this.root, ref);
    await rm(full, { force: true });
  }
}
