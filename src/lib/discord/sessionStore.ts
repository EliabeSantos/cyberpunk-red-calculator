/**
 * Persistência da configuração Discord das mesas: apenas guildId → channelId.
 *
 * Arquivo JSON no servidor — NUNCA guarda rolagens, fichas, personagens ou
 * histórico. Usa `node:fs` (e não `import "server-only"`) para permanecer
 * testável; um import indevido pelo cliente falharia no build por causa de
 * `node:fs`, o que oferece a mesma proteção.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isSnowflake } from "@/lib/discord/types";
import { normalizeSessionCode } from "@/lib/discord/sessionCode";

export interface DiscordSessionConfig {
  guildId: string;
  channelId: string;
  updatedAt: string;
}

export interface DiscordSessionTarget {
  guildId: string;
  channelId: string;
}

function dataDir(): string {
  return process.env.DISCORD_DATA_DIR?.trim() || join(process.cwd(), "data");
}

function storeFile(): string {
  return join(dataDir(), "discord-sessions.json");
}

function isValidTarget(value: unknown): value is DiscordSessionTarget {
  if (typeof value !== "object" || value === null) return false;
  const target = value as Record<string, unknown>;
  return isSnowflake(target.guildId) && isSnowflake(target.channelId);
}

function readAll(): Record<string, DiscordSessionConfig> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(storeFile(), "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const configs: Record<string, DiscordSessionConfig> = {};
    for (const [key, value] of Object.entries(parsed)) {
      // Ignora entradas malformadas em vez de quebrar a leitura inteira.
      if (normalizeSessionCode(key) && isValidTarget(value)) {
        configs[key] = value as DiscordSessionConfig;
      }
    }
    return configs;
  } catch {
    // Arquivo ausente ou corrompido = nenhuma mesa configurada.
    return {};
  }
}

/** Configuração da mesa, ou `null` se o código for inválido ou desconhecido. */
export function getSessionConfig(sessionCode: unknown): DiscordSessionConfig | null {
  const code = normalizeSessionCode(sessionCode);
  if (!code) return null;
  return readAll()[code] ?? null;
}

/** Salva a vinculação mesa → servidor/canal. Retorna `null` se algo for inválido. */
export function saveSessionConfig(
  sessionCode: unknown,
  target: DiscordSessionTarget,
): DiscordSessionConfig | null {
  const code = normalizeSessionCode(sessionCode);
  if (!code || !isValidTarget(target)) return null;

  const configs = readAll();
  const saved: DiscordSessionConfig = {
    guildId: target.guildId,
    channelId: target.channelId,
    updatedAt: new Date().toISOString(),
  };
  configs[code] = saved;

  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(storeFile(), `${JSON.stringify(configs, null, 2)}\n`, "utf8");
  return saved;
}
