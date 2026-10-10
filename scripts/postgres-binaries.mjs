import { access, constants, readdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));

/** Resolve only the bundled PostgreSQL tools (or an explicitly supplied bin dir). */
export async function postgresTool(name) {
  const executable = process.platform === "win32" ? `${name}.exe` : name;
  const configured = process.env.MESA_POSTGRES_BIN_DIR?.trim();
  const roots = [
    configured || null,
    // Installed layout: {app}/app/scripts -> {app}/postgres.
    join(scriptsDirectory, "..", "..", "postgres"),
  ].filter(Boolean);

  for (const root of roots) {
    const candidates = [join(root, executable)];
    const pending = [root];
    while (pending.length > 0) {
      const directory = pending.pop();
      if (!directory) continue;
      try {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const fullPath = join(directory, entry.name);
          if (entry.isDirectory()) pending.push(fullPath);
          else if (entry.isFile() && entry.name.toLowerCase() === executable.toLowerCase()) candidates.push(fullPath);
        }
      } catch {
        // The direct candidate or another root may still be valid.
      }
    }
    for (const candidate of candidates) {
      try {
        const info = await stat(candidate);
        if (info.isFile()) {
          if (process.platform !== "win32") await access(candidate, constants.X_OK);
          return candidate;
        }
      } catch {
        // Try the next explicitly known location.
      }
    }
  }

  const hint = configured
    ? `MESA_POSTGRES_BIN_DIR não contém ${executable}.`
    : `Defina MESA_POSTGRES_BIN_DIR ou instale o layout empacotado ({app}/postgres).`;
  throw new Error(`Binário PostgreSQL empacotado ausente: ${executable}. ${hint}`);
}

/**
 * Removes the password from the argument visible to pg_dump/pg_restore and
 * passes it through PGPASSWORD instead. The URL is still never printed.
 */
export function safeDatabaseArguments(rawUrl) {
  const parsed = new URL(rawUrl);
  const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;
  parsed.password = "";
  const env = { ...process.env };
  if (password !== undefined) env.PGPASSWORD = password;
  return { connectionString: parsed.toString(), env };
}

export function absolutePath(value) {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}
