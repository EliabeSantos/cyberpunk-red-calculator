import type { NextRequest } from "next/server";

import { DiscordNotConfiguredError, getBotDirectory } from "@/lib/discord/bot";
import { normalizeSessionCode } from "@/lib/discord/sessionCode";
import { getSessionConfig, saveSessionConfig } from "@/lib/discord/sessionStore";
import { isDiscordConfigRequest, type DiscordConfigView } from "@/lib/discord/types";

export const runtime = "nodejs";

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof DiscordNotConfiguredError) {
    return Response.json({ ok: false, error: error.message }, { status: 503 });
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
    const current = getSessionConfig(sessionCode);
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

  try {
    const directory = await getBotDirectory();

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

    const saved = saveSessionConfig(sessionCode, {
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
    return errorResponse(error, "Falha ao salvar a configuração do Discord.");
  }
}
