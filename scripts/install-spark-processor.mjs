import { copyFile, mkdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const toolRoot = join(repositoryRoot, ".tools");
const sourceDirectory = join(toolRoot, "src", "spark-v2.1.0");
const binaryDirectory = join(toolRoot, "bin");
const installedBinary = join(binaryDirectory, process.platform === "win32" ? "spark-build-lod.exe" : "spark-build-lod");
const expectedCommit = "f22236f95fdd8078f0c12e3aab479523d401daf6";

await mkdir(dirname(sourceDirectory), { recursive: true });
await mkdir(binaryDirectory, { recursive: true });

if (!(await exists(join(sourceDirectory, ".git")))) {
  execFileSync("git", [
    "clone",
    "--depth", "1",
    "--branch", "v2.1.0",
    "https://github.com/sparkjsdev/spark.git",
    sourceDirectory,
  ], { stdio: "inherit" });
}

const actualCommit = execFileSync("git", ["-C", sourceDirectory, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
if (actualCommit !== expectedCommit) {
  throw new Error(
    `Refusing to build an unpinned Spark checkout. Expected ${expectedCommit}, found ${actualCommit}.`,
  );
}

execFileSync("cargo", [
  "build",
  "--manifest-path", join(sourceDirectory, "rust", "build-lod", "Cargo.toml"),
  "--release",
  "--no-default-features",
], { stdio: "inherit" });

const builtBinary = join(sourceDirectory, "rust", "target", "release", process.platform === "win32" ? "build-lod.exe" : "build-lod");
await copyFile(builtBinary, installedBinary, constants.COPYFILE_FICLONE);
if (process.platform !== "win32") {
  const { chmod } = await import("node:fs/promises");
  await chmod(installedBinary, 0o755);
}

console.log(JSON.stringify({
  event: "spark.processor.installed",
  sparkVersion: "2.1.0",
  commit: expectedCommit,
  binary: installedBinary,
}));

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
