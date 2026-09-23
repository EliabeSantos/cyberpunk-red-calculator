import {
  DiscordNotConfiguredError,
  DiscordPublishError,
  sendRollToDiscord,
} from "@/lib/discord/bot";
import { normalizeSessionCode } from "@/lib/discord/sessionCode";
import {
  DatabaseNotConfiguredError,
  DatabaseQueryError,
  getSessionConfig,
} from "@/lib/discord/sessionStore";
import { isDiscordRollPayload } from "@/lib/discord/types";

export const runtime = "nodejs";

/**
 * Recebe o resultado de uma rolagem já calculada pelo site e a publica
 * no canal do servidor Discord vinculado à mesa. Este endpoint não rola dados.
 *
 * Roteamento: sessionCode → guildId → channelId.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Corpo JSON inválido." }, { status: 400 });
  }

  if (!isDiscordRollPayload(body)) {
    return Response.json(
      { ok: false, error: "Payload de rolagem inválido." },
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
    const config = await getSessionConfig(sessionCode);
    if (!config) {
      return Response.json(
        {
          ok: false,
          error:
            "Sessão sem Discord configurado: nenhum servidor está vinculado a este código de mesa.",
        },
        { status: 404 },
      );
    }

    await sendRollToDiscord({
      guildId: config.guildId,
      channelId: config.channelId,
      payload: body,
    });
    return Response.json({ ok: true });
  } catch (error) {
    if (
      error instanceof DiscordNotConfiguredError ||
      error instanceof DatabaseNotConfiguredError
    ) {
      return Response.json({ ok: false, error: error.message }, { status: 503 });
    }
    if (error instanceof DatabaseQueryError) {
      console.error("[discord] Falha no banco ao rotear rolagem:", error);
      return Response.json(
        { ok: false, error: "Falha ao consultar a configuração da mesa." },
        { status: 502 },
      );
    }
    if (error instanceof DiscordPublishError) {
      return Response.json({ ok: false, error: error.message }, { status: 502 });
    }
    console.error("[discord] Falha ao publicar rolagem:", error);
    return Response.json(
      { ok: false, error: "Falha ao publicar a rolagem no Discord." },
      { status: 502 },
    );
  }
}
