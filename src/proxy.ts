import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * O Electron pode apontar explicitamente para um host de Mesa diferente do
 * host local. As rotas continuam protegidas pelo x-mesa-token; CORS apenas
 * permite que o renderer faça a chamada cross-origin.
 */
export function proxy(request: NextRequest): NextResponse {
  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: corsHeaders() });
  }
  const response = NextResponse.next();
  for (const [key, value] of Object.entries(corsHeaders())) response.headers.set(key, value);
  return response;
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-mesa-token, x-mesa-telemetry-id",
    "Access-Control-Max-Age": "600",
  };
}

export const config = { matcher: "/api/mesa/:path*" };
