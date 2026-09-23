import "server-only";

import {
  ChannelType,
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
} from "discord.js";

import { formatRollMessage } from "@/lib/discord/format";
import type {
  DiscordBotDirectory,
  DiscordDirectoryChannel,
  DiscordDirectoryGuild,
  DiscordRollPayload,
} from "@/lib/discord/types";

/** Falha esperada quando as variáveis de ambiente do Discord não estão definidas. */
export class DiscordNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscordNotConfiguredError";
  }
}

export type DiscordPublishErrorCode =
  | "guild-unavailable"
  | "channel-missing"
  | "channel-mismatch"
  | "channel-not-sendable"
  | "no-access";

/** Falha de publicação com mensagem clara para o usuário (nunca derruba a rolagem). */
export class DiscordPublishError extends Error {
  constructor(readonly errorCode: DiscordPublishErrorCode, message: string) {
    super(message);
    this.name = "DiscordPublishError";
  }
}

/** Somente as permissões mínimas: View Channel (1024) + Send Messages (2048). */
const BOT_PERMISSIONS = Number(PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages);
const REQUIRED_SEND_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
] as const;

/**
 * Client do bot compartilhado entre requests (um único bot, N servidores).
 * `globalThis` preserva a conexão entre hot reloads do `next dev`.
 */
const globalForBot = globalThis as unknown as { discordBotClient?: Promise<Client> };

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new DiscordNotConfiguredError(
      `Variável de ambiente ${name} não configurada. Preencha o .env.local (veja .env.example).`,
    );
  }
  return value;
}

async function connectClient(token: string): Promise<Client> {
  if (!globalForBot.discordBotClient) {
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    const connection = client.login(token).then(() => client);
    globalForBot.discordBotClient = connection;
    // Sem conexão bem-sucedida, limpa o cache para permitir nova tentativa.
    void connection.catch(() => {
      delete globalForBot.discordBotClient;
    });
  }
  return globalForBot.discordBotClient;
}

export interface SendRollOptions {
  guildId: string;
  channelId: string;
  payload: DiscordRollPayload;
}

/**
 * Publica uma rolagem já calculada pelo site no canal do servidor indicado.
 * O bot não rola dados nem conhece regras: apenas formata e envia o resultado.
 */
export async function sendRollToDiscord({
  guildId,
  channelId,
  payload,
}: SendRollOptions): Promise<void> {
  const token = requiredEnv("DISCORD_BOT_TOKEN");
  const client = await connectClient(token);

  // guildId → channelId: falhas aqui viram mensagens claras, nunca exceções cruas.
  const guild =
    client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId).catch(() => null));
  if (!guild) {
    throw new DiscordPublishError(
      "guild-unavailable",
      "O bot não está instalado neste servidor Discord (a guild não foi encontrada). Instale o bot novamente ou revise a configuração da mesa.",
    );
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    throw new DiscordPublishError(
      "channel-missing",
      "O canal configurado não existe mais no Discord.",
    );
  }
  if (!("guildId" in channel) || channel.guildId !== guildId) {
    throw new DiscordPublishError(
      "channel-mismatch",
      "O canal configurado não pertence a este servidor Discord.",
    );
  }
  if (!channel.isSendable()) {
    throw new DiscordPublishError(
      "channel-not-sendable",
      "O canal configurado não aceita mensagens de texto.",
    );
  }

  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (me) {
    const permissions = channel.permissionsFor(me);
    if (!permissions?.has([...REQUIRED_SEND_PERMISSIONS])) {
      throw new DiscordPublishError(
        "no-access",
        "O bot não tem permissão neste canal (necessário: Ver canal e Enviar mensagens).",
      );
    }
  }

  try {
    await channel.send({
      content: formatRollMessage(payload),
      // Nenhuma menção (@everyone, usuários) é interpretada na mensagem.
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code === 50013 || code === 50001) {
      throw new DiscordPublishError(
        "no-access",
        "O Discord recusou o envio: o bot não tem permissão neste canal.",
      );
    }
    throw error;
  }
}

/**
 * Diretório do bot para o painel de configuração: servidores onde o bot está
 * instalado, canais de texto e permissão de envio em cada um.
 */
export async function getBotDirectory(): Promise<DiscordBotDirectory> {
  const token = requiredEnv("DISCORD_BOT_TOKEN");
  const client = await connectClient(token);

  const inviteUrl = client.user
    ? `https://discord.com/oauth2/authorize?client_id=${client.user.id}&scope=bot&permissions=${BOT_PERMISSIONS}`
    : "";

  const guilds: DiscordDirectoryGuild[] = [];
  for (const guild of client.guilds.cache.values()) {
    const member = guild.members.me;
    const channels: DiscordDirectoryChannel[] = [];
    for (const channel of guild.channels.cache.values()) {
      if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
        continue;
      }
      const permissions = member ? channel.permissionsFor(member) : null;
      channels.push({
        id: channel.id,
        name: channel.name,
        canSend: Boolean(permissions?.has([...REQUIRED_SEND_PERMISSIONS])),
      });
    }
    channels.sort((a, b) => a.name.localeCompare(b.name));
    guilds.push({ id: guild.id, name: guild.name, channels });
  }
  guilds.sort((a, b) => a.name.localeCompare(b.name));

  return { botReady: client.isReady(), inviteUrl, guilds };
}
