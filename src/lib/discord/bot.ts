import "server-only";

import { formatMessage } from "@/lib/discord/format";
import {
  canBotSend,
  type BotGuildMember,
  type ChannelOverwrite,
  type GuildRole,
} from "@/lib/discord/permissions";
import type {
  DiscordBotDirectory,
  DiscordDirectoryChannel,
  DiscordDirectoryGuild,
  DiscordMessagePayload,
} from "@/lib/discord/types";

/**
 * Bot do Discord via REST: uma chamada HTTP por ação, sem conexão persistente
 * (gateway), portanto estável em ambiente serverless (Vercel) — nunca falha
 * por cold start. Um único bot atende N servidores.
 *
 * O bot NUNCA rola dados nem conhece regras: ele apenas publica o resultado
 * já calculado pelo site.
 */

const DISCORD_API = "https://discord.com/api/v10";
/** View Channel (1024) + Send Messages (2048) — nunca Administrator. */
const BOT_PERMISSIONS = 3072;
/** Canais de texto aceitos: texto, anúncios e threads. */
const SENDABLE_CHANNEL_TYPES = new Set([0, 5, 11, 12]);

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

/** Falha de publicação com mensagem clara (nunca derruba a rolagem do site). */
export class DiscordPublishError extends Error {
  constructor(readonly errorCode: DiscordPublishErrorCode, message: string) {
    super(message);
    this.name = "DiscordPublishError";
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new DiscordNotConfiguredError(
      `Variável de ambiente ${name} não configurada. Preencha o .env.local (veja .env.example).`,
    );
  }
  return value;
}

function botHeaders(): Record<string, string> {
  return {
    Authorization: `Bot ${requiredEnv("DISCORD_BOT_TOKEN")}`,
    "Content-Type": "application/json",
  };
}

interface ApiRole {
  id: string;
  permissions: string;
}

interface ApiGuild {
  id: string;
  name: string;
  roles: ApiRole[];
}

interface ApiUser {
  id: string;
}

interface ApiMember {
  roles: string[];
  user?: ApiUser | null;
}

interface ApiOverwrite {
  id: string;
  type: number | string;
  allow: string;
  deny: string;
}

interface ApiChannel {
  id: string;
  name?: string | null;
  type: number;
  guild_id?: string | null;
  permission_overwrites?: ApiOverwrite[] | null;
}

async function discordFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${DISCORD_API}${path}`, {
    ...init,
    headers: { ...botHeaders(), ...(init?.headers ?? {}) },
    cache: "no-store",
  });
}

export interface SendRollOptions {
  guildId: string;
  channelId: string;
  payload: DiscordMessagePayload;
}

/**
 * Publica uma mensagem de rolagem já calculada pelo site no canal indicado.
 * A resolução guildId → channelId chega pronta da camada de configuração.
 */
export async function sendRollToDiscord({
  guildId,
  channelId,
  payload,
}: SendRollOptions): Promise<void> {
  const guildResponse = await discordFetch(`/guilds/${guildId}`);
  if (guildResponse.status === 404) {
    throw new DiscordPublishError(
      "guild-unavailable",
      "O bot não está instalado neste servidor Discord (a guild não foi encontrada). Instale o bot novamente ou revise a configuração da mesa.",
    );
  }
  if (!guildResponse.ok) throw new Error(`Discord API: guild ${guildResponse.status}`);
  const guild = (await guildResponse.json()) as ApiGuild;

  const channelResponse = await discordFetch(`/channels/${channelId}`);
  if (channelResponse.status === 404) {
    throw new DiscordPublishError(
      "channel-missing",
      "O canal configurado não existe mais no Discord.",
    );
  }
  if (!channelResponse.ok) throw new Error(`Discord API: channel ${channelResponse.status}`);
  const channel = (await channelResponse.json()) as ApiChannel;

  if (channel.guild_id !== guildId) {
    throw new DiscordPublishError(
      "channel-mismatch",
      "O canal configurado não pertence a este servidor Discord.",
    );
  }
  if (!SENDABLE_CHANNEL_TYPES.has(channel.type)) {
    throw new DiscordPublishError(
      "channel-not-sendable",
      "O canal configurado não aceita mensagens de texto.",
    );
  }

  // Não existe /members/@me: precisamos do snowflake do bot (via /users/@me).
  const meResponse = await discordFetch("/users/@me");
  if (!meResponse.ok) throw new Error(`Discord API: me ${meResponse.status}`);
  const me = (await meResponse.json()) as ApiUser;

  const memberResponse = await discordFetch(`/guilds/${guildId}/members/${me.id}`);
  if (memberResponse.status === 404) {
    throw new DiscordPublishError("guild-unavailable", "O bot foi removido deste servidor Discord.");
  }
  if (!memberResponse.ok) throw new Error(`Discord API: member ${memberResponse.status}`);
  const member = (await memberResponse.json()) as ApiMember;

  const botUserId = member.user?.id ?? "";
  if (
    botUserId &&
    !canBotSend(
      guildId,
      guild.roles,
      member as BotGuildMember,
      botUserId,
      (channel.permission_overwrites ?? []) as ChannelOverwrite[],
    )
  ) {
    throw new DiscordPublishError(
      "no-access",
      "O bot não tem permissão neste canal (necessário: Ver canal e Enviar mensagens).",
    );
  }

  const sendResponse = await discordFetch(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content: formatMessage(payload),
      // Nenhuma menção (@everyone, usuários) é interpretada na mensagem.
      allowed_mentions: { parse: [] },
    }),
  });
  if (sendResponse.status === 403) {
    throw new DiscordPublishError(
      "no-access",
      "O Discord recusou o envio: o bot não tem permissão neste canal.",
    );
  }
  if (sendResponse.status === 404) {
    throw new DiscordPublishError("channel-missing", "O canal configurado não existe mais no Discord.");
  }
  if (!sendResponse.ok) {
    throw new Error(`Discord API: send ${sendResponse.status} — ${await sendResponse.text()}`);
  }
}

/**
 * Diretório do bot para o painel de configuração: servidores onde o bot está
 * instalado, canais de texto e permissão de envio em cada um (REST puro).
 */
export async function getBotDirectory(): Promise<DiscordBotDirectory> {
  const meResponse = await discordFetch("/users/@me");
  if (meResponse.status === 401) {
    throw new DiscordNotConfiguredError(
      "Token do Discord inválido ou expirado. Gere um novo em Developer Portal → Bot → Reset Token.",
    );
  }
  if (!meResponse.ok) throw new Error(`Discord API: me ${meResponse.status}`);
  const me = (await meResponse.json()) as ApiUser;
  const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${me.id}&scope=bot&permissions=${BOT_PERMISSIONS}`;

  const guildsResponse = await discordFetch("/users/@me/guilds");
  if (!guildsResponse.ok) throw new Error(`Discord API: guilds ${guildsResponse.status}`);
  const summary = (await guildsResponse.json()) as { id: string; name: string }[];

  const guilds = (
    await Promise.all(
      summary.map(async (item): Promise<DiscordDirectoryGuild | null> => {
        const [detailResponse, memberResponse, channelsResponse] = await Promise.all([
          discordFetch(`/guilds/${item.id}`),
          // não existe /members/@me: usamos o snowflake do bot (me.id)
          discordFetch(`/guilds/${item.id}/members/${me.id}`),
          discordFetch(`/guilds/${item.id}/channels`),
        ]);
        // Corrida: o bot pode ter saído do servidor entre as chamadas.
        if (!detailResponse.ok || !memberResponse.ok || !channelsResponse.ok) return null;

        const detail = (await detailResponse.json()) as ApiGuild;
        const member = (await memberResponse.json()) as ApiMember;
        const channels = (await channelsResponse.json()) as ApiChannel[];
        const botUserId = member.user?.id ?? "";

        const mapped: DiscordDirectoryChannel[] = channels
          .filter((channel) => channel.type === 0 || channel.type === 5)
          .map((channel) => ({
            id: channel.id,
            name: channel.name ?? channel.id,
            canSend: botUserId
              ? canBotSend(
                  item.id,
                  detail.roles as GuildRole[],
                  member as BotGuildMember,
                  botUserId,
                  (channel.permission_overwrites ?? []) as ChannelOverwrite[],
                )
              : false,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));

        return { id: item.id, name: item.name, channels: mapped };
      }),
    )
  ).filter((guild): guild is DiscordDirectoryGuild => guild !== null);

  guilds.sort((a, b) => a.name.localeCompare(b.name));

  return { botReady: true, inviteUrl, guilds };
}
