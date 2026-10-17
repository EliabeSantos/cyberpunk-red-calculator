/**
 * Storage local de arquivos da identidade visual (modo PostgreSQL local/Electron).
 *
 * Critérios:
 * - resolução do raiz persistente (`MESA_ASSETS_DIR` > `MESA_DATA_DIR/assets` >
 *   `<cwd>/.local/assets`) — nada de diretório temporário nem de instalação;
 * - escrita atômica com permissão restrita;
 * - roundtrip get/put/delete e remoção idempotente;
 * - refs fora do padrão (traversal, caminho absoluto) são recusados.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  LocalFileAssetStorage,
  resolveLocalAssetsRoot,
} from "../src/lib/characterVisual/localAssetStorage.ts";
import { makeCharacterAssetRef } from "../src/lib/characterVisual/infrastructure.ts";

const CHARACTER = "11111111-2222-4333-8444-555555555555";

test("raiz persistente segue a precedência MESA_ASSETS_DIR > MESA_DATA_DIR > .local", () => {
  assert.equal(
    resolveLocalAssetsRoot({ MESA_ASSETS_DIR: "/data/visual", MESA_DATA_DIR: "/data/host" }, "/repo"),
    resolve("/data/visual"),
  );
  assert.equal(
    resolveLocalAssetsRoot({ MESA_DATA_DIR: "/data/host" }, "/repo"),
    resolve("/data/host", "assets"),
  );
  assert.equal(
    resolveLocalAssetsRoot({}, "/repo"),
    resolve("/repo", ".local", "assets"),
  );
});

test("roundtrip de arquivo persistente com permissão restrita e delete idempotente", async () => {
  const root = await mkdtemp(join(tmpdir(), "cyberpunk-visual-"));
  try {
    const storage = new LocalFileAssetStorage(root);
    const ref = makeCharacterAssetRef(CHARACTER, "asset-0000-0000", "png");
    const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    await storage.put(ref, bytes);

    // O arquivo vive sob o root, no caminho controlado pelo servidor.
    const onDisk = await readFile(join(root, ref));
    assert.deepEqual(new Uint8Array(onDisk), bytes);

    const fetched = await storage.get(ref);
    assert.deepEqual(fetched, bytes);

    // Mesma referência sobrevive a um "reinício" (novo storage, mesmo raiz).
    const reloaded = new LocalFileAssetStorage(root);
    assert.deepEqual(await reloaded.get(ref), bytes);

    await reloaded.delete(ref);
    assert.equal(await reloaded.get(ref), null);
    await reloaded.delete(ref); // segunda remoção não explode
    assert.deepEqual(await readdir(join(root, CHARACTER)), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refs com traversal ou formato inseguro são recusados pelo storage", async () => {
  const root = await mkdtemp(join(tmpdir(), "cyberpunk-visual-"));
  try {
    const storage = new LocalFileAssetStorage(root);
    const traversal = `${CHARACTER}/../../escape.png`;
    await assert.rejects(() => storage.put(traversal, Uint8Array.from([1])));
    await assert.rejects(() => storage.get("../fora.png"));
    await assert.rejects(() => storage.get(`/absoluto/${CHARACTER}/a.png`));
    await assert.rejects(() => storage.get(`${CHARACTER}/a.txt`));
    await assert.rejects(() => storage.get("sem-pasta.png"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("makeCharacterAssetRef só aceita ids seguros para compor caminhos", () => {
  assert.equal(
    makeCharacterAssetRef(CHARACTER, "asset-1", "jpg"),
    `${CHARACTER}/asset-1.jpg`,
  );
  assert.throws(() => makeCharacterAssetRef("../fora", "asset-1", "png"));
  assert.throws(() => makeCharacterAssetRef(CHARACTER, "../asset-1", "png"));
  assert.throws(() => makeCharacterAssetRef(CHARACTER, "pasta/asset-1", "png"));
});
