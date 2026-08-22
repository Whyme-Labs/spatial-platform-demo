import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const entryPoints = [
  {
    html: "studio.html",
    scripts: [
      "src/client/studio.ts",
      "src/client/studio/stages/compare.ts",
    ],
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
let auditedRegistryFields = 0;
const studioFieldRegistry = JSON.parse(await readProjectFile("config/studio-field-registry.json"));
const workerSource = (await Promise.all([
  "src/worker/index.ts",
  "src/worker/routes/comparison.ts",
].map(readProjectFile))).join("\n");

for (const entryPoint of entryPoints) {
  const html = await readProjectFile(entryPoint.html);
  const source = (await Promise.all(entryPoint.scripts.map(readProjectFile))).join("\n");
  const declaredIds = new Set(
    Array.from(html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi), (match) => match[1]),
  );
  for (const match of source.matchAll(/\.id\s*=\s*["']([^"']+)["']/g)) {
    declaredIds.add(match[1]);
  }
  for (const lookup of source.matchAll(/\bbyId(?:<[^>]+>)?\(["']([^"']+)["']\)/g)) {
    const id = lookup[1];
    if (!declaredIds.has(id)) {
      failures.push(
        `${entryPoint.scripts.join(",")}:${lineAt(source, lookup.index ?? 0)} looks up missing #${id}`,
      );
    }
  }
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
      if (
        "hidden" in attributes &&
        !attributes["data-reachable-when"]?.trim() &&
        !hiddenControlCanBecomeVisible(source, attributes.id)
      ) {
        failures.push(
          `${entryPoint.html}:${lineAt(html, buttonMatch.index ?? 0)} hidden button #${attributes.id} has no reachable visible state`,
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

  for (const detailsMatch of html.matchAll(/<details\b([^>]*)>([\s\S]*?)<\/details>/gi)) {
    const attributes = parseAttributes(detailsMatch[1] ?? "");
    if ("open" in attributes) continue;
    const requiredControl = Array.from(
      (detailsMatch[2] ?? "").matchAll(/<(?:input|select|textarea)\b([^>]*)>/gi),
    ).find((control) => "required" in parseAttributes(control[1] ?? ""));
    if (requiredControl) {
      failures.push(
        `${entryPoint.html}:${lineAt(html, detailsMatch.index ?? 0)} closed details contain a hidden required field`,
      );
    }
  }

  if (entryPoint.html === "studio.html") {
    auditStudioWorkflow(html, source);
    auditUploadAcceptCoverage(html, source);
    auditStudioFieldRegistry(html, source, workerSource, studioFieldRegistry);
    await auditUploadPurposeOptions(html);
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
      ` Field registry: ${auditedRegistryFields} governed lifecycle fields.`,
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

function hiddenControlCanBecomeVisible(source, id) {
  const escaped = escapeRegExp(id);
  const directTargets = [
    `byId(?:<[^>]+>)?\\(["']${escaped}["']\\)`,
    `document\\.getElementById\\(["']${escaped}["']\\)`,
    `document\\.querySelector(?:<[^>]+>)?\\(["']#${escaped}["']\\)`,
  ];
  const declarations = new Set();
  for (const target of directTargets) {
    for (const match of source.matchAll(
      new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${target}`, "g"),
    )) {
      if (match[1]) declarations.add(escapeRegExp(match[1]));
    }
  }
  const targets = [...directTargets, ...declarations];
  for (const target of targets) {
    for (const match of source.matchAll(
      new RegExp(`(?:${target})\\.hidden\\s*=\\s*([^;\\n]+)`, "g"),
    )) {
      if (match[1]?.trim() !== "true") return true;
    }
    if (
      new RegExp(`(?:${target})\\.removeAttribute\\(\\s*["']hidden["']\\s*\\)`).test(source)
    ) return true;
  }
  return false;
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

function auditStudioWorkflow(html, source) {
  // The walk stage dissolved once its embedded viewer and its publication gate
  // were removed: routes and the walking profile are structural authoring, and
  // build receipts are raw evidence Expert already owns.
  const mandatoryStages = ["structure", "publish"];
  const journeyDestinations = projectJourneyDestinations(source);
  const sectionValues = new Set(
    Array.from(html.matchAll(/data-project-section=["']([^"']+)["']/g), (match) => match[1]),
  );
  for (const stage of mandatoryStages) {
    if (!sectionValues.has(stage)) {
      failures.push(`studio.html project navigation is missing mandatory ${stage} stage`);
    }
    if (!journeyDestinations.has(stage)) {
      failures.push(`src/client/studio.ts journey is missing a ${stage} destination`);
    }
  }
  if (!source.includes('step.dataset.projectJourneySection = target') ||
    !source.includes('activateProjectSection(target, true, "push", true)')) {
    failures.push("src/client/studio.ts journey steps do not expose routed keyboard buttons");
  }
  if (html.includes("Advanced evidence and diagnostics") ||
    source.includes("Advanced evidence and diagnostics") ||
    html.includes("spatial-advanced-workflows")) {
    failures.push("mandatory spatial workflow still belongs to an Advanced disclosure");
  }
  if (!html.includes('id="newProjectTemplate"') ||
    !source.includes('form.get("projectTemplate")')) {
    failures.push("project templates have no reachable creation application path");
  }
  if (!source.includes('firstIncompleteProjectSection(detail)')) {
    failures.push("project open does not route to the first incomplete mandatory stage");
  }
  const nativePublicationConfirmations = findNativePublicationConfirmations(source);
  if (nativePublicationConfirmations.length) {
    failures.push(
      `multi-stage publication decisions still use native browser confirmation: ${nativePublicationConfirmations.join(", ")}`,
    );
  }
}

function findNativePublicationConfirmations(source) {
  const sourceFile = ts.createSourceFile(
    "src/client/studio.ts",
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );
  const confirmations = [];
  visit(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return;
    const directConfirm = ts.isIdentifier(node.expression) && node.expression.text === "confirm";
    const windowConfirm = ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "window" &&
      node.expression.name.text === "confirm";
    if (!directConfirm && !windowConfirm) return;
    const decision = node.arguments[0]?.getText(sourceFile) ?? "";
    if (!/(?:republish|publish(?:ed|ing)?|\/s\/|historical release|release channel)/i.test(decision)) {
      return;
    }
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    confirmations.push(`src/client/studio.ts:${line}`);
  });
  return confirmations;
}

function projectJourneyDestinations(source) {
  const sourceFile = ts.createSourceFile(
    "src/client/studio.ts",
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );
  const destinations = new Set();
  visit(sourceFile, (node) => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isIdentifier(node.expression) ||
      node.expression.text !== "projectJourneyStep"
    ) return;
    const destination = stringArgument(node.arguments.at(-1));
    if (destination) destinations.add(destination);
  });
  return destinations;
}

// The upload dialog's purpose options are static markup, while the vocabulary
// they must mirror lives in src/shared/capture-adapters.ts. That split once
// stranded a shipped purpose (scanner_trajectory): the Worker accepted it and
// the format map knew it, but no operator could choose it. Every declared
// purpose must be selectable, in the declared order.
async function auditUploadPurposeOptions(html) {
  const shared = await readProjectFile("src/shared/capture-adapters.ts");
  const declaration = shared.match(
    /export const captureAssetPurposes = \[([\s\S]*?)\] as const;/,
  );
  if (!declaration) {
    failures.push("src/shared/capture-adapters.ts declares no captureAssetPurposes array");
    return;
  }
  const declared = [...declaration[1].matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
  const select = html.match(/<select id="uploadPurpose"[^>]*>([\s\S]*?)<\/select>/);
  if (!select) {
    failures.push("studio.html has no #uploadPurpose select to audit");
    return;
  }
  const offered = [...select[1].matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]);
  const missing = declared.filter((purpose) => !offered.includes(purpose));
  const unknown = offered.filter((purpose) => !declared.includes(purpose));
  for (const purpose of missing) {
    failures.push(`upload purpose ${purpose} is declared but has no #uploadPurpose option`);
  }
  for (const purpose of unknown) {
    failures.push(`#uploadPurpose offers ${purpose}, which is not a declared capture asset purpose`);
  }
  if (!missing.length && !unknown.length &&
    declared.join(",") !== offered.join(",")) {
    failures.push("#uploadPurpose option order differs from the declared capture asset purposes");
  }
}

// The upload picker must offer every extension the purposes accept. A literal
// accept attribute drifted from the vocabulary and hid metric point clouds and
// scanner trajectories from the file dialog while the purpose menu still
// offered them, so the attribute must be derived in code, never hardcoded.
function auditUploadAcceptCoverage(html, source) {
  const input = html.match(/id="uploadAssetInput"[^>]*/)?.[0] ?? "";
  if (!input) {
    failures.push("studio.html has no uploadAssetInput file control");
    return;
  }
  if (/accept=/.test(input)) {
    failures.push(
      "uploadAssetInput pins a literal accept attribute: derive it from captureAssetFormats so the picker cannot drift from the purposes",
    );
  }
  if (!source.includes("uploadAssetInput.accept = captureAssetFormats")) {
    failures.push(
      "the upload picker no longer derives its accept list from the shared capture vocabulary",
    );
  }
  // Narrowing the picker per purpose is the same bug wearing a different hat:
  // the purpose is detected FROM the chosen file, so a picker restricted to
  // the current purpose can never show the file that would correct it.
  if (/fileInput\.accept\s*=/.test(source)) {
    failures.push(
      "the upload picker is narrowed to the selected purpose: the file must be choosable before its purpose is known",
    );
  }
}

function auditStudioFieldRegistry(html, source, worker, registry) {
  if (registry.schemaVersion !== "studio-field-registry-v1") {
    failures.push("config/studio-field-registry.json has an unsupported schemaVersion");
    return;
  }
  const governedForms = new Set(registry.governedForms ?? []);
  const fields = [
    ...(Array.isArray(registry.fields) ? registry.fields : []),
    ...expandFieldSets(registry.fieldSets),
  ];
  const ids = new Set();
  const fieldKeys = new Set();
  const allowedAudiences = new Set(["operator", "expert", "internal"]);
  const allowedStages = new Set([
    "admin", "capture", "expert", "hosting", "measurement", "overview", "portfolio",
    "structure", "privacy", "walk", "publish",
  ]);
  for (const field of fields) {
    auditedRegistryFields += 1;
    if (!field?.id || ids.has(field.id)) {
      failures.push(`field registry has a missing or duplicate id ${JSON.stringify(field?.id)}`);
      continue;
    }
    ids.add(field.id);
    const key = `${field.form}:${field.name}`;
    if (fieldKeys.has(key)) failures.push(`field registry duplicates ${key}`);
    fieldKeys.add(key);
    if (!governedForms.has(field.form)) {
      failures.push(`field registry ${field.id} belongs to ungoverned form ${field.form}`);
    }
    if (!allowedAudiences.has(field.audience)) {
      failures.push(`field registry ${field.id} has unknown audience ${field.audience}`);
    }
    if (!allowedStages.has(field.stage)) {
      failures.push(`field registry ${field.id} has unknown stage ${field.stage}`);
    }
    for (const property of ["requestPath", "persistencePath", "consumer", "readback"]) {
      if (typeof field[property] !== "string" || !field[property].trim()) {
        failures.push(`field registry ${field.id} has no ${property}`);
      }
    }
    const formHtml = htmlFormBody(html, field.form);
    if (formHtml === null) {
      failures.push(`field registry ${field.id} references missing form #${field.form}`);
      continue;
    }
    const control = namedControl(formHtml, field.name);
    if (!control) {
      failures.push(`field registry ${field.id} references missing ${field.form}[name=${field.name}]`);
      continue;
    }
    if (!namedControlHasVisibleLabel(formHtml, field.name)) {
      failures.push(`field registry ${field.id} has no visible label in #${field.form}`);
    }
    const expertControl = expertControlNames(formHtml).has(field.name);
    if (expertControl !== (field.audience === "expert")) {
      failures.push(
        `field registry ${field.id} audience=${field.audience} does not match its ${
          expertControl ? "Expert" : "Recommended"
        } surface`,
      );
    }
    const controlAttributes = parseAttributes(control.attributes);
    if (controlAttributes.type === "number" &&
      (typeof field.unit !== "string" || !field.unit.trim())) {
      failures.push(`numeric field registry ${field.id} has no unit`);
    }
    if (field.audience === "expert" &&
      (typeof field.explanation !== "string" || !field.explanation.trim())) {
      failures.push(`expert field registry ${field.id} has no plain-language explanation`);
    }
    if (field.required === true) {
      const attributes = parseAttributes(control.attributes);
      if (control.tag !== "select" && !("required" in attributes)) {
        failures.push(`field registry ${field.id} is required but its visible control is not required`);
      }
    }
    if ("required" in controlAttributes && field.required !== true) {
      failures.push(`field registry ${field.id} understates a required visible control`);
    }
    if (!source.includes(field.consumer) && !worker.includes(field.consumer)) {
      failures.push(`field registry ${field.id} consumer ${field.consumer} is not in Studio or the Worker`);
    }
    if (!source.includes(field.readback)) {
      failures.push(`field registry ${field.id} readback ${field.readback} is not in Studio`);
    }
    const persistenceRoot = field.persistencePath.split(/[.|]/)[0];
    if (!persistenceRoot || !worker.includes(persistenceRoot)) {
      failures.push(`field registry ${field.id} persistence ${field.persistencePath} is not in the Worker`);
    }
  }

  for (const match of html.matchAll(/<form\b([^>]*)>/gi)) {
    const attributes = parseAttributes(match[1] ?? "");
    if (attributes.method?.toLowerCase() === "dialog" || attributes.id === "loginForm") continue;
    if (attributes.id && !governedForms.has(attributes.id)) {
      failures.push(`authenticated Studio form #${attributes.id} is absent from the field registry`);
    }
  }

  for (const formId of governedForms) {
    const formHtml = htmlFormBody(html, formId);
    if (formHtml === null) {
      failures.push(`governed field-registry form #${formId} is missing`);
      continue;
    }
    for (const match of formHtml.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)) {
      const attributes = parseAttributes(match[2] ?? "");
      if (!attributes.name || attributes.type === "hidden") continue;
      if (!fieldKeys.has(`${formId}:${attributes.name}`)) {
        failures.push(
          `${formId}[name=${attributes.name}] is visible in Recommended mode but absent from the field registry`,
        );
      }
    }
  }
}

function expandFieldSets(fieldSets) {
  if (!Array.isArray(fieldSets)) return [];
  const expanded = [];
  for (const set of fieldSets) {
    const required = new Set(set?.required ?? []);
    const expertFields = new Set(set?.expertFields ?? []);
    for (const name of set?.fields ?? []) {
      expanded.push({
        id: `${set.idPrefix}.${name}`,
        form: set.form,
        name,
        audience: expertFields.has(name) ? "expert" : set.audience,
        stage: set.stage,
        required: required.has(name),
        requestPath: `${set.requestPath}.${name}`,
        persistencePath: `${set.persistencePath}.*`,
        consumer: set.consumer,
        readback: set.readback,
        unit: set.units?.[name],
        explanation: set.explanations?.[name] ?? set.explanation,
      });
    }
  }
  return expanded;
}

function namedControlHasVisibleLabel(formHtml, name) {
  const escaped = escapeRegExp(name);
  return new RegExp(
    `<label\\b[^>]*>[\\s\\S]*?<(?:input|select|textarea)\\b[^>]*\\bname=["']${escaped}["'][^>]*>[\\s\\S]*?<\\/label>`,
    "i",
  ).test(formHtml);
}

function expertControlNames(formHtml) {
  const names = new Set();
  for (const match of formHtml.matchAll(/<details\b([^>]*)>([\s\S]*?)<\/details>/gi)) {
    const attributes = parseAttributes(match[1] ?? "");
    const body = match[2] ?? "";
    const classes = new Set((attributes.class ?? "").split(/\s+/));
    const expertSummary = /<summary\b[^>]*>[^<]*(?:Expert|Advanced)/i.test(body);
    if (!classes.has("form-advanced-settings") || !expertSummary) {
      continue;
    }
    for (const control of body.matchAll(/<(?:input|select|textarea)\b([^>]*)>/gi)) {
      const name = parseAttributes(control[1] ?? "").name;
      if (name) names.add(name);
    }
  }
  return names;
}

function htmlFormBody(html, formId) {
  const match = new RegExp(`<form\\b[^>]*\\bid=["']${escapeRegExp(formId)}["'][^>]*>([\\s\\S]*?)<\\/form>`, "i").exec(html);
  return match?.[1] ?? null;
}

function namedControl(formHtml, name) {
  for (const match of formHtml.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)) {
    const attributes = parseAttributes(match[2] ?? "");
    if (attributes.name === name) return { tag: match[1].toLowerCase(), attributes: match[2] ?? "" };
  }
  return null;
}
