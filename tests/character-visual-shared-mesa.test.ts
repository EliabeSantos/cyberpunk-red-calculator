/**
 * Mesa compartilhada: leitura por participantes e escrita sincronizada.
 *
 * Critérios cobertos (roteiro de compartilhamento de imagens):
 * A. Jogador A envia a imagem; jogador B, autorizado na MESMA mesa (gate de
 *    leitura com `sessionId`), carrega o manifesto e o arquivo assinado.
 * B. B sem `sessionId` continua negado (caminho do dono puro).
 * C. B com `sessionId` de mesa onde o personagem NÃO vincula → negado.
 * D. Escrita sincronizada (push com `sessionId`): o DONO vinculado grava;
 *    um participante comum NÃO grava a imagem de outro jogador — e o perfil
 *    do personagem NÃO é criado pelo não-dono (nada de sequestro de posse).
 * E. Sem gate de escrita configurado, o push é negado (nunca fallback
 *    silencioso para o caminho do dono puro).
 * F. O dono sem `sessionId` continua editando/removendo como antes.
 *
 * Os gates aqui são stubs com a MESMA semântica dos gates reais
 * (`createMesaSessionReadGate`/`createMesaSessionWriteGate`): autenticação da
 * sessão + vínculo do personagem; os gates reais com banco são cobertos pelo
 * teste ponta a ponta com PostgreSQL.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { MesaError } from "../src/lib/mesa/store.ts";
import { encodeImageDataUrl } from "../src/lib/characterVisual/imageValidation.ts";
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
  type CharacterVisualSessionGate,
} from "../src/lib/characterVisual/characterVisualServer.ts";

const OWNER = "tok-owner-0123456789abcdef";
const OBSERVER = "tok-observer-0123456789abcdef";
const CHARACTER = "11111111-2222-4333-8444-555555555555";
const SESSION = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER_SESSION = "ffffffff-1111-4222-8333-444444444444";

// ==== fixtures (mesma semântica dos adapters reais) ====

function pngDataUrl(width = 64, height = 64): string {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return encodeImageDataUrl(bytes, "image/png");
}

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

/**
 * Mundo de mesas em memória: sessão → token do participante → personagem
 * vinculado. Os gates espelham a semântica dos reais (leitura: qualquer
 * participante da sessão com o personagem vinculado; escrita: só o próprio
 * participante cujo vínculo aponta para o personagem).
 */
function gatesOf(world: { sessions: Map<string, Map<string, string | null>> }) {
  const actorOf = (sessionId: string, token: string): { linked: string | null } => {
    const participants = world.sessions.get(sessionId);
    if (!participants) {
      throw new MesaError("Mesa não encontrada.", 404, "session_not_found");
    }
    if (!participants.has(token)) {
      // Mesma precedência do `authenticate` real: sessão existe, mas o token
      // não é participante dela.
      throw new MesaError("Você não participa desta mesa.", 403, "not_participant");
    }
    return { linked: participants.get(token) ?? null };
  };
  const readGate: CharacterVisualSessionGate = async (characterId, sessionId, token) => {
    const actor = actorOf(sessionId, token);
    if (actor.linked === characterId) return;
    const participants = world.sessions.get(sessionId);
    const linked = [...(participants?.values() ?? [])].includes(characterId);
    if (!linked) {
      throw new MesaError("Este personagem não participa da mesa informada.", 403, "visual_not_in_session");
    }
  };
  const writeGate: CharacterVisualSessionGate = async (characterId, sessionId, token) => {
    const actor = actorOf(sessionId, token);
    if (actor.linked !== characterId) {
      throw new MesaError(
        "Apenas o participante que vinculou este personagem pode sincronizar a identidade visual.",
        403,
        "visual_write_not_linked",
      );
    }
  };
  return { readGate, writeGate };
}

function setup(options: { world?: boolean; withWriteGate?: boolean } = {}) {
  const repository = new MemoryVisualRepository();
  const storage = new MemoryAssetStorage();
  const world = {
    sessions: new Map<string, Map<string, string | null>>([
      // OWNER é o participante dono do personagem na sessão principal; o
      // OBSERVER participa da mesma sessão sem vincular o personagem.
      [SESSION, new Map<string, string | null>([[OWNER, CHARACTER], [OBSERVER, null]])],
      [OTHER_SESSION, new Map<string, string | null>([[OBSERVER, null]])],
    ]),
  };
  const gates = gatesOf(world);
  const service = new CharacterVisualService({
    repository,
    storage,
    ...(options.world === false ? {} : { sessionGate: gates.readGate }),
    ...(options.world === false || options.withWriteGate === false
      ? {}
      : { sessionWriteGate: gates.writeGate }),
    maxImageBytes: 1_000_000,
  });
  return { repository, storage, service, world };
}

async function expectMesaError(promise: Promise<unknown>, status: number, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof MesaError, `esperava MesaError, veio ${String(error)}`);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  });
}

// ==== A. Participante autorizado lê manifesto + arquivo ====

test("A. B (autorizado na mesma mesa) lê o manifesto e o arquivo da imagem de A", async () => {
  const { service, storage } = setup();
  await service.saveImage({ characterId: CHARACTER, token: OWNER, slot: { kind: "portrait" }, imageDataUrl: pngDataUrl() });

  const identity = await service.loadIdentity(CHARACTER, OBSERVER, SESSION);
  assert.ok(identity.portraitUrl, "participante não recebeu URL do retrato");
  assert.ok(identity.portraitAssetId, "participante não recebeu o id do asset");

  // A URL assinada entrega o MESMO binário para o observador.
  const match = identity.portraitUrl!.match(/\/api\/character-visual\/asset\/([^?]+)\?(.*)$/);
  assert.ok(match, `URL inesperada: ${identity.portraitUrl}`);
  const [, assetId, query] = match;
  const params = new URLSearchParams(query);
  const asset = await service.readAsset(assetId, params.get("e"), params.get("s"));
  assert.equal(asset.mimeType, "image/png");
  assert.ok(storage.files.size === 1, "arquivo deveria existir no armazenamento");
  assert.equal(asset.bytes.length > 0, true);
});

// ==== B. Sem sessionId continua negado ====

test("B. B sem sessionId não lê a personalização de A (caminho do dono)", async () => {
  const { service } = setup();
  await service.saveImage({ characterId: CHARACTER, token: OWNER, slot: { kind: "portrait" }, imageDataUrl: pngDataUrl() });
  await expectMesaError(service.loadIdentity(CHARACTER, OBSERVER), 403, "character_owner_mismatch");
});

// ==== C. Personagem de OUTRA mesa ====

test("C. B com sessionId de mesa onde o personagem não vincula é negado", async () => {
  const { service } = setup();
  await service.saveImage({ characterId: CHARACTER, token: OWNER, slot: { kind: "portrait" }, imageDataUrl: pngDataUrl() });
  await expectMesaError(service.loadIdentity(CHARACTER, OBSERVER, OTHER_SESSION), 403, "visual_not_in_session");
});

// ==== D. Escrita sincronizada ====

test("D1. dono vinculado sincroniza nome, imagem e remoção com sessionId", async () => {
  const { service, repository } = setup();

  const named = await service.saveDisplayName({
    characterId: CHARACTER,
    token: OWNER,
    displayName: "V",
    sessionId: SESSION,
  });
  assert.equal(named.displayName, "V");

  const withPortrait = await service.saveImage({
    characterId: CHARACTER,
    token: OWNER,
    slot: { kind: "portrait" },
    imageDataUrl: pngDataUrl(),
    sessionId: SESSION,
  });
  assert.ok(withPortrait.portraitUrl);

  const withIdle = await service.saveImage({
    characterId: CHARACTER,
    token: OWNER,
    slot: { kind: "combat_state", state: "IDLE" },
    imageDataUrl: pngDataUrl(32, 32),
    sessionId: SESSION,
  });
  assert.ok(withIdle.hasIdle);

  const removed = await service.removeImage({
    characterId: CHARACTER,
    token: OWNER,
    slot: { kind: "combat_state", state: "IDLE" },
    sessionId: SESSION,
  });
  assert.equal(removed.hasIdle, false);
  assert.ok(repository.assets.size === 1, "só o retrato deve restar");
});

test("D2. participante comum não escreve a imagem de A — e o perfil não é criado pelo intruso", async () => {
  const { service, repository } = setup();

  // Intruso tenta PUSH para a sessão: gate de escrita nega o vínculo.
  await expectMesaError(
    service.saveImage({
      characterId: CHARACTER,
      token: OBSERVER,
      slot: { kind: "portrait" },
      imageDataUrl: pngDataUrl(),
      sessionId: SESSION,
    }),
    403,
    "visual_write_not_linked",
  );
  // Nada de sequestro: o não-dono não pode nascer como dono do perfil.
  assert.equal(repository.profiles.size, 0, "perfil não pode ser criado por quem não vincula o personagem");
  assert.equal(repository.assets.size, 0);

  // Remoção e nome também negados pelo vínculo (o gate de escrita roda antes
  // de qualquer escrita — inclusive quando o perfil ainda não existe).
  await expectMesaError(
    service.removeImage({ characterId: CHARACTER, token: OBSERVER, slot: { kind: "portrait" }, sessionId: SESSION }),
    403,
    "visual_write_not_linked",
  );
  await expectMesaError(
    service.saveDisplayName({ characterId: CHARACTER, token: OBSERVER, displayName: "hack", sessionId: SESSION }),
    403,
    "visual_write_not_linked",
  );
});

test("D3. dono de outro personagem não sincroniza para a sessão alheia", async () => {
  const { service } = setup();
  // OWNER tenta usar o sessionId de OUTRA sessão (não é participante dela).
  await expectMesaError(
    service.saveImage({
      characterId: CHARACTER,
      token: OWNER,
      slot: { kind: "portrait" },
      imageDataUrl: pngDataUrl(),
      sessionId: OTHER_SESSION,
    }),
    403,
    "not_participant",
  );
});

// ==== E. Sem gate de escrita configurado: nega, nunca fallback ====

test("E. sessionId sem sessionWriteGate configurado nega a escrita (visual_write_denied)", async () => {
  const { service, repository } = setup({ withWriteGate: false });
  await expectMesaError(
    service.saveImage({
      characterId: CHARACTER,
      token: OWNER,
      slot: { kind: "portrait" },
      imageDataUrl: pngDataUrl(),
      sessionId: SESSION,
    }),
    403,
    "visual_write_denied",
  );
  assert.equal(repository.profiles.size, 0);
});

// ==== F. Caminho do dono puro preservado ====

test("F. dono continua editando e removendo sem sessionId (fluxo da ficha)", async () => {
  const { service } = setup();
  const saved = await service.saveImage({
    characterId: CHARACTER,
    token: OWNER,
    slot: { kind: "combat_state", state: "ATTACK" },
    imageDataUrl: pngDataUrl(),
  });
  assert.ok(saved.states.some((entry) => entry.state === "ATTACK" && entry.url));
  const removed = await service.removeImage({
    characterId: CHARACTER,
    token: OWNER,
    slot: { kind: "combat_state", state: "ATTACK" },
  });
  assert.ok(removed.states.every((entry) => entry.state !== "ATTACK" || !entry.url));
});
