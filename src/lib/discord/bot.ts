import "server-only";

import { Client, GatewayIntentBits } from "discord.js";

import { formatRollMessage } from "@/lib/discord/format";
import type { DiscordRollPayload } from "@/lib/discord/types";

/** Falha esperada quando as variáveis de ambiente do Discord não estão definidas. */
export class DiscordNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscordNotConfiguredError";
  }
}

/**
 * Client do bot compartilhado entre requests.
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

/**
 * Publica uma rolagem já calculada pelo site no canal configurado.
 * O bot não rola dados: ele apenas formata e envia o resultado recebido.
 */
export async function sendRollToDiscord(payload: DiscordRollPayload): Promise<void> {
  const token = requiredEnv("DISCORD_BOT_TOKEN");
  const channelId = requiredEnv("DISCORD_CHANNEL_ID");

  const client = await connectClient(token);
  const channel = await client.channels.fetch(channelId);

  if (!channel || !channel.isSendable()) {
    throw new Error(
      `Canal do Discord "${channelId}" não encontrado ou não é um canal de texto acessível pelo bot.`,
    );
  }

  await channel.send({
    content: formatRollMessage(payload),
    // Nenhuma menção (@everyone, usuários) é interpretada na mensagem.
    allowedMentions: { parse: [] },
  });
}
