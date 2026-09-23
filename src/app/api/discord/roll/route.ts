import { DiscordNotConfiguredError, sendRollToDiscord } from "@/lib/discord/bot";
import { isDiscordRollPayload } from "@/lib/discord/types";

export const runtime = "nodejs";

/**
 * Recebe o resultado de uma rolagem já calculada pelo site e a publica
 * no canal do Discord configurado. Este endpoint não rola dados.
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

  try {
    await sendRollToDiscord(body);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof DiscordNotConfiguredError) {
      return Response.json({ ok: false, error: error.message }, { status: 503 });
    }
    console.error("[discord] Falha ao publicar rolagem:", error);
    return Response.json(
      { ok: false, error: "Falha ao publicar a rolagem no Discord." },
      { status: 502 },
    );
  }
}
