import { errorResponse, ok, readJson, tokenFrom } from "@/lib/mesa/http";
import { deleteToolkit, listToolkit, saveToolkit, toolkitKind } from "@/lib/mesa/toolkitServer";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ kind: string }> }): Promise<Response> {
  try {
    const { kind: rawKind } = await context.params;
    const kind = toolkitKind(rawKind);
    const sessionId = new URL(request.url).searchParams.get("sessionId") ?? undefined;
    return ok({ records: await listToolkit(kind, tokenFrom(request), sessionId) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: { params: Promise<{ kind: string }> }): Promise<Response> {
  try {
    const { kind: rawKind } = await context.params;
    const kind = toolkitKind(rawKind);
    const body = await readJson(request);
    if (typeof body.id !== "string" || typeof body.name !== "string") throw new Error("Registro sem id ou nome.");
    const record = await saveToolkit({
      kind, token: tokenFrom(request), sessionId: body.sessionId,
      id: body.id, name: body.name, payload: body.payload,
      expectedVersion: typeof body.expectedVersion === "number" ? body.expectedVersion : undefined,
      importIfAbsent: body.importIfAbsent === true,
    });
    return ok({ record });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request, context: { params: Promise<{ kind: string }> }): Promise<Response> {
  try {
    const { kind: rawKind } = await context.params;
    const kind = toolkitKind(rawKind);
    const body = await readJson(request);
    if (typeof body.id !== "string") throw new Error("Registro sem id.");
    await deleteToolkit(kind, body.id, tokenFrom(request), body.sessionId);
    return ok();
  } catch (error) { return errorResponse(error); }
}
