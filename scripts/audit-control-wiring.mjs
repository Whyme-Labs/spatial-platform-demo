import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const entryPoints = [
  {
    html: "studio.html",
    scripts: ["src/client/studio.ts"],
  },
  {
    html: "index.html",
    scripts: ["src/client/viewer.ts"],
  },
];

const failures = [];
let auditedButtons = 0;
let auditedLinks = 0;
let auditedForms = 0;
let auditedDynamicButtons = 0;
let auditedDynamicLinks = 0;

for (const entryPoint of entryPoints) {
  const html = await readProjectFile(entryPoint.html);
  const source = (await Promise.all(entryPoint.scripts.map(readProjectFile))).join("\n");
  const forms = Array.from(html.matchAll(/<form\b([^>]*)>/gi));
  const buttons = Array.from(html.matchAll(/<button\b([^>]*)>/gi));
  const links = Array.from(html.matchAll(/<a\b([^>]*)>/gi));

  for (const formMatch of forms) {
    const attributes = parseAttributes(formMatch[1] ?? "");
    if (attributes.method?.toLowerCase() === "dialog") continue;
    auditedForms += 1;
    if (!attributes.id) {
      failures.push(`${entryPoint.html}:${lineAt(html, formMatch.index ?? 0)} interactive form has no stable id`);
      continue;
    }
    if (!hasSubmitBinding(source, attributes.id)) {
      failures.push(
        `${entryPoint.html}:${lineAt(html, formMatch.index ?? 0)} form #${attributes.id} has no submit binding`,
      );
    }
  }

  for (const buttonMatch of buttons) {
    const attributes = parseAttributes(buttonMatch[1] ?? "");
    auditedButtons += 1;

    if (attributes.type?.toLowerCase() === "submit") {
      continue;
    }
    if (attributes.id) {
      if (!sourceReferencesIdentifier(source, attributes.id)) {
        failures.push(
          `${entryPoint.html}:${lineAt(html, buttonMatch.index ?? 0)} button #${attributes.id} is not referenced by its client entry point`,
        );
      }
      continue;
    }

    const delegatedSelector = delegatedSelectorFor(attributes);
    if (!delegatedSelector || !source.includes(delegatedSelector)) {
      failures.push(
        `${entryPoint.html}:${lineAt(html, buttonMatch.index ?? 0)} button without an id has no auditable delegated-action selector`,
      );
    }
  }

  for (const linkMatch of links) {
    const attributes = parseAttributes(linkMatch[1] ?? "");
    auditedLinks += 1;
    if (!attributes.href?.trim()) {
      failures.push(
        `${entryPoint.html}:${lineAt(html, linkMatch.index ?? 0)} link has no destination`,
      );
    }
  }
}

const clientEntryPaths = [...new Set(entryPoints.flatMap((entryPoint) => entryPoint.scripts))]
  .map((path) => fileURLToPath(new URL(`../${path}`, import.meta.url)));
const program = ts.createProgram(clientEntryPaths, {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  skipLibCheck: true,
});
const checker = program.getTypeChecker();
for (const sourceFile of program.getSourceFiles()) {
  if (!clientEntryPaths.includes(sourceFile.fileName)) continue;
  const relativePath = sourceFile.fileName.slice(
    fileURLToPath(new URL("../", import.meta.url)).length,
  );
  visit(sourceFile, (node) => {
    if (
      !ts.isVariableDeclaration(node)
      || !ts.isIdentifier(node.name)
    ) return;
    const symbol = checker.getSymbolAtLocation(node.name);
    if (isDynamicElementInitializer(node.initializer, "button")) {
      auditedDynamicButtons += 1;
      if (symbol && symbolHasClickBinding(sourceFile, checker, symbol)) return;
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      failures.push(
        `${relativePath}:${line} dynamic button ${node.name.text} has no symbol-bound click handler`,
      );
      return;
    }
    if (isDynamicElementInitializer(node.initializer, "a")) {
      auditedDynamicLinks += 1;
      if (symbol && symbolHasHrefBinding(sourceFile, checker, symbol)) return;
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      failures.push(
        `${relativePath}:${line} dynamic link ${node.name.text} has no symbol-bound destination`,
      );
    }
  });
}

if (failures.length) {
  console.error("Control-wiring audit failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Control-wiring audit passed for ${auditedButtons} static buttons, ` +
      `${auditedDynamicButtons} dynamic buttons, ${auditedLinks} static links, ` +
      `${auditedDynamicLinks} dynamic links, and ${auditedForms} interactive forms.`,
  );
}

async function readProjectFile(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

function parseAttributes(source) {
  const attributes = {};
  for (const match of source.matchAll(/([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const name = (match[1] ?? "").toLowerCase();
    attributes[name] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function sourceReferencesIdentifier(source, id) {
  const escaped = escapeRegExp(id);
  return new RegExp(`(?:["'#]${escaped}["']|\\b${escaped}\\b)`).test(source);
}

function hasSubmitBinding(source, id) {
  const escaped = escapeRegExp(id);
  const direct = new RegExp(
    `(?:byId(?:<[^>]+>)?\\(["']${escaped}["']\\)|querySelector(?:<[^>]+>)?\\(["']#${escaped}["']\\))[\\s\\S]{0,160}addEventListener\\(["']submit["']`,
  );
  if (direct.test(source)) return true;

  const declaration = new RegExp(
    `(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:byId(?:<[^>]+>)?\\(["']${escaped}["']\\)|document\\.querySelector(?:<[^>]+>)?\\(["']#${escaped}["']\\))`,
  ).exec(source);
  if (!declaration?.[1]) return false;
  return new RegExp(
    `\\b${escapeRegExp(declaration[1])}\\.addEventListener\\(["']submit["']`,
  ).test(source);
}

function delegatedSelectorFor(attributes) {
  const classes = (attributes.class ?? "").split(/\s+/).filter(Boolean);
  for (const className of classes) {
    const selector = `.${className}`;
    if (selector === ".nav-item" || selector === ".filter-chip") return selector;
  }
  if ("data-close-dialog" in attributes) return "[data-close-dialog]";
  if ("data-stage" in attributes && attributes.role === "tab") return ".workflow-tabs";
  return null;
}

function lineAt(contents, index) {
  return contents.slice(0, index).split("\n").length;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function visit(node, visitor) {
  visitor(node);
  node.forEachChild((child) => visit(child, visitor));
}

function isDynamicElementInitializer(initializer, tagName) {
  if (!initializer || !ts.isCallExpression(initializer)) return false;
  if (
    ts.isIdentifier(initializer.expression)
    && initializer.expression.text === "element"
    && stringArgument(initializer.arguments[0]) === tagName
  ) return true;
  return (
    ts.isPropertyAccessExpression(initializer.expression)
    && ts.isIdentifier(initializer.expression.expression)
    && initializer.expression.expression.text === "document"
    && initializer.expression.name.text === "createElement"
    && stringArgument(initializer.arguments[0]) === tagName
  );
}

function symbolHasClickBinding(sourceFile, checker, targetSymbol) {
  let found = false;
  visit(sourceFile, (node) => {
    if (found) return;
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "addEventListener"
      && stringArgument(node.arguments[0]) === "click"
      && identifierResolvesTo(node.expression.expression, checker, targetSymbol)
    ) {
      found = true;
      return;
    }
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isPropertyAccessExpression(node.left)
      && node.left.name.text === "onclick"
      && identifierResolvesTo(node.left.expression, checker, targetSymbol)
    ) {
      found = true;
    }
  });
  return found;
}

function symbolHasHrefBinding(sourceFile, checker, targetSymbol) {
  let found = false;
  visit(sourceFile, (node) => {
    if (found) return;
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isPropertyAccessExpression(node.left)
      && node.left.name.text === "href"
      && identifierResolvesTo(node.left.expression, checker, targetSymbol)
    ) {
      found = true;
      return;
    }
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "setAttribute"
      && stringArgument(node.arguments[0]) === "href"
      && identifierResolvesTo(node.expression.expression, checker, targetSymbol)
    ) {
      found = true;
    }
  });
  return found;
}

function identifierResolvesTo(node, checker, targetSymbol) {
  return ts.isIdentifier(node) && checker.getSymbolAtLocation(node) === targetSymbol;
}

function stringArgument(node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : null;
}
