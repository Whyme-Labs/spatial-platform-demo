import { randomBytes, webcrypto } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const command = process.argv[2] ?? "new";
const inputPath = process.argv[3];
const outputPath = process.argv[4];

if (!["new", "rotate"].includes(command) || (command === "rotate" && !inputPath)) {
  throw new Error("Usage: node scripts/auth-keyring.mjs new [output.json] OR rotate current.json output.json");
}

const now = new Date();
const newKey = await createKey(now);
let ring;
if (command === "rotate") {
  const current = JSON.parse(await readFile(inputPath, "utf8"));
  validateRing(current);
  const overlapEnd = new Date(now.getTime() + 10 * 60_000).toISOString();
  ring = {
    version: 1,
    activeKid: newKey.kid,
    keys: [
      newKey,
      ...current.keys.map((key) => ({
        ...key,
        status: "verify",
        retireAfter: key.retireAfter ?? overlapEnd,
      })),
    ],
  };
} else {
  ring = { version: 1, activeKid: newKey.kid, keys: [newKey] };
}

const serialized = JSON.stringify(ring);
if (outputPath ?? (command === "new" ? inputPath : undefined)) {
  await writeFile(outputPath ?? inputPath, serialized, { mode: 0o600 });
} else {
  process.stdout.write(serialized);
}

async function createKey(createdAt) {
  const { privateKey } = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const privateJwk = await webcrypto.subtle.exportKey("jwk", privateKey);
  const kid = `es256-${createdAt.toISOString().slice(0, 10)}-${randomBytes(4).toString("hex")}`;
  return {
    kid,
    status: "active",
    privateJwk,
    createdAt: createdAt.toISOString(),
    notBefore: new Date(createdAt.getTime() - 60_000).toISOString(),
  };
}

function validateRing(value) {
  if (
    value?.version !== 1 ||
    typeof value.activeKid !== "string" ||
    !Array.isArray(value.keys) ||
    !value.keys.some((key) => key.kid === value.activeKid && key.privateJwk?.d)
  ) throw new Error("Input is not a valid private Spatial Studio JWT key ring");
}
