"use client";

import type { Character } from "@/types/character";
import type { Enemy } from "@/types/enemy";
import type { EncounterData } from "@/types/encounter";
import { getActiveMembership, getPlayerToken, listMemberships } from "@/lib/mesa/membershipStore";
import { loadCharacters, saveCharacters } from "@/lib/storage";
import { loadEnemies, saveEnemies, loadEncounters, saveEncounter } from "@/lib/gmStorage";

type Kind = "character" | "enemy" | "encounter";
type RemoteRecord = { id: string; name: string; payload: unknown; version: number };

export class ToolkitApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) { super(message); }
}

const versions = new Map<string, number>();

function gmSession(): string {
  const active = getActiveMembership();
  if (active?.role === "gm") return active.sessionId;
  const first = listMemberships().find((entry) => entry.role === "gm");
  if (first) return first.sessionId;
  throw new ToolkitApiError("gm_session_required", "Entre em uma Mesa como Mestre para acessar o catálogo privado.", 403);
}

async function request(kind: Kind, method: "GET" | "POST" | "DELETE", body?: Record<string, unknown>): Promise<RemoteRecord[] | RemoteRecord | null> {
  const sessionId = kind === "character" ? undefined : gmSession();
  const url = `/api/toolkit/${kind}${method === "GET" ? sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "" : ""}`;
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json", "x-mesa-token": getPlayerToken() },
    body: method === "GET" ? undefined : JSON.stringify({ ...body, ...(sessionId ? { sessionId } : {}) }),
  });
  const result = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; code?: string; records?: RemoteRecord[]; record?: RemoteRecord };
  if (!response.ok || !result.ok) throw new ToolkitApiError(result.code ?? "toolkit_request_failed", result.error ?? "Não foi possível acessar o toolkit.", response.status);
  return method === "GET" ? result.records ?? [] : method === "DELETE" ? null : result.record ?? null;
}

function nameOf(kind: Kind, payload: Character | Enemy | EncounterData): string {
  if (kind === "character") return (payload as Character).identity.name;
  if (kind === "enemy") return (payload as Enemy).identity.name;
  return (payload as EncounterData).name;
}

export async function loadRemoteCharacters(): Promise<Character[]> {
  const local = loadCharacters();
  await request("character", "GET");
  await Promise.all(local.map((payload) => request("character", "POST", { id: payload.id, name: nameOf("character", payload), payload, importIfAbsent: true })));
  const records = await request("character", "GET") as RemoteRecord[];
  const values = records.map((record) => { versions.set(`character:${record.id}`, record.version); return record.payload as Character; });
  saveCharacters(values);
  return values;
}

export async function saveRemoteCharacter(character: Character): Promise<void> {
  const record = await request("character", "POST", { id: character.id, name: nameOf("character", character), payload: character, expectedVersion: versions.get(`character:${character.id}`) }) as RemoteRecord;
  versions.set(`character:${character.id}`, record.version); saveCharacters([...(loadCharacters().filter((item) => item.id !== character.id)), character]);
}

export async function loadRemoteEnemies(): Promise<Enemy[]> {
  const local = loadEnemies();
  await request("enemy", "GET");
  await Promise.all(local.map((payload) => request("enemy", "POST", { id: payload.id, name: nameOf("enemy", payload), payload, importIfAbsent: true })));
  const records = await request("enemy", "GET") as RemoteRecord[];
  const values = records.map((record) => { versions.set(`enemy:${record.id}`, record.version); return record.payload as Enemy; });
  saveEnemies(values);
  return values;
}

export async function saveRemoteEnemy(enemy: Enemy): Promise<void> {
  const record = await request("enemy", "POST", { id: enemy.id, name: nameOf("enemy", enemy), payload: enemy, expectedVersion: versions.get(`enemy:${enemy.id}`) }) as RemoteRecord;
  versions.set(`enemy:${enemy.id}`, record.version); saveEnemies([...loadEnemies().filter((item) => item.id !== enemy.id), enemy]);
}

export async function removeRemote(kind: "enemy" | "encounter" | "character", id: string): Promise<void> {
  await request(kind, "DELETE", { id });
}

export async function loadRemoteEncounters(): Promise<EncounterData[]> {
  const local = loadEncounters();
  await Promise.all(local.map((payload) => request("encounter", "POST", { id: payload.id, name: nameOf("encounter", payload), payload, importIfAbsent: true })));
  const records = await request("encounter", "GET") as RemoteRecord[];
  const values = records.map((record) => { versions.set(`encounter:${record.id}`, record.version); return record.payload as EncounterData; });
  values.forEach(saveEncounter);
  return values;
}

export async function saveRemoteEncounter(encounter: EncounterData): Promise<void> {
  const record = await request("encounter", "POST", { id: encounter.id, name: nameOf("encounter", encounter), payload: encounter, expectedVersion: versions.get(`encounter:${encounter.id}`) }) as RemoteRecord;
  versions.set(`encounter:${encounter.id}`, record.version);
  saveEncounter(encounter);
}
