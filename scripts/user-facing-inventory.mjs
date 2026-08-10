import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(repositoryRoot, "docs/verification/user-facing-inventory.md");
const writeMode = process.argv.includes("--write");

const [studioHtml, landingHtml, studioSource, viewerSource, workerSource, fieldRegistry, actionAudit] =
  await Promise.all([
    projectFile("studio.html"),
    projectFile("index.html"),
    projectFile("src/client/studio.ts"),
    projectFile("src/client/viewer.ts"),
    projectFile("src/worker/index.ts"),
    projectJson("config/studio-field-registry.json"),
    projectFile("docs/ACTION_STATE_AUDIT.md"),
  ]);

const htmlSurfaces = [
  extractHtmlSurfaces("studio.html", studioHtml),
  extractHtmlSurfaces("index.html", landingHtml),
];
const dynamicControls = [
  ...extractDynamicControls("src/client/studio.ts", studioSource),
  ...extractDynamicControls("src/client/viewer.ts", viewerSource),
];
const inventory = {
  roles: [
    ["platform_admin", "Platform administrator", "Operator work plus tenant administration, billing, identity, and handoffs."],
    ["production_operator", "Production operator", "Capture, structure, privacy, walk-test, measurement, review, and publication."],
    ["customer_reviewer", "Customer reviewer", "Invited-project review, comments, and decisions only."],
    ["customer_readonly", "Customer read only", "Invited-project viewing without comments or decisions."],
  ].map(([id, label, scope]) => ({ id, label, scope })),
  routes: extractRoutes(workerSource, studioHtml),
  htmlSurfaces,
  dynamicControls,
  fields: expandFieldRegistry(fieldRegistry),
  states: await extractPersistedStates(),
  workflows: extractActionWorkflows(actionAudit),
};
const report = renderReport(inventory);

if (writeMode) {
  await writeFile(outputPath, report);
  process.stdout.write(`Wrote ${relative(repositoryRoot, outputPath)}\n`);
} else {
  const existing = await readFile(outputPath, "utf8").catch(() => "");
  if (existing !== report) {
    process.stderr.write("User-facing inventory is stale. Run `npm run inventory:write` and review the diff.\n");
    process.exitCode = 1;
  } else {
    const staticControls = htmlSurfaces.reduce(
      (count, surface) => count + surface.buttons.length + surface.links.length,
      0,
    );
    process.stdout.write(
      `User-facing inventory is current: ${inventory.roles.length} roles, ${inventory.routes.length} routes, ` +
        `${inventory.fields.length} fields, ${staticControls + dynamicControls.length} controls, ` +
        `${inventory.states.length} persisted state sets, and ${inventory.workflows.length} workflows.\n`,
    );
  }
}

async function projectFile(path) {
  return readFile(resolve(repositoryRoot, path), "utf8");
}

async function projectJson(path) {
  return JSON.parse(await projectFile(path));
}

function parseAttributes(source) {
  const attributes = {};
  for (const match of source.matchAll(/([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    attributes[(match[1] ?? "").toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function extractHtmlSurfaces(path, source) {
  const stack = [];
  const result = { path, forms: [], dialogs: [], buttons: [], links: [], inputs: [] };
  for (const token of source.matchAll(/<\/?([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    const raw = token[0];
    const tag = (token[1] ?? "").toLowerCase();
    if (raw.startsWith("</")) {
      const index = stack.map((entry) => entry.tag).lastIndexOf(tag);
      if (index >= 0) stack.splice(index);
      continue;
    }
    const attributes = parseAttributes(token[2] ?? "");
    const line = lineAt(source, token.index ?? 0);
    const form = [...stack].reverse().find((entry) => entry.tag === "form")?.attributes.id ?? null;
    const dialog = [...stack].reverse().find((entry) => entry.tag === "dialog")?.attributes.id ?? null;
    const section = [...stack].reverse().find((entry) => entry.attributes["data-section"] || entry.attributes["data-project-section"]);
    const sectionId = section?.attributes["data-section"] ?? section?.attributes["data-project-section"] ?? null;
    const text = ["button", "a"].includes(tag)
      ? textUntilClosingTag(source, (token.index ?? 0) + raw.length, tag)
      : "";
    const base = {
      id: attributes.id ?? `${path}:${tag}:${line}`,
      source: `${path}:${line}`,
      form,
      dialog,
      section: sectionId,
      label: text || attributes["aria-label"] || attributes.name || attributes.id || "Unlabelled",
    };
    if (tag === "form" && attributes.method?.toLowerCase() !== "dialog") {
      result.forms.push(base);
    } else if (tag === "dialog") {
      result.dialogs.push(base);
    } else if (tag === "button") {
      result.buttons.push({ ...base, type: attributes.type?.toLowerCase() ?? "submit" });
    } else if (tag === "a") {
      result.links.push({ ...base, href: attributes.href ?? "" });
    } else if (["input", "select", "textarea"].includes(tag) && attributes.type !== "hidden") {
      result.inputs.push({
        ...base,
        id: attributes.id ?? `${attributes.name ?? tag}@${path}:${line}`,
        name: attributes.name ?? null,
        type: attributes.type ?? tag,
        required: Object.hasOwn(attributes, "required"),
      });
    }
    if (!raw.endsWith("/>") && !["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"].includes(tag)) {
      stack.push({ tag, attributes });
    }
  }
  return result;
}

function textUntilClosingTag(source, offset, tag) {
  const match = new RegExp(`([\\s\\S]*?)<\\/${tag}\\s*>`, "i").exec(source.slice(offset));
  return (match?.[1] ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&times;/g, "×")
    .replace(/\s+/g, " ")
    .trim();
}

function extractDynamicControls(path, source) {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const controls = [];
  visit(sourceFile, (node) => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name)) return;
    const kind = dynamicElementTag(node.initializer);
    if (kind !== "button" && kind !== "a") return;
    const symbol = node.name.text;
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    const assignments = [];
    visit(sourceFile, (candidate) => {
      if (
        ts.isBinaryExpression(candidate) &&
        ts.isPropertyAccessExpression(candidate.left) &&
        ts.isIdentifier(candidate.left.expression) &&
        candidate.left.expression.text === symbol &&
        ["textContent", "href", "ariaLabel", "title"].includes(candidate.left.name.text)
      ) assignments.push(candidate.right.getText(sourceFile).replace(/\s+/g, " ").slice(0, 140));
    });
    controls.push({
      id: `${path}:${symbol}:${line}`,
      source: `${path}:${line}`,
      kind,
      label: assignments.join(" | ") || symbol,
    });
  });
  return controls;
}

function dynamicElementTag(initializer) {
  if (!initializer || !ts.isCallExpression(initializer)) return null;
  const argument = initializer.arguments[0];
  if (!argument || (!ts.isStringLiteral(argument) && !ts.isNoSubstitutionTemplateLiteral(argument))) return null;
  if (ts.isIdentifier(initializer.expression) && initializer.expression.text === "element") return argument.text;
  if (
    ts.isPropertyAccessExpression(initializer.expression) &&
    ts.isIdentifier(initializer.expression.expression) &&
    initializer.expression.expression.text === "document" &&
    initializer.expression.name.text === "createElement"
  ) return argument.text;
  return null;
}

function extractRoutes(worker, studio) {
  const routes = [];
  for (const match of worker.matchAll(/app\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g)) {
    const method = (match[1] ?? "").toUpperCase();
    const path = match[2] ?? "";
    routes.push({ id: `${method} ${path}`, method, path, audience: routeAudience(method, path), source: `src/worker/index.ts:${lineAt(worker, match.index ?? 0)}` });
  }
  const clientPaths = new Set();
  for (const match of studio.matchAll(/data-section=["']([^"']+)["']/g)) clientPaths.add(`#${match[1]}`);
  for (const match of studio.matchAll(/data-project-section=["']([^"']+)["']/g)) clientPaths.add(`#project/:projectId/${match[1]}`);
  for (const path of clientPaths) routes.push({ id: `CLIENT ${path}`, method: "CLIENT", path, audience: "operator", source: "studio.html" });
  return routes;
}

function routeAudience(method, path) {
  if (path.startsWith("/api/worker/") || path.startsWith("/api/capture-agent/")) return "service";
  if (path.startsWith("/api/admin/") || path.includes("handoffs") || path.startsWith("/api/team")) return "platform_admin";
  if (path.startsWith("/api/review/")) return "customer_reviewer|customer_readonly";
  if (path === "/" || path.startsWith("/s/") || path.startsWith("/public-asset/") || path.startsWith("/api/releases/:slug/") || path === "/api/telemetry" || path.startsWith("/.well-known/") || path === "/api/health" || path.startsWith("/api/auth/")) return "public";
  if (path.startsWith("/review/") || path.startsWith("/preview/")) return "signed-session";
  if (method === "GET" && ["/studio.html", "/index.html", "/404.html"].includes(path)) return "public";
  return "platform_admin|production_operator";
}

function expandFieldRegistry(registry) {
  const fields = [...(registry.fields ?? [])];
  for (const set of registry.fieldSets ?? []) {
    const required = new Set(set.required ?? []);
    const expert = new Set(set.expertFields ?? []);
    for (const name of set.fields ?? []) {
      fields.push({
        id: `${set.idPrefix}.${name}`,
        form: set.form,
        name,
        audience: expert.has(name) ? "expert" : set.audience,
        stage: set.stage,
        required: required.has(name),
        requestPath: `${set.requestPath}.${name}`,
        persistencePath: `${set.persistencePath}.*`,
        consumer: set.consumer,
        readback: set.readback,
        unit: set.units?.[name] ?? "",
      });
    }
  }
  return fields.sort((left, right) => left.id.localeCompare(right.id));
}

async function extractPersistedStates() {
  const directory = resolve(repositoryRoot, "migrations");
  const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  const states = [];
  for (const file of files) {
    const source = await readFile(resolve(directory, file), "utf8");
    for (const match of source.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)\s+(?:TEXT\s+[^,\n]*?)?CHECK\s*\(\s*(?:\1\s+)?IN\s*\(([^)]+)\)\s*\)/g)) {
      const values = Array.from(match[2].matchAll(/'([^']+)'/g), (value) => value[1]);
      if (values.length) states.push({ id: `${file}:${match[1]}:${lineAt(source, match.index ?? 0)}`, field: match[1], values, source: `migrations/${file}:${lineAt(source, match.index ?? 0)}` });
    }
  }
  return states;
}

function extractActionWorkflows(source) {
  const workflows = [];
  for (const line of source.split("\n")) {
    if (!/^\| (?:Sign-in|Studio|Viewer|Review)/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length === 5 && cells[0] !== "Surface") workflows.push({ surface: cells[0], action: cells[1], pending: cells[2], failure: cells[3], retry: cells[4] });
  }
  return workflows;
}

function renderReport(value) {
  const forms = value.htmlSurfaces.flatMap((surface) => surface.forms);
  const dialogs = value.htmlSurfaces.flatMap((surface) => surface.dialogs);
  const buttons = value.htmlSurfaces.flatMap((surface) => surface.buttons);
  const links = value.htmlSurfaces.flatMap((surface) => surface.links);
  const loginInputs = value.htmlSurfaces.flatMap((surface) => surface.inputs).filter((input) => input.form === "loginForm");
  const controls = [...buttons.map((item) => ({ ...item, kind: "button" })), ...links.map((item) => ({ ...item, kind: "link" })), ...value.dynamicControls];
  const lines = [
    "# User-facing acceptance inventory",
    "",
    "Generated by `npm run inventory:write`; verified by `npm run audit:inventory`. Do not edit by hand.",
    "Sources: HTML, browser entry points, Worker routes, Studio field metadata, migration state constraints, and the action-state audit.",
    "",
    "## Acceptance and edge policies",
    "",
    "Every inventory row names a policy; that reference is part of the row's acceptance contract.",
    "",
    "| Policy | Acceptance criteria | Finite risk-based edge cases |",
    "| --- | --- | --- |",
    "| ROLE-A | The role sees only authorised data and actions; direct API access enforces the same boundary. | no membership; revoked membership; wrong tenant; stale session; direct URL/API attempt |",
    "| ROUTE-A | Direct navigation, reload, in-app navigation, and browser history reach the same explicit loading, success, empty, or failure state. | malformed identifier; missing resource; expired credential; wrong role/tenant; upstream failure |",
    "| API-A | Validate input and tenancy, enforce the role, return the documented success, and name failures without leaking data. | missing/invalid input; duplicate replay; stale conflict; wrong role/tenant; dependency timeout |",
    "| FORM-A | Required controls are visible, submit once, retain values on failure, persist the accepted request, and read it back. | empty required field; malformed boundary; duplicate submit; role denial; server failure |",
    "| FIELD-A | Label, requiredness, audience, unit, request, persistence, consumer, and readback agree end to end. | empty; malformed type; min/max boundary; expert mode; stale readback |",
    "| DIALOG-A | Opening focuses it; close/Escape restores focus; pending/errors stay inside; mobile content scrolls without overflow. | close while pending; repeated open; Escape; validation failure; narrow/short viewport |",
    "| CONTROL-A | It is discoverable, keyboard operable, single-flight, performs its bound action, and reports success or an actionable failure. | double activation; disabled prerequisite; stale row; role denial; server failure |",
    "| LINK-A | It has a real destination, works by keyboard/pointer, preserves expected history, and never exposes an unauthorised target. | new tab; back/forward; expired target; wrong role; missing destination |",
    "| STATE-A | Every legal state has a distinct label and valid actions; transitions persist through reload; unknown or stale states fail closed. | first/empty; active; terminal success; terminal failure; stale/unknown |",
    "| WORKFLOW-A | The row's exact pending, recovery, and retry/idempotency behavior is visible and authoritative after reload. | duplicate start; timeout; partial success; stale response; retry after reload |",
    "",
    "## Measured inventory receipt",
    "",
    `- Roles: ${value.roles.length}`,
    `- Worker and client routes: ${value.routes.length}`,
    `- Forms: ${forms.length}`,
    `- Dialogs: ${dialogs.length}`,
    `- Governed fields: ${value.fields.length}`,
    `- Static and generated controls: ${controls.length}`,
    `- Persisted state sets: ${value.states.length}`,
    `- Asynchronous workflows: ${value.workflows.length}`,
    "",
    sectionTable("Roles", ["Role", "Label", "Scope", "Policy"], value.roles.map((role) => [role.id, role.label, role.scope, "ROLE-A"])),
    sectionTable("Routes", ["Route", "Audience", "Source", "Policy"], value.routes.map((route) => [route.id, route.audience, route.source, route.method === "CLIENT" || !route.path.startsWith("/api/") ? "ROUTE-A" : "API-A"])),
    sectionTable("Forms", ["Form", "Dialog", "Section", "Source", "Policy"], forms.map((form) => [form.id, form.dialog ?? "none", form.section ?? "global", form.source, "FORM-A"])),
    sectionTable("Login inputs", ["Input", "Type", "Required", "Source", "Policy"], loginInputs.map((input) => [input.id, input.type, String(input.required), input.source, "FIELD-A"])),
    sectionTable("Governed authenticated inputs", ["Field", "Form", "Stage / audience", "Required / unit", "Request → persistence → readback", "Policy"], value.fields.map((field) => [field.id, field.form, `${field.stage} / ${field.audience}`, `${field.required ? "required" : "optional"}${field.unit ? ` / ${field.unit}` : ""}`, `${field.requestPath} → ${field.persistencePath} → ${field.consumer} → ${field.readback}`, "FIELD-A"])),
    sectionTable("Dialogs", ["Dialog", "Section", "Source", "Policy"], dialogs.map((dialog) => [dialog.id, dialog.section ?? "global", dialog.source, "DIALOG-A"])),
    sectionTable("Buttons and links", ["Control", "Kind", "Label/expression", "Context", "Source", "Policy"], controls.map((control) => [control.id, control.kind, control.label, [control.section, control.dialog, control.form].filter(Boolean).join(" / ") || "generated/global", control.source, control.kind === "link" ? "LINK-A" : "CONTROL-A"])),
    sectionTable("Persisted states", ["State set", "Field", "Values", "Source", "Policy"], value.states.map((state) => [state.id, state.field, state.values.join(", "), state.source, "STATE-A"])),
    sectionTable("Asynchronous workflows", ["Surface / action", "Pending", "Failure", "Retry/idempotency", "Policy"], value.workflows.map((workflow) => [`${workflow.surface} / ${workflow.action}`, workflow.pending, workflow.failure, workflow.retry, "WORKFLOW-A"])),
  ];
  return `${lines.join("\n")}\n`;
}

function sectionTable(title, headers, rows) {
  return [`## ${title}`, "", `| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.map(markdownCell).join(" | ")} |`), ""].join("\n");
}

function markdownCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function lineAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

function visit(node, visitor) {
  visitor(node);
  node.forEachChild((child) => visit(child, visitor));
}
