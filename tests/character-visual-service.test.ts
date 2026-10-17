/**
 * Serviço de identidade visual: personalização, persistência e autorização.
 *
 * Critérios cobertos:
 * 1. salvar e carregar o nome de exibição;
 * 2. salvar, substituir e remover o retrato de perfil;
 * 3. cadastrar, substituir e remover imagens de estados de combate (máximo um
 *    asset ativo por estado);
 * 4. a configuração só fica pronta com a imagem obrigatória IDLE, sem quebrar
 *    personagens legados;
 * 5. IDLE é o fallback dos estados opcionais ausentes;
 * 6. uploads inválidos e excessivamente grandes são rejeitados;
 * 7. um jogador não modifica (nem lê) a personalização de outro personagem;
 * 8. os dados sobrevivem a uma "recarga" (novo serviço sobre o mesmo backing);
 * 9. personagens sem personalização continuam com manifesto utilizável.
 *
 * Os adapters usados aqui são em memória com a MESMA semântica dos adapters
 * reais (slot único, guarda de posse); os contratos de banco são cobertos
 * pelas migrations e pelo contrato de schema local.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { MesaError } from "../src/lib/mesa/store.ts";
import { verifyAssetUrlSignature } from "../src/lib/characterVisual/assetUrlSigning.ts";
import { encodeImageDataUrl } from "../src/lib/characterVisual/imageValidation.ts";
import { FALLBACK_DISPLAY_NAME } from "../src/lib/characterVisual/visualIdentity.ts";
import type {
  CharacterAssetStorage,
  CharacterVisualAssetRecord,
  CharacterVisualAssetWrite,
  CharacterVisualProfileRecord,
  CharacterVisualProfileWrite,
  CharacterVisualRepository,
  CharacterVisualStorageMode,
} from "../src/lib/characterVisual/infrastructure.ts";
import {
  CharacterVisualService,
  type VisualSlot,
} from "../src/lib/characterVisual/characterVisualServer.ts";

const OWNER = "tok-owner-0123456789abcdef";
const INTRUDER = "tok-intruder-0123456789abcdef";
const CHARACTER = "11111111-2222-4333-8444-555555555555";

// ==== (A) fixtures ====

function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function pngDataUrl(width = 64, height = 64): string {
  return encodeImageDataUrl(pngBytes(width, height), "image/png");
}

/** Repositório em memória com a semântica dos adapters reais. */
class MemoryVisualRepository implements CharacterVisualRepository {
  profiles = new Map<string, CharacterVisualProfileRecord>();
  assets = new Map<string, CharacterVisualAssetRecord>();
  private counter = 0;

  private stamp(): string {
    this.counter += 1;
    return `2026-11-01T00:00:${String(this.counter % 60).padStart(2, "0")}.000Z`;
  }

  async findProfile(characterId: string): Promise<CharacterVisualProfileRecord | null> {
    return this.profiles.get(characterId) ?? null;
  }

  async upsertProfile(input: CharacterVisualProfileWrite): Promise<CharacterVisualProfileRecord> {
    const existing = this.profiles.get(input.characterId);
    if (existing && existing.owner_token !== input.ownerToken) {
      throw new Error("slot de perfil ocupado por outro jogador");
    }
    const record: CharacterVisualProfileRecord = {
      character_id: input.characterId,
      owner_token: input.ownerToken,
      display_name: input.displayName,
      created_at: existing?.created_at ?? this.stamp(),
      updated_at: this.stamp(),
    };
    this.profiles.set(input.characterId, record);
    return record;
  }

  async listAssets(characterId: string): Promise<CharacterVisualAssetRecord[]> {
    return [...this.assets.values()].filter((asset) => asset.character_id === characterId);
  }

  async findAsset(assetId: string): Promise<CharacterVisualAssetRecord | null> {
    return this.assets.get(assetId) ?? null;
  }

  async upsertAsset(input: CharacterVisualAssetWrite): Promise<CharacterVisualAssetRecord> {
    const slot = `${input.kind}:${input.state ?? ""}`;
    const occupant = [...this.assets.values()].find(
      (asset) => asset.character_id === input.characterId && `${asset.kind}:${asset.state ?? ""}` === slot,
    );
    if (occupant && occupant.owner_token !== input.ownerToken) {
      throw new Error("slot ocupado por outro jogador");
    }
    const id = occupant?.id ?? input.id;
    const record: CharacterVisualAssetRecord = {
      id,
      character_id: input.characterId,
      owner_token: input.ownerToken,
      kind: input.kind,
      state: input.state,
      storage_mode: input.storageMode,
      storage_ref: input.storageRef,
      mime_type: input.mimeType,
      width: input.width,
      height: input.height,
      byte_size: input.byteSize,
      created_at: occupant?.created_at ?? this.stamp(),
      updated_at: this.stamp(),
    };
    this.assets.set(id, record);
    return record;
  }

  async deleteAsset(assetId: string, characterId: string): Promise<boolean> {
    const asset = this.assets.get(assetId);
    if (!asset || asset.character_id !== characterId) return false;
    this.assets.delete(assetId);
    return true;
  }
}

/** Storage em memória com a mesma interface dos adapters de arquivo/bucket. */
class MemoryAssetStorage implements CharacterAssetStorage {
  readonly mode: CharacterVisualStorageMode = "local";
  files = new Map<string, Uint8Array>();

  async put(ref: string, bytes: Uint8Array): Promise<void> {
    this.files.set(ref, new Uint8Array(bytes));
  }

  async get(ref: string): Promise<Uint8Array | null> {
    return this.files.get(ref) ?? null;
  }

  async delete(ref: string): Promise<void> {
    this.files.delete(ref);
  }
}

function setup(options: { gate?: (characterId: string, sessionId: string, token: string) => Promise<void>; maxImageBytes?: number } = {}) {
  const repository = new MemoryVisualRepository();
  const storage = new MemoryAssetStorage();
  const build = () => new CharacterVisualService({
    repository,
    storage,
    ...(options.gate ? { sessionGate: options.gate } : {}),
    maxImageBytes: options.maxImageBytes,
  });
  return { repository, storage, service: build(), build };
}

async function expectMesaError(promise: Promise<unknown>, status: number, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof MesaError, `esperava MesaError, veio ${String(error)}`);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  });
}

function assetSlotOf(identity: { states: Array<{ state: string; source: string; assetId: string | null; url: string | null }> }, state: string) {
  const slot = identity.states.find((entry) => entry.state === state);
  assert.ok(slot, `estado ${state} ausente do manifesto`);
  return slot;
}

function urlOf(identity: { states: Array<{ state: string; source: string; assetId: string | null; url: string | null }> }, state: string) {
  const slot = assetSlotOf(identity, state);
  assert.ok(slot.url, `estado ${state} sem URL no manifesto`);
  return new URL(slot.url, "http://localhost");
}

// ==== (B) nome de exibição ====

test("1. salva e carrega o nome de exibição separado do identificador", async () => {
  const { service, build } = setup();
  const saved = await service.saveDisplayName({ characterId: CHARACTER, token: OWNER, displayName: "  Sombra Neon  " });
  assert.equal(saved.displayName, "Sombra Neon");
  assert.equal(saved.characterId, CHARACTER);

  // Recarregamento: nova instância do serviço sobre o mesmo backing.
  const reloaded = await build().loadIdentity(CHARACTER, OWNER);
  assert.equal(reloaded.displayName, "Sombra Neon");

  // Nome vazio volta ao placeholder (o cliente refaz o load com o nome da
  // ficha como fallback), sem apagar o perfil.
  const cleared = await service.saveDisplayName({ characterId: CHARACTER, token: OWNER, displayName: "" });
  assert.equal(cleared.displayName, FALLBACK_DISPLAY_NAME);
  const withFallback = await build().loadIdentity(CHARACTER, OWNER, undefined, "Nome da ficha");
  assert.equal(withFallback.displayName, "Nome da ficha");
});

test("nome de exibição rejeita tipos inválidos e control characters", async () => {
  const { service } = setup();
  await expectMesaError(
    service.saveDisplayName({ characterId: CHARACTER, token: OWNER, displayName: 42 }),
    400,
    "invalid_display_name",
  );
  const long = "x".repeat(200);
  await expectMesaError(
    service.saveDisplayName({ characterId: CHARACTER, token: OWNER, displayName: long }),
    400,
    "invalid_display_name",
  );
  const withBreakline = await service.saveDisplayName({
    characterId: CHARACTER,
    token: OWNER,
    displayName: "linha1\nlinha2",
  });
  assert.equal(withBreakline.displayName, "linha1 linha2");
});

// ==== (C) retrato ====

test("2. salva, substitui e remove o retrato de perfil", async () => {
  const { service, storage, build } = setup();
  const withPortrait = await service.saveImage({
    characterId: CHARACTER,
    token: OWNER,
    slot: { kind: "portrait" },
    imageDataUrl: pngDataUrl(),
  });
  assert.ok(withPortrait.portraitUrl?.startsWith("/api/character-visual/asset/"));
  assert.ok(withPortrait.portraitAssetId);

  // Substituição: continua exatamente um retrato e o binário antigo sai.
  const firstRef = [...storage.files.keys()][0];
  const replaced = await service.saveImage({
    characterId: CHARACTER,
    token: OWNER,
    slot: { kind: "portrait" },
    imageDataUrl: pngDataUrl(96, 96),
  });
  assert.equal(replaced.portraitAssetId, withPortrait.portraitAssetId);
  assert.equal((await build().loadIdentity(CHARACTER, OWNER)).portraitAssetId, withPortrait.portraitAssetId);
  assert.equal(storage.files.has(firstRef), true, "o retrato substituído usa o mesmo slot de arquivo");
  assert.deepEqual([...storage.files.keys()].length, 1);

  // Remoção: retrato some, o resto continua.
  const removed = await service.removeImage({ characterId: CHARACTER, token: OWNER, slot: { kind: "portrait" } });
  assert.equal(removed.portraitUrl, null);
  assert.equal(removed.portraitAssetId, null);
  assert.equal((await build().loadIdentity(CHARACTER, OWNER)).portraitUrl, null);
  assert.deepEqual(storage.files.size, 0);
});

test("retrato é independente da imagem de corpo inteiro IDLE", async () => {
  const { service } = setup();
  await service.saveImage({
    characterId: CHARACTER,
    token: OWNER,
    slot: { kind: "portrait" },
    imageDataUrl: pngDataUrl(64, 64),
  });
  const identity = await service.loadIdentity(CHARACTER, OWNER);
  assert.ok(identity.portraitUrl, "retrato salvo");
  // Sem IDLE configurada, o retrato NÃO vira representação no mapa.
  assert.equal(identity.hasIdle, false);
  assert.equal(assetSlotOf(identity, "ATTACK").source, "generic-fallback");
});

// ==== (D) estados de combate ====

test("3. cadastra, substitui e remove imagens de estados com um asset por slot", async () => {
  const { service, repository, storage } = setup();
  await service.saveImage({
    characterId: CHARACTER, token: OWNER, slot: { kind: "combat_state", state: "IDLE" }, imageDataUrl: pngDataUrl(),
  });
  const withAttack = await service.saveImage({
    characterId: CHARACTER, token: OWNER, slot: { kind: "combat_state", state: "ATTACK" }, imageDataUrl: pngDataUrl(80, 80),
  });
  assert.deepEqual([...withAttack.configuredStates].sort(), ["ATTACK", "IDLE"]);
  const idleSlot = assetSlotOf(withAttack, "IDLE");
  const attackSlot = assetSlotOf(withAttack, "ATTACK");
  assert.equal(idleSlot.source, "state");
  assert.equal(attackSlot.source, "state");
  assert.notEqual(idleSlot.assetId, attackSlot.assetId);
  assert.deepEqual([...repository.assets.keys()].length, 2);
  assert.deepEqual(storage.files.size, 2);

  // Substituição do ATTACK mantém o slot (1 linha, 1 arquivo por estado).
  const attackAssetId = attackSlot.assetId;
  const replaced = await service.saveImage({
    characterId: CHARACTER, token: OWNER, slot: { kind: "combat_state", state: "ATTACK" }, imageDataUrl: pngDataUrl(120, 120),
  });
  assert.equal(assetSlotOf(replaced, "ATTACK").assetId, attackAssetId);
  assert.deepEqual([...repository.assets.keys()].length, 2);
  assert.deepEqual(storage.files.size, 2);

  // Remoção opcional: ATTACK some e usa fallback IDLE; IDLE permanece.
  const removed = await service.removeImage({
    characterId: CHARACTER, token: OWNER, slot: { kind: "combat_state", state: "ATTACK" },
  });
  const removedSlot = assetSlotOf(removed, "ATTACK");
  assert.equal(removedSlot.source, "idle-fallback");
  assert.equal(removedSlot.assetId, idleSlot.assetId);
  assert.deepEqual([...removed.configuredStates], ["IDLE"]);
  assert.deepEqual(storage.files.size, 1);

  // Remover algo inexistente é idempotente.
  const again = await service.removeImage({
    characterId: CHARACTER, token: OWNER, slot: { kind: "combat_state", state: "DEATH" },
  });
  assert.deepEqual([...again.configuredStates], ["IDLE"]);
});

test("estado visual inválido é rejeitado no servidor", async () => {
  const { service } = setup();
  await expectMesaError(
    service.saveImage({
      characterId: CHARACTER,
      token: OWNER,
      slot: { kind: "combat_state", state: "FLYING" } as unknown as VisualSlot,
      imageDataUrl: pngDataUrl(),
    }),
    400,
    "invalid_visual_state",
  );
});

// ==== (E) obrigatório IDLE / legado ====

test("4. configuração sem IDLE fica incompleta; personagem legado não quebra", async () => {
  const { service, build } = setup();
  // Legado: nada cadastrado.
  const legacy = await build().loadIdentity(CHARACTER, OWNER, undefined, "Legado");
  assert.equal(legacy.completion.ready, false);
  assert.deepEqual([...legacy.completion.missingRequired], ["IDLE"]);
  assert.equal(legacy.displayName, "Legado");
  assert.equal(legacy.states.length, 10);

  // Salvando só um estado opcional, a configuração continua incompleta.
  const partial = await service.saveImage({
    characterId: CHARACTER, token: OWNER, slot: { kind: "combat_state", state: "SHOOT" }, imageDataUrl: pngDataUrl(),
  });
  assert.equal(partial.completion.ready, false);
  assert.deepEqual([...partial.completion.missingRequired], ["IDLE"]);

  // Com IDLE, a configuração fica pronta.
  const ready = await service.saveImage({
    characterId: CHARACTER, token: OWNER, slot: { kind: "combat_state", state: "IDLE" }, imageDataUrl: pngDataUrl(),
  });
  assert.equal(ready.completion.ready, true);
  assert.deepEqual([...ready.completion.missingRequired], []);
});

test("5. IDLE é o fallback dos estados opcionais no manifesto do servidor", async () => {
  const { service } = setup();
  await service.saveImage({
    characterId: CHARACTER, token: OWNER, slot: { kind: "combat_state", state: "IDLE" }, imageDataUrl: pngDataUrl(),
  });
  const identity = await service.loadIdentity(CHARACTER, OWNER);
  for (const state of ["ATTACK", "DODGE", "HIT", "RELOAD"]) {
    const slot = assetSlotOf(identity, state);
    assert.equal(slot.source, "idle-fallback", `${state} deveria cair na IDLE`);
    assert.equal(slot.assetId, assetSlotOf(identity, "IDLE").assetId);
  }
  assert.equal(assetSlotOf(identity, "IDLE").source, "state");
});

// ==== (F) uploads inválidos ====

test("6. rejeita uploads inválidos, com MIME mentiroso e excessivamente grandes", async () => {
  const { service, repository } = setup({ maxImageBytes: 500 });
  await expectMesaError(
    service.saveImage({ characterId: CHARACTER, token: OWNER, slot: { kind: "portrait" }, imageDataUrl: "https://x/img.png" }),
    400,
    "invalid_visual_image",
  );
  await expectMesaError(
    service.saveImage({ characterId: CHARACTER, token: OWNER, slot: { kind: "portrait" }, imageDataUrl: null }),
    400,
    "invalid_visual_image",
  );
  // PNG real declarado como JPEG: conteúdo manda.
  await expectMesaError(
    service.saveImage({
      characterId: CHARACTER,
      token: OWNER,
      slot: { kind: "portrait" },
      imageDataUrl: pngDataUrl().replace("image/png", "image/jpeg"),
    }),
    400,
    "invalid_visual_image",
  );
  // Limite de bytes configurável (PNG válido, mas acima de 500 bytes).
  const oversized = new Uint8Array(600);
  oversized.set(pngBytes(64, 64));
  await expectMesaError(
    service.saveImage({
      characterId: CHARACTER,
      token: OWNER,
      slot: { kind: "portrait" },
      imageDataUrl: encodeImageDataUrl(oversized, "image/png"),
    }),
    413,
    "visual_image_too_large",
  );
  // Nada foi persistido por nenhum dos rejeitados.
  assert.deepEqual(repository.assets.size, 0);
});

// ==== (G) autorização ====

test("7. impede que um jogador modifique ou leia a personalização de outro", async () => {
  const { service, build } = setup();
  await service.saveDisplayName({ characterId: CHARACTER, token: OWNER, displayName: "Dona" });
  await service.saveImage({
    characterId: CHARACTER, token: OWNER, slot: { kind: "combat_state", state: "IDLE" }, imageDataUrl: pngDataUrl(),
  });

  await expectMesaError(
    service.saveDisplayName({ characterId: CHARACTER, token: INTRUDER, displayName: "Intruso" }),
    403,
    "character_owner_mismatch",
  );
  await expectMesaError(
    service.saveImage({
      characterId: CHARACTER, token: INTRUDER, slot: { kind: "combat_state", state: "ATTACK" }, imageDataUrl: pngDataUrl(),
    }),
    403,
    "character_owner_mismatch",
  );
  await expectMesaError(
    service.removeImage({ characterId: CHARACTER, token: INTRUDER, slot: { kind: "combat_state", state: "IDLE" } }),
    403,
    "character_owner_mismatch",
  );
  // Leitura sem vínculo de Mesa também é negada.
  await expectMesaError(service.loadIdentity(CHARACTER, INTRUDER), 403, "character_owner_mismatch");
  // O dono continua intacto.
  const ownerView = await build().loadIdentity(CHARACTER, OWNER);
  assert.equal(ownerView.displayName, "Dona");
  assert.equal(assetSlotOf(ownerView, "IDLE").source, "state");
});

test("leitura por Mesa exige o gate de participação configurado e aprovado", async () => {
  const denied = setup();
  await denied.service.saveDisplayName({ characterId: CHARACTER, token: OWNER, displayName: "Dona" });
  // Com sessionId mas sem gate (outra mesa): negado.
  await expectMesaError(denied.service.loadIdentity(CHARACTER, INTRUDER, "sessão-1"), 403, "visual_read_denied");

  let gateCalls = 0;
  const allowed = setup({
    gate: async () => {
      gateCalls += 1;
    },
  });
  await allowed.service.saveDisplayName({ characterId: CHARACTER, token: OWNER, displayName: "Dona" });
  const teammateView = await allowed.service.loadIdentity(CHARACTER, INTRUDER, "sessão-1");
  assert.equal(teammateView.displayName, "Dona");
  assert.equal(gateCalls, 1);

  const rejected = setup({
    gate: async () => {
      throw new MesaError("Este personagem não participa da mesa informada.", 403, "visual_not_in_session");
    },
  });
  await rejected.service.saveDisplayName({ characterId: CHARACTER, token: OWNER, displayName: "Dona" });
  await expectMesaError(rejected.service.loadIdentity(CHARACTER, INTRUDER, "sessão-2"), 403, "visual_not_in_session");
});

test("token ausente ou curto é recusado antes de qualquer leitura/escrita", async () => {
  const { service } = setup();
  await expectMesaError(service.loadIdentity(CHARACTER, undefined), 401, "missing_token");
  await expectMesaError(service.saveDisplayName({ characterId: CHARACTER, token: "curto", displayName: "x" }), 401, "missing_token");
  await expectMesaError(service.loadIdentity("", OWNER), 400, "invalid_character_id");
});

// ==== (H) URLs assinadas e recarga ====

test("manifesto usa URLs assinadas que expiram e resistem a adulteração", async () => {
  let clock = Date.parse("2026-11-01T00:00:00.000Z");
  const repository = new MemoryVisualRepository();
  const storage = new MemoryAssetStorage();
  const service = new CharacterVisualService({ repository, storage, now: () => clock, maxImageBytes: 2_000_000 });
  const identity = await service.saveImage({
    characterId: CHARACTER, token: OWNER, slot: { kind: "combat_state", state: "IDLE" }, imageDataUrl: pngDataUrl(),
  });
  const url = urlOf(identity, "IDLE");
  assert.equal(url.pathname, `/api/character-visual/asset/${assetSlotOf(identity, "IDLE").assetId}`);

  const assetId = assetSlotOf(identity, "IDLE").assetId as string;
  const params = url.searchParams;
  // Assinatura válida lê o binário exatamente como foi gravado.
  const read = await service.readAsset(assetId, params.get("e"), params.get("s"));
  assert.deepEqual(read.bytes, pngBytes(64, 64));
  assert.equal(read.mimeType, "image/png");

  // Adulteração e expiração são recusadas.
  await expectMesaError(service.readAsset(assetId, params.get("e"), "f".repeat(64)), 403, "invalid_asset_signature");
  await expectMesaError(service.readAsset(assetId, null, params.get("s")), 403, "invalid_asset_signature");
  clock += 25 * 60 * 60 * 1000;
  await expectMesaError(service.readAsset(assetId, params.get("e"), params.get("s")), 403, "invalid_asset_signature");
  assert.equal(verifyAssetUrlSignature(assetId, OWNER, params.get("e"), params.get("s"), clock), false);
  await expectMesaError(service.readAsset("asset-inexistente", params.get("e"), params.get("s")), 404, "asset_not_found");
});

test("8. persistência: nova instância do serviço recarrega tudo do backing", async () => {
  const { service, build } = setup();
  await service.saveDisplayName({ characterId: CHARACTER, token: OWNER, displayName: "Recarregável" });
  await service.saveImage({ characterId: CHARACTER, token: OWNER, slot: { kind: "portrait" }, imageDataUrl: pngDataUrl() });
  await service.saveImage({
    characterId: CHARACTER, token: OWNER, slot: { kind: "combat_state", state: "IDLE" }, imageDataUrl: pngDataUrl(72, 72),
  });
  await service.saveImage({
    characterId: CHARACTER, token: OWNER, slot: { kind: "combat_state", state: "DODGE" }, imageDataUrl: pngDataUrl(88, 88),
  });

  const reloaded = build();
  const identity = await reloaded.loadIdentity(CHARACTER, OWNER);
  assert.equal(identity.displayName, "Recarregável");
  assert.ok(identity.portraitUrl);
  assert.equal(assetSlotOf(identity, "IDLE").source, "state");
  assert.equal(assetSlotOf(identity, "DODGE").source, "state");
  assert.equal(assetSlotOf(identity, "SHOOT").source, "idle-fallback");
  // Os binários continuam legíveis após a "recarga".
  const url = urlOf(identity, "IDLE");
  const read = await reloaded.readAsset(assetSlotOf(identity, "IDLE").assetId, url.searchParams.get("e"), url.searchParams.get("s"));
  assert.deepEqual(read.bytes, pngBytes(72, 72));
});

// ==== (I) personagens sem personalização no combate ====

test("9. personagem sem personalização mantém manifesto genérico utilizável", async () => {
  const { service } = setup();
  const identity = await service.loadIdentity("22222222-3333-4444-8555-666666666666", OWNER, undefined, "Sem Visual");
  assert.equal(identity.displayName, "Sem Visual");
  assert.equal(identity.portraitUrl, null);
  assert.equal(identity.completion.ready, false);
  assert.equal(identity.states.length, 10, "todos os estados seguem consultáveis");
  for (const state of identity.states) {
    assert.equal(state.url, null);
    assert.equal(state.source, "generic-fallback");
  }
});
