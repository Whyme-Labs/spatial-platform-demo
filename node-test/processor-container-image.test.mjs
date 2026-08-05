import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

function dockerfileInstructions(source) {
  // Rejoin backslash line continuations so multi-line COPY and ENTRYPOINT
  // instructions parse as single logical lines.
  return source
    .replace(/\\\r?\n/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function copiedScriptPaths(instructions) {
  const copied = new Set();
  for (const instruction of instructions) {
    if (!/^COPY\s/i.test(instruction)) continue;
    const words = instruction
      .replace(/^COPY\s+/i, "")
      .split(/\s+/)
      .filter((word) => !word.startsWith("--"));
    // The final operand is the in-image destination; everything before it is a
    // build-context source.
    for (const source of words.slice(0, -1)) {
      if (source.startsWith("scripts/") && source.endsWith(".mjs")) copied.add(source);
    }
  }
  return copied;
}

function entrypointScriptPaths(instructions) {
  const entry = new Set();
  for (const instruction of instructions) {
    if (!/^ENTRYPOINT\s/i.test(instruction) && !/^CMD\s/i.test(instruction)) continue;
    for (const match of instruction.matchAll(/["']([^"']+\.mjs)["']/g)) {
      entry.add(match[1].replace(/^\.\//, ""));
    }
  }
  return entry;
}

function relativeImportSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*["']([^"']+)["']/g,
    /(?:^|\n)\s*import\s*["']([^"']+)["']/g,
    /import\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1].startsWith("./") || match[1].startsWith("../")) specifiers.add(match[1]);
    }
  }
  return specifiers;
}

async function reachableLocalModules(rootScripts) {
  const reachable = new Set();
  const queue = [...rootScripts];
  while (queue.length) {
    const scriptPath = queue.shift();
    if (reachable.has(scriptPath)) continue;
    reachable.add(scriptPath);
    const source = await readFile(path.join(repositoryRoot, scriptPath), "utf8");
    for (const specifier of relativeImportSpecifiers(source)) {
      const resolved = path
        .join(path.dirname(scriptPath), specifier)
        .split(path.sep)
        .join("/");
      queue.push(resolved);
    }
  }
  return reachable;
}

describe("processor container image", () => {
  it("copies every local module reachable from the entrypoint import graph", async () => {
    const instructions = dockerfileInstructions(
      await readFile(path.join(repositoryRoot, "processor", "Dockerfile"), "utf8"),
    );
    const copied = copiedScriptPaths(instructions);
    const entrypoints = entrypointScriptPaths(instructions);
    assert.ok(entrypoints.size, "Dockerfile must declare an ENTRYPOINT script");
    for (const entrypoint of entrypoints) {
      assert.ok(
        copied.has(entrypoint),
        `ENTRYPOINT script ${entrypoint} is not copied into the image`,
      );
    }
    const reachable = await reachableLocalModules(new Set([...entrypoints, ...copied]));
    const missing = [...reachable].filter((module) => !copied.has(module)).sort();
    assert.deepEqual(
      missing,
      [],
      `Dockerfile COPY is missing local modules required at runtime: ${missing.join(", ")}`,
    );
  });
});
