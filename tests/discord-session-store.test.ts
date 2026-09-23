import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
  DatabaseNotConfiguredError,
  DatabaseQueryError,
  getSessionConfig,
  saveSessionConfig,
} from "../src/lib/discord/sessionStore.ts";

const GUILD = "123456789012345678";
const CHANNEL = "987654321098765432";

const originalFetch = globalThis.fetch;
const originalEnv = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

type Call = { url: string; init: RequestInit | undefined };

function stubFetch(handler: (call: Call) => Response): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return calls;
}

function configureEnv() {
  process.env.SUPABASE_URL = "https://exemple.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  // força cliente novo para isolar os testes
  delete (globalThis as { supabaseAdmin?: unknown }).supabaseAdmin;
}

function getHeader(init: RequestInit | undefined, name: string): string {
  const headers = init?.headers;
  if (!headers) return "";
  if (headers instanceof Headers) return headers.get(name) ?? "";
  const record = headers as Record<string, string>;
  return record[name] ?? record[name.toLowerCase()] ?? "";
}

after(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  delete (globalThis as { supabaseAdmin?: unknown }).supabaseAdmin;
});

test("sem env do Supabase → DatabaseNotConfiguredError", async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  stubFetch(() => {
    throw new Error("não deveria haver chamada de rede");
  });
  await assert.rejects(() => getSessionConfig("mesa-a"), DatabaseNotConfiguredError);
  await assert.rejects(
    () => saveSessionConfig("mesa-a", { guildId: GUILD, channelId: CHANNEL }),
    DatabaseNotConfiguredError,
  );
});

test("código de mesa inválido → null e nenhuma chamada de rede", async () => {
  configureEnv();
  const calls = stubFetch(() => {
    throw new Error("sem rede");
  });
  assert.equal(await getSessionConfig("ab"), null);
  assert.equal(await getSessionConfig(null), null);
  assert.equal(await saveSessionConfig("AB CD", { guildId: GUILD, channelId: CHANNEL }), null);
  assert.equal(calls.length, 0);
});

test("ids que não são snowflakes → null e nenhuma chamada", async () => {
  configureEnv();
  const calls = stubFetch(() => {
    throw new Error("sem rede");
  });
  assert.equal(await saveSessionConfig("mesa-x", { guildId: "nope", channelId: CHANNEL }), null);
  assert.equal(calls.length, 0);
});

test("getSessionConfig encontra a mesa e normaliza o código", async () => {
  configureEnv();
  const calls = stubFetch(() =>
    Response.json([
      {
        session_code: "night-city",
        guild_id: GUILD,
        channel_id: CHANNEL,
        updated_at: "2026-09-23T00:00:00Z",
      },
    ]),
  );
  const config = await getSessionConfig(" Night-City ");
  assert.ok(config);
  assert.equal(config.guildId, GUILD);
  assert.equal(config.channelId, CHANNEL);
  const url = new URL(calls[0].url);
  assert.ok(url.pathname.endsWith("/rest/v1/mesa_discord_configs"), url.pathname);
  assert.ok(
    url.searchParams.get("session_code")?.includes("night-city"),
    `filtro de busca: ${url.search}`,
  );
});

test("getSessionConfig sem registro → null", async () => {
  configureEnv();
  stubFetch(() => Response.json([]));
  assert.equal(await getSessionConfig("mesa-inexistente"), null);
});

test("saveSessionConfig faz upsert e devolve a config salva", async () => {
  configureEnv();
  const calls = stubFetch(() =>
    Response.json([
      {
        session_code: "mesa-y",
        guild_id: GUILD,
        channel_id: CHANNEL,
        updated_at: "2026-09-23T00:00:00Z",
      },
    ]),
  );
  const saved = await saveSessionConfig("Mesa-Y ", { guildId: GUILD, channelId: CHANNEL });
  assert.ok(saved);
  assert.equal(saved.guildId, GUILD);
  assert.equal(saved.channelId, CHANNEL);

  const call = calls[0];
  assert.equal(call.init?.method, "POST");
  const body = JSON.parse(String(call.init?.body));
  const record = Array.isArray(body) ? body[0] : body;
  assert.equal(record.session_code, "mesa-y", "código normalizado no upsert");
  assert.equal(record.guild_id, GUILD);
  assert.equal(record.channel_id, CHANNEL);
  const prefer = getHeader(call.init, "Prefer");
  assert.ok(prefer.includes("merge-duplicates"), `Prefer: ${prefer}`);
});

test("erro do banco → DatabaseQueryError", async () => {
  configureEnv();
  stubFetch(() =>
    Response.json({ code: "42501", message: "permission denied", details: "", hint: "" }, { status: 403 }),
  );
  await assert.rejects(() => getSessionConfig("mesa-a"), DatabaseQueryError);
});
