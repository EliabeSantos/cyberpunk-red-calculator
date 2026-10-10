import { createMesaHostingInfrastructure } from "@/lib/mesa/hostingInfrastructure";
import { authenticate, requireGM, MesaError } from "@/lib/mesa/store";
import type { ToolkitRecord, ToolkitRecordKind } from "@/lib/mesa/infrastructure";

const KINDS = new Set<ToolkitRecordKind>(["character", "enemy", "encounter"]);
const MAX_PAYLOAD_BYTES = 1_500_000;

export function toolkitKind(value: unknown): ToolkitRecordKind {
  if (typeof value !== "string" || !KINDS.has(value as ToolkitRecordKind)) {
    throw new MesaError("Tipo de registro inválido.", 400, "invalid_toolkit_kind");
  }
  return value as ToolkitRecordKind;
}

function ownerToken(token: unknown): string {
  if (typeof token !== "string" || token.length < 16 || token.length > 512) {
    throw new MesaError("Credencial ausente.", 401, "missing_token");
  }
  return token;
}

export function validateToolkitPayload(kind: ToolkitRecordKind, payload: unknown): Record<string, unknown> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new MesaError("Registro inválido.", 400, "invalid_toolkit_record");
  }
  const value = payload as Record<string, unknown>;
  if (typeof value.id !== "string" || value.id.length < 1 || value.id.length > 200) {
    throw new MesaError("O registro precisa de um ID estável.", 400, "invalid_toolkit_record");
  }
  if (kind === "character" && value.schemaVersion !== 2) throw new MesaError("Versão de personagem não suportada.", 400, "unsupported_toolkit_version");
  if (kind === "enemy" && value.schemaVersion !== 1) throw new MesaError("Versão de inimigo não suportada.", 400, "unsupported_toolkit_version");
  if (kind === "encounter" && !Array.isArray(value.participants)) throw new MesaError("Encontro inválido.", 400, "invalid_toolkit_record");
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_PAYLOAD_BYTES) throw new MesaError("Registro grande demais.", 413, "toolkit_record_too_large");
  return value;
}

export async function listToolkit(kind: ToolkitRecordKind, token: unknown, sessionId?: unknown): Promise<ToolkitRecord[]> {
  const infrastructure = await createMesaHostingInfrastructure();
  const owner = kind === "character" ? ownerToken(token) : await gmOwner(sessionId, token);
  return infrastructure.toolkitRepository.listToolkitRecords(owner, kind);
}

export async function saveToolkit(input: {
  kind: ToolkitRecordKind; token: unknown; sessionId?: unknown; id: string; name: string;
  payload: unknown; expectedVersion?: number; importIfAbsent?: boolean;
}): Promise<ToolkitRecord> {
  const payload = validateToolkitPayload(input.kind, input.payload);
  if (payload.id !== input.id) throw new MesaError("O ID do payload não corresponde ao registro.", 400, "invalid_toolkit_record");
  if (!input.name.trim() || input.name.length > 200) throw new MesaError("Nome de registro inválido.", 400, "invalid_toolkit_record");
  const infrastructure = await createMesaHostingInfrastructure();
  const owner = input.kind === "character" ? ownerToken(input.token) : await gmOwner(input.sessionId, input.token);
  const current = await infrastructure.toolkitRepository.findToolkitRecord(input.id, owner, input.kind);
  if (input.importIfAbsent && current) return current;
  const record = await infrastructure.toolkitRepository.upsertToolkitRecord({
    id: input.id, ownerToken: owner, kind: input.kind, name: input.name.slice(0, 200), payload,
    expectedVersion: input.expectedVersion,
  });
  return record;
}

export async function deleteToolkit(kind: ToolkitRecordKind, id: string, token: unknown, sessionId?: unknown): Promise<void> {
  const infrastructure = await createMesaHostingInfrastructure();
  const owner = kind === "character" ? ownerToken(token) : await gmOwner(sessionId, token);
  await infrastructure.toolkitRepository.deleteToolkitRecord(id, owner, kind);
}

async function gmOwner(sessionId: unknown, token: unknown): Promise<string> {
  const actor = await authenticate(sessionId, token);
  requireGM(actor);
  // The persisted participant token is the owner identity; no browser-supplied
  // userId/role is trusted for the private catalog.
  return ownerToken(token);
}
