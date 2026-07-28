import { readFile } from "node:fs/promises";

const sources = [
  "src/client/studio.ts",
  "src/client/viewer.ts",
];

const failures = [];
for (const source of sources) {
  const contents = await readFile(new URL(`../${source}`, import.meta.url), "utf8");
  const lateFormData = /\}\s*,\s*\(\)\s*=>[^\n;]*new FormData\s*\(/g;
  for (const match of contents.matchAll(lateFormData)) {
    failures.push(`${source}:${lineAt(contents, match.index ?? 0)} constructs FormData after runAction disables controls`);
  }

  const submitHandlers = contents.matchAll(
    /addEventListener\("submit",\s*\(event\)\s*=>\s*\{([\s\S]*?)\n\s*\}\);/g,
  );
  for (const match of submitHandlers) {
    const body = match[1] ?? "";
    if (!body.includes("runAction(")) continue;
    const actionIndex = body.indexOf("runAction(");
    const formDataIndex = body.indexOf("new FormData(");
    if (formDataIndex === -1 || formDataIndex > actionIndex) {
      failures.push(`${source}:${lineAt(contents, match.index ?? 0)} must snapshot FormData before runAction`);
    }
  }

  const asyncFunctions = new Set(
    Array.from(contents.matchAll(/async function\s+([A-Za-z_$][\w$]*)\s*\(/g), (match) => match[1]),
  );
  const directAsyncHandlers = contents.matchAll(
    /addEventListener\(\s*["'][^"']+["']\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g,
  );
  for (const match of directAsyncHandlers) {
    const handler = match[1] ?? "";
    if (asyncFunctions.has(handler)) {
      failures.push(
        `${source}:${lineAt(contents, match.index ?? 0)} binds async ${handler} directly without an explicit pending/error wrapper`,
      );
    }
  }
}

if (failures.length) {
  console.error("Action-state audit failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Action-state audit passed for ${sources.length} client entry points.`);
}

function lineAt(contents, index) {
  return contents.slice(0, index).split("\n").length;
}
