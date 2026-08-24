import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import ts from "typescript";

const rootDirectory = process.cwd();
const stylesDirectory = path.join(rootDirectory, "src/client/styles");
const entries = {
  "studio-entry.css": ["primitives.css", "studio.css", "exceptions.css"],
  "viewer-entry.css": ["primitives.css", "marketing.css", "viewer.css", "exceptions.css"],
};
const owners = ["primitives", "marketing", "studio", "viewer", "exceptions"];
const runtimeCustomProperties = new Set([
  "--handoff-progress",
  "--renderer-help-height",
]);
const coreStudioFamily = /\.(?:studio-shell|studio-grid|studio-sidebar|studio-nav(?:-advanced)?|project-section-nav|project-section-picker|dialog-card|dialog-shell(?:-[\w-]+)?|record-(?:row|primary|status|evidence|actions))\b/;
const feedbackBase = /^\.(?:form-error|field-message|action-feedback)(?::|$)/;
const errors = [];
const reports = [];
const definitions = new Set();
const uses = new Set();
const selectorInventory = new Set();

function parse(fileName) {
  const absolutePath = path.join(stylesDirectory, fileName);
  return {
    absolutePath,
    css: fs.readFileSync(absolutePath, "utf8"),
    root: postcss.parse(fs.readFileSync(absolutePath, "utf8"), {
      from: absolutePath,
    }),
  };
}

function atRuleContext(node) {
  const context = [];
  let parent = node.parent;
  while (parent && parent.type !== "root") {
    if (parent.type === "atrule") context.unshift(`@${parent.name} ${parent.params}`);
    parent = parent.parent;
  }
  return context.join(" > ");
}

function insideAtRule(node, name, parameter) {
  let parent = node.parent;
  while (parent && parent.type !== "root") {
    if (
      parent.type === "atrule"
      && parent.name === name
      && parent.params.includes(parameter)
    ) return true;
    parent = parent.parent;
  }
  return false;
}

function selectorOwnsPageRoot(selector) {
  return /^(?:html|body|\.studio-page|\.viewer-page|\.marketing-page-body)(?:\s*$|\s*,)/.test(
    selector.trim(),
  );
}

for (const [entryFile, imports] of Object.entries(entries)) {
  const { root } = parse(entryFile);
  const actualImports = root.nodes
    .filter((node) => node.type === "atrule" && node.name === "import")
    .map((node) => node.params.match(/["']\.\/([^"']+)["']/)?.[1])
    .filter(Boolean);
  if (actualImports.join("|") !== imports.join("|")) {
    errors.push(`${entryFile}: imports must be ${imports.join(", ")} in that order`);
  }
  const expectedLayers = imports
    .map((fileName) => path.basename(fileName, ".css"))
    .join(",");
  const layerPrelude = root.nodes.find((node) => (
    node.type === "atrule" && node.name === "layer" && !node.nodes
  ));
  if (layerPrelude?.params.replaceAll(/\s+/g, "") !== expectedLayers) {
    errors.push(`${entryFile}: layer prelude must be ${expectedLayers}`);
  }
  const allowedTopLevel = root.nodes.every((node) => (
    node.type === "comment"
    || (node.type === "atrule" && (node.name === "import" || (node.name === "layer" && !node.nodes)))
  ));
  if (!allowedTopLevel) errors.push(`${entryFile}: entry files may contain only the layer prelude and imports`);
}

for (const owner of owners) {
  const fileName = `${owner}.css`;
  const { css, root } = parse(fileName);
  const topLevelLayers = root.nodes.filter((node) => (
    node.type === "atrule" && node.name === "layer" && node.nodes
  ));
  const unexpectedTopLevel = root.nodes.filter((node) => (
    node.type !== "comment" && !topLevelLayers.includes(node)
  ));
  if (
    topLevelLayers.length !== 1
    || topLevelLayers[0]?.params !== owner
    || unexpectedTopLevel.length
  ) {
    errors.push(`${fileName}: all rules must live in its single @layer ${owner} owner`);
  }

  let ruleCount = 0;
  let selectorCount = 0;
  let declarationCount = 0;
  let importantCount = 0;
  const selectorProperties = new Map();

  root.walkRules((rule) => {
    if (insideAtRule(rule, "keyframes", "")) return;
    ruleCount += 1;
    const selectors = postcss.list.comma(rule.selector);
    selectorCount += selectors.length;

    for (const selector of selectors) {
      const normalized = selector.trim();
      selectorInventory.add(normalized);
      if (
        owner !== "studio"
        && owner !== "exceptions"
        && coreStudioFamily.test(normalized)
      ) {
        errors.push(`${fileName}:${rule.source.start.line}: Studio contract selector is outside studio.css: ${normalized}`);
      }
      if (feedbackBase.test(normalized) && owner !== "primitives") {
        errors.push(`${fileName}:${rule.source.start.line}: feedback base selector is outside primitives.css: ${normalized}`);
      }
      if (owner === "studio" && /body\.studio-page\s/.test(normalized)) {
        errors.push(`${fileName}:${rule.source.start.line}: Studio page-root specificity escalation is prohibited`);
      }
      if (owner === "viewer" && !normalized.startsWith(".viewer-page")) {
        errors.push(`${fileName}:${rule.source.start.line}: viewer selector must be rooted at .viewer-page: ${normalized}`);
      }
      if (/#[A-Za-z_][\w-]*/.test(normalized)) {
        errors.push(`${fileName}:${rule.source.start.line}: ID selectors are prohibited: ${normalized}`);
      }

      for (const declaration of rule.nodes.filter((node) => node.type === "decl")) {
        const key = `${atRuleContext(rule)}|${normalized}|${declaration.prop.toLowerCase()}`;
        if (selectorProperties.has(key)) {
          errors.push(
            `${fileName}:${rule.source.start.line}: duplicate selector/property also defined at line ${selectorProperties.get(key)}: ${normalized} { ${declaration.prop} }`,
          );
        }
        selectorProperties.set(key, rule.source.start.line);
      }
    }
  });

  root.walkDecls((declaration) => {
    declarationCount += 1;
    if (declaration.prop.startsWith("--")) definitions.add(declaration.prop);
    for (const match of declaration.value.matchAll(/var\((--[\w-]+)/g)) uses.add(match[1]);

    if (declaration.important) {
      importantCount += 1;
      const allowed = owner === "exceptions"
        || (owner === "marketing" && insideAtRule(
          declaration,
          "media",
          "prefers-reduced-motion",
        ));
      if (!allowed) {
        errors.push(`${fileName}:${declaration.source.start.line}: !important is outside an accessibility exception`);
      }
    }

    if (
      owner !== "primitives"
      && declaration.parent?.type === "rule"
      && declaration.parent.selector.includes(".form-error")
      && /^(?:margin|padding)(?:-|$)/.test(declaration.prop)
    ) {
      errors.push(
        `${fileName}:${declaration.source.start.line}: contextual form-error spacing is prohibited`,
      );
    }

    if (
      /^(?:overflow|overflow-x)$/.test(declaration.prop)
      && /^(?:hidden|clip)$/.test(declaration.value.trim())
      && declaration.parent?.type === "rule"
      && selectorOwnsPageRoot(declaration.parent.selector)
    ) {
      const allowedViewerViewport = owner === "viewer"
        && declaration.parent.selector.trim() === ".viewer-page"
        && declaration.prop === "overflow"
        && declaration.value.trim() === "hidden";
      if (!allowedViewerViewport) {
        errors.push(
          `${fileName}:${declaration.source.start.line}: page-root overflow masking is prohibited`,
        );
      }
    }
  });

  reports.push({
    file: fileName,
    bytes: Buffer.byteLength(css),
    lines: css.split(/\n/).length,
    rules: ruleCount,
    selectors: selectorCount,
    declarations: declarationCount,
    important: importantCount,
  });
}

for (const [entryFile, imports] of Object.entries(entries)) {
  const selectorProperties = new Map();
  for (const fileName of imports) {
    const { root } = parse(fileName);
    root.walkRules((rule) => {
      if (insideAtRule(rule, "keyframes", "")) return;
      const condition = cascadeConditionContext(rule);
      for (const selector of postcss.list.comma(rule.selector)) {
        const normalized = selector.trim();
        for (const declaration of rule.nodes.filter((node) => node.type === "decl")) {
          const key = `${condition}|${normalized}|${declaration.prop.toLowerCase()}`;
          const previous = selectorProperties.get(key);
          if (previous && previous.fileName !== fileName) {
            errors.push(
              `${entryFile}: ${fileName}:${rule.source.start.line} duplicates ${normalized} { ${declaration.prop} } from ${previous.fileName}:${previous.line}`,
            );
          } else if (!previous) {
            selectorProperties.set(key, {
              fileName,
              line: rule.source.start.line,
            });
          }
        }
      }
    });
  }
}

for (const property of uses) {
  if (!definitions.has(property) && !runtimeCustomProperties.has(property)) {
    errors.push(`undefined custom property: ${property}`);
  }
}

const requiredStateSelectors = [
  ["disabled controls", (selector) => selector.includes("button:disabled")],
  ["pending actions", (selector) => selector === "button.is-pending"],
  ["empty field feedback", (selector) => selector === ".form-error:empty"],
  ["empty action feedback", (selector) => selector === ".action-feedback:empty"],
  ["visible keyboard focus", (selector) => selector.includes(":focus-visible")],
];
for (const [label, predicate] of requiredStateSelectors) {
  if (![...selectorInventory].some(predicate)) {
    errors.push(`missing shared UI state contract: ${label}`);
  }
}

const governedSurfaceClass = /(?:^|\s)(?:workspace-card-large|detail-card|project-detail-disclosure|notice-card|plan-card|domain-row|semantic-extraction-run|release-row|detail-line|record-row)(?:\s|$)/;
for (const fileName of studioTypeScriptFiles()) {
  const source = fs.readFileSync(fileName, "utf8");
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );
  visitTypeScript(sourceFile, (node) => {
    if (
      !ts.isCallExpression(node)
      || !ts.isIdentifier(node.expression)
      || node.expression.text !== "element"
    ) return;
    const classArgument = node.arguments[1];
    const staticClassText = classArgument && (
      ts.isStringLiteral(classArgument)
      || ts.isNoSubstitutionTemplateLiteral(classArgument)
    )
      ? classArgument.text
      : classArgument && ts.isTemplateExpression(classArgument)
        ? [
            classArgument.head.text,
            ...classArgument.templateSpans.map((span) => span.literal.text),
          ].join(" ")
        : "";
    if (!governedSurfaceClass.test(staticClassText)) return;
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    errors.push(
      `${path.relative(rootDirectory, fileName)}:${line}: governed surfaces must use a typed UI primitive`,
    );
  });
}

const packageJson = JSON.parse(fs.readFileSync(path.join(rootDirectory, "package.json"), "utf8"));
const ciWorkflow = fs.readFileSync(
  path.join(rootDirectory, ".github/workflows/ci.yml"),
  "utf8",
);
const requiredCompositionSpecs = [
  "e2e/ui-quality.spec.ts",
  "e2e/release-authoring.spec.ts",
  "e2e/published-viewer.spec.ts",
  "e2e/mobile-renderer.spec.ts",
];
if (
  !packageJson.scripts?.check?.includes("npm run test:e2e")
  || packageJson.scripts?.["test:e2e"] !== "playwright test"
  || !ciWorkflow.includes("npm run test:e2e")
) {
  errors.push("UI-affecting changes are not mapped to the required Playwright CI gate");
}
for (const spec of requiredCompositionSpecs) {
  if (!fs.existsSync(path.join(rootDirectory, spec))) {
    errors.push(`required responsive composition spec is missing: ${spec}`);
  }
}

const totals = reports.reduce((sum, report) => ({
  bytes: sum.bytes + report.bytes,
  lines: sum.lines + report.lines,
  rules: sum.rules + report.rules,
  selectors: sum.selectors + report.selectors,
  declarations: sum.declarations + report.declarations,
  important: sum.important + report.important,
}), {
  bytes: 0,
  lines: 0,
  rules: 0,
  selectors: 0,
  declarations: 0,
  important: 0,
});

const result = { files: reports, totals, errors };
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.table(reports);
  console.log("totals", totals);
}

if (errors.length) {
  for (const error of errors) console.error(`css-audit: ${error}`);
  process.exitCode = 1;
}

function studioTypeScriptFiles() {
  const files = [path.join(rootDirectory, "src/client/studio.ts")];
  const directory = path.join(rootDirectory, "src/client/studio");
  const visitDirectory = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) visitDirectory(absolutePath);
      else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(absolutePath);
    }
  };
  visitDirectory(directory);
  return files;
}

function visitTypeScript(node, visitor) {
  visitor(node);
  node.forEachChild((child) => visitTypeScript(child, visitor));
}

function cascadeConditionContext(node) {
  const context = [];
  let parent = node.parent;
  while (parent && parent.type !== "root") {
    if (parent.type === "atrule" && parent.name !== "layer") {
      context.unshift(`@${parent.name} ${parent.params}`);
    }
    parent = parent.parent;
  }
  return context.join(" > ");
}
