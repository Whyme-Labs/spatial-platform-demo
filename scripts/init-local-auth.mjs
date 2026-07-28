import { randomBytes } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const target = new URL("../.dev.vars", import.meta.url);
const existing = existsSync(target) ? await readFile(target, "utf8") : "";
const values = new Map();
for (const line of existing.split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) values.set(match[1], match[2]);
}
values.delete("ADMIN_BOOTSTRAP_TOKEN");

const temporaryDirectory = await mkdtemp(join(tmpdir(), "spatial-auth-"));
const ringPath = join(temporaryDirectory, "keyring.json");
const result = spawnSync(
  process.execPath,
  [new URL("./auth-keyring.mjs", import.meta.url).pathname, "new", ringPath],
  { stdio: "inherit" },
);
if (result.status !== 0) throw new Error("Failed to generate local JWT key ring");
values.set("JWT_KEYRING", await readFile(ringPath, "utf8"));
values.set("OTP_PEPPER", randomBytes(48).toString("base64url"));
values.set("REFRESH_TOKEN_PEPPER", randomBytes(48).toString("base64url"));
if (!values.has("SESSION_PEPPER")) values.set("SESSION_PEPPER", randomBytes(48).toString("base64url"));
if (!values.has("WORKER_API_TOKEN")) values.set("WORKER_API_TOKEN", randomBytes(48).toString("base64url"));

await writeFile(
  target,
  [...values.entries()].map(([key, value]) => `${key}=${value}`).join("\n") + "\n",
  { mode: 0o600 },
);
await rm(temporaryDirectory, { recursive: true });
process.stdout.write("Local auth secrets updated in .dev.vars (values not printed).\n");
