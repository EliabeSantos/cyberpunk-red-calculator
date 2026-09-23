import type { NextRequest } from "next/server";

import { DiscordNotConfiguredError, getBotDirectory } from "@/lib/discord/bot";
import { normalizeSessionCode } from "@/lib/discord/sessionCode";
import {
  DatabaseNotConfiguredError,
  DatabaseQueryError,
  getSessionConfig,
  saveSessionConfig,
} from "@/lib/discord/sessionStore";
import { isDiscordConfigRequest, type DiscordBotDirectory, type DiscordConfigView } from "@/lib/discord/types";

export const runtime = "nodejs";

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof DiscordNotConfiguredError || error instanceof DatabaseNotConfiguredError) {
    return Response.json({ ok: false, error: error.message }, { status: 503 });
  }
  if (error instanceof DatabaseQueryError) {
    console.error("[discord] Falha no banco ao consultar:", error);
    return Response.json({ ok: false, error: "Falha ao consultar o banco de dados." }, { status: 502 });
  }
  console.error("[discord] Falha na configuração:", error);
  return Response.json({ ok: false, error: fallback }, { status: 502 });
}

/**
 * GET: diretório do bot (servidores/canais) + configuração atual da mesa.
 * Alimenta o painel "Discord Integration" da gaveta de Dados.
 */
export async function GET(request: NextRequest) {
  const sessionCode = normalizeSessionCode(request.nextUrl.searchParams.get("session"));
  if (!sessionCode) {
    return Response.json(
      { ok: false, error: "Código de mesa inválido (use letras, números e hífen)." },
      { status: 400 },
    );
  }

  try {
    const directory = await getBotDirectory();
    const current = await getSessionConfig(sessionCode);
    const view: DiscordConfigView & { ok: true } = {
      ok: true,
      sessionCode,
      current: current ? { guildId: current.guildId, channelId: current.channelId } : null,
      ...directory,
    };
    return Response.json(view);
  } catch (error) {
    return errorResponse(error, "Falha ao consultar o bot do Discord.");
  }
}

/**
 * POST: salva a vinculação mesa → guildId → channelId após validar que o bot
 * está naquele servidor e pode enviar mensagens no canal escolhido.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Corpo JSON inválido." }, { status: 400 });
  }

  if (!isDiscordConfigRequest(body)) {
    return Response.json(
      { ok: false, error: "Configuração inválida: informe mesa, servidor e canal." },
      { status: 400 },
    );
  }

  const sessionCode = normalizeSessionCode(body.sessionCode);
  if (!sessionCode) {
    return Response.json(
      { ok: false, error: "Código de mesa inválido (use letras, números e hífen)." },
      { status: 400 },
    );
  }

  // Fase 1: consultar o diretório do bot via API REST. Falhas aqui são de rede/token.
  let directory: DiscordBotDirectory;
  try {
    directory = await getBotDirectory();
  } catch (error) {
    if (error instanceof DiscordNotConfiguredError) {
      return Response.json({ ok: false, error: error.message }, { status: 503 });
    }
    console.error("[discord] Falha ao consultar o bot ao salvar:", error);
    return Response.json(
      {
        ok: false,
        error:
          "Não foi possível conectar ao bot do Discord. Confira a conexão e tente novamente.",
      },
      { status: 502 },
    );
  }

  const guild = directory.guilds.find((item) => item.id === body.guildId);
  if (!guild) {
    return Response.json(
      {
        ok: false,
        error:
          "O bot não está instalado neste servidor Discord. Use o link de instalação e tente novamente.",
      },
      { status: 400 },
    );
  }

  const channel = guild.channels.find((item) => item.id === body.channelId);
  if (!channel) {
    return Response.json(
      { ok: false, error: "O canal escolhido não existe mais neste servidor." },
      { status: 400 },
    );
  }
  if (!channel.canSend) {
    return Response.json(
      {
        ok: false,
        error:
          "O bot não pode enviar mensagens neste canal (necessário: Ver canal e Enviar mensagens).",
      },
      { status: 400 },
    );
  }

  // Fase 2: gravar a vinculação mesa → guild → canal no Supabase.
  try {
    const saved = await saveSessionConfig(sessionCode, {
      guildId: body.guildId,
      channelId: body.channelId,
    });
    if (!saved) {
      return Response.json({ ok: false, error: "Falha ao salvar a configuração." }, { status: 500 });
    }

    return Response.json({
      ok: true,
      sessionCode,
      current: { guildId: saved.guildId, channelId: saved.channelId },
    });
  } catch (error) {
    if (error instanceof DatabaseNotConfiguredError) {
      return Response.json({ ok: false, error: error.message }, { status: 503 });
    }
    if (error instanceof DatabaseQueryError) {
      console.error("[discord] Falha no banco ao salvar:", error);
      return Response.json(
        { ok: false, error: "Falha ao salvar a configuração no banco de dados." },
        { status: 502 },
      );
    }
    console.error("[discord] Falha inesperada ao salvar configuração da mesa:", error);
    return Response.json(
      { ok: false, error: "Falha inesperada ao salvar a configuração." },
      { status: 502 },
    );
  }
}
