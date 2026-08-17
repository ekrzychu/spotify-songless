import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not configured in .env.local");

// Some Windows/network filesystems do not let Prisma create a new SQLite file,
// even though they support reading and updating one. Touch it before db push.
if (databaseUrl.startsWith("file:")) {
  const configuredPath = databaseUrl.slice("file:".length);
  const databasePath = isAbsolute(configuredPath)
    ? configuredPath
    : resolve(process.cwd(), "prisma", configuredPath);
  mkdirSync(dirname(databasePath), { recursive: true });
  closeSync(openSync(databasePath, "a"));
}

const prismaCli = resolve(process.cwd(), "node_modules", "prisma", "build", "index.js");
const result = spawnSync(process.execPath, [prismaCli, "db", "push"], {
  cwd: process.cwd(), env: process.env, stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
