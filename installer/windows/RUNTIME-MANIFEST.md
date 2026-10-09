# Windows installer runtime manifest

The build is pinned to these official upstream artifacts:

| Component | Version | Source | SHA-256 |
|---|---:|---|---|
| Node.js Windows x64 | 22.14.0 | `https://nodejs.org/dist/v22.14.0/node-v22.14.0-win-x64.zip` | `55b639295920b219bb2acbcfa00f90393a2789095b7323f79475c9f34795f217` |
| PostgreSQL Windows x64 binaries | 16.6-1 | `https://get.enterprisedb.com/postgresql/postgresql-16.6-1-windows-x64-binaries.zip` | `6a1bfb6435b13d9563ae481445c70ac2a19846bd8a430b12903b408eec300f9b` |

The build script verifies both hashes before extraction. PostgreSQL is distributed as
the official EDB binary archive; its bundled PostgreSQL and third-party notices must
remain in the installed `postgres` directory. Inno Setup is a build-time dependency
and is not installed on the user's machine.

The application runtime uses the production Next.js build, the pruned production
`node_modules`, the checked-in migration files, and the portable Node.js/PostgreSQL
directories. No `.env`, database, backup, token, or credential is copied into the
installer stage.
