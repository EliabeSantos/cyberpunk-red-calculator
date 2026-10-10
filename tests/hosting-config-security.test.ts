import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const environmentKeys = [
  "MESA_HOSTING_MODE",
  "MESA_LOCAL_DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "MESA_HOSTING_MODE_FILE",
  "MESA_HOST_ADMIN_TOKEN_FILE",
  "MESA_HOST_ADMIN_TOKEN",
] as const;

function saveEnvironment(): Record<string, string | undefined> {
  return Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
}

function restoreEnvironment(previous: Record<string, string | undefined>): void {
  for (const key of environmentKeys) {
    const value = previous[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("hosting config rejeita Host forjado, x-mesa-token e credencial inválida sem escrever", async () => {
  const previous = saveEnvironment();
  const directory = await mkdtemp(join(tmpdir(), "mesa-hosting-security-"));
  const config = join(directory, "host.env");
  const tokenFile = join(directory, "host-admin-token");
  await writeFile(config, "MESA_HOSTING_MODE=local\n", { mode: 0o600 });
  await writeFile(tokenFile, "admin-token-for-test\n", { mode: 0o600 });
  process.env.MESA_HOSTING_MODE = "local";
  process.env.MESA_LOCAL_DATABASE_URL = "postgresql://local.invalid/unused";
  process.env.MESA_HOSTING_MODE_FILE = config;
  process.env.MESA_HOST_ADMIN_TOKEN_FILE = tokenFile;
  delete process.env.MESA_HOST_ADMIN_TOKEN;

  try {
    const { POST } = await import("../src/app/api/hosting/config/route.ts");
    const original = await readFile(config, "utf8");
    const cases: Array<Record<string, string>> = [
      { host: "localhost" },
      { host: "localhost", "x-mesa-token": "admin-token-for-test" },
      { host: "localhost", authorization: "Bearer wrong-token" },
    ];
    for (const headers of cases) {
      const response = await POST(new Request("http://localhost/api/hosting/config", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ mode: "local" }),
      }));
      assert.equal(response.status, 401);
      assert.equal(await readFile(config, "utf8"), original);
    }
  } finally {
    restoreEnvironment(previous);
    await rm(directory, { recursive: true, force: true });
  }
});

test("credencial administrativa autoriza somente o endpoint de host, sem depender de Host", async () => {
  const previous = saveEnvironment();
  const directory = await mkdtemp(join(tmpdir(), "mesa-hosting-security-"));
  const config = join(directory, "host.env");
  const tokenFile = join(directory, "host-admin-token");
  await writeFile(config, "MESA_HOSTING_MODE=local\n", { mode: 0o600 });
  await writeFile(tokenFile, "admin-token-for-test\n", { mode: 0o600 });
  process.env.MESA_HOSTING_MODE = "local";
  process.env.MESA_LOCAL_DATABASE_URL = "postgresql://local.invalid/unused";
  process.env.MESA_HOSTING_MODE_FILE = config;
  process.env.MESA_HOST_ADMIN_TOKEN_FILE = tokenFile;
  delete process.env.MESA_HOST_ADMIN_TOKEN;

  try {
    const { GET, POST } = await import("../src/app/api/hosting/config/route.ts");
    const headers = { authorization: "Bearer admin-token-for-test", host: "attacker.example" };
    const getResponse = await GET(new Request("http://attacker.example/api/hosting/config", { headers }));
    assert.equal(getResponse.status, 200);
    const getBody = await getResponse.json() as Record<string, unknown>;
    assert.equal(JSON.stringify(getBody).includes("admin-token-for-test"), false);

    const postResponse = await POST(new Request("http://attacker.example/api/hosting/config", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ mode: "local" }),
    }));
    assert.equal(postResponse.status, 200);
  } finally {
    restoreEnvironment(previous);
    await rm(directory, { recursive: true, force: true });
  }
});
