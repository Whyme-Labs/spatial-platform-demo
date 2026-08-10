import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workerSource = await readFile(resolve(repositoryRoot, "src/worker/index.ts"), "utf8");
const runName = new Date().toISOString().replace(/[:.]/g, "-");
const persistencePath = resolve(repositoryRoot, ".cache/qa-runtime", runName);
const seedPath = resolve(persistencePath, "production-scale-seed.sql");
const receiptPath = resolve(persistencePath, "receipt.json");
const latestPath = resolve(repositoryRoot, ".cache/qa-runtime/latest-path.txt");
const ids = {
  organisation: "00000000-0000-4000-8001-000000000001",
  customer: "00000000-0000-4000-8002-000000000001",
};
const roleRows = [
  ["platform_admin", "admin"],
  ["production_operator", "operator"],
  ["customer_reviewer", "reviewer"],
  ["customer_readonly", "readonly"],
];
const projectStatuses = [
  "DRAFT", "UPLOADING", "INGESTED", "PROCESSING", "QA_REQUIRED", "APPROVED",
  "PUBLISHED", "ARCHIVED", "UPLOAD_FAILED", "PROCESSING_FAILED", "QA_REJECTED", "REVOKED",
];
const sceneVersionStatuses = [
  "UPLOADING", "INGESTED", "PROCESSING", "QA_REQUIRED", "APPROVED",
  "PUBLISHED", "ARCHIVED", "UPLOAD_FAILED", "PROCESSING_FAILED", "QA_REJECTED",
];
const jobStates = ["QUEUED", "LEASED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED", "DEAD_LETTER"];
const releasePolicies = ["public", "unlisted", "token", "customer-authenticated"];

const scales = {
  projects: routeBoundary("/api/projects"),
  templates: routeBoundary("/api/project-templates"),
  savedViews: routeBoundary("/api/project-views"),
  jobs: routeBoundary("/api/jobs"),
  releases: routeBoundary("/api/releases"),
};
const sql = buildSeedSql(scales);

await mkdir(persistencePath, { recursive: true });
await writeFile(seedPath, sql);
runWrangler([
  "d1", "migrations", "apply", "spatial-studio-local", "--local", "--persist-to", persistencePath,
]);
runWrangler([
  "d1", "execute", "spatial-studio-local", "--local", "--persist-to", persistencePath,
  "--file", seedPath,
]);

const rows = queryRows(`
  SELECT 'projects' AS entity, COUNT(*) AS count FROM projects WHERE organisation_id = '${ids.organisation}'
  UNION ALL SELECT 'templates', COUNT(*) FROM project_templates WHERE organisation_id = '${ids.organisation}'
  UNION ALL SELECT 'savedViews', COUNT(*) FROM project_saved_views WHERE organisation_id = '${ids.organisation}'
  UNION ALL SELECT 'jobs', COUNT(*) FROM processing_jobs WHERE organisation_id = '${ids.organisation}'
  UNION ALL SELECT 'releases', COUNT(*) FROM releases WHERE organisation_id = '${ids.organisation}'
  ORDER BY entity
`);
const actual = Object.fromEntries(rows.map((row) => [row.entity, Number(row.count)]));
for (const [entity, expected] of Object.entries(scales)) {
  if (actual[entity] !== expected) {
    throw new Error(`qa_dataset_rows budget limit=${expected} requested=${actual[entity] ?? 0} entity=${entity}`);
  }
}

const receipt = {
  schemaVersion: "spatial-local-qa-receipt-v1",
  generatedAt: new Date().toISOString(),
  sensitiveData: false,
  productionTouched: false,
  strategy: "one row beyond each bounded primary Studio list query",
  scales,
  actual,
  roleCount: roleRows.length,
  projectStatuses,
  sceneVersionStatuses,
  jobStates,
  releasePolicies,
  seedSha256: createHash("sha256").update(sql).digest("hex"),
  persistencePath,
};
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
await mkdir(dirname(latestPath), { recursive: true });
await writeFile(latestPath, `${persistencePath}\n`);
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);

function routeBoundary(path) {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = workerSource.search(new RegExp(`app\\.get\\(["']${escaped}["']`));
  if (start < 0) throw new Error(`No GET route found for ${path}`);
  const end = workerSource.indexOf("\napp.", start + 5);
  const block = workerSource.slice(start, end < 0 ? undefined : end);
  const limits = Array.from(block.matchAll(/LIMIT\s+(\d+)/g), (match) => Number(match[1]));
  if (!limits.length) throw new Error(`No measured SQL list limit found for ${path}`);
  return Math.max(...limits) + 1;
}

function runWrangler(args) {
  const result = spawnSync("npx", ["wrangler", ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`wrangler ${args.join(" ")} failed`);
  }
}

function queryRows(command) {
  const result = spawnSync("npx", [
    "wrangler", "d1", "execute", "spatial-studio-local", "--local", "--persist-to", persistencePath,
    "--command", command, "--json",
  ], { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error(result.stderr || "D1 verification failed");
  const payload = JSON.parse(result.stdout);
  return payload[0]?.results ?? [];
}

function buildSeedSql(scale) {
  const statements = [
    "PRAGMA foreign_keys = ON;",
    sqlInsert("organisations", ["id", "name", "slug"], [[ids.organisation, "QA Synthetic Workspace", "qa-synthetic-workspace"]]),
  ];
  const userRows = roleRows.map(([role, stem], index) => [
    entityId("8101", index + 1),
    `qa+${stem}@example.invalid`,
    `QA ${role.replaceAll("_", " ")}`,
  ]);
  statements.push(sqlInsert("users", ["id", "email", "display_name"], userRows));
  statements.push(sqlInsert("memberships", ["organisation_id", "user_id", "role", "status"], roleRows.map(([role], index) => [
    ids.organisation, userRows[index][0], role, "active",
  ])));
  statements.push(sqlInsert("customers", ["id", "organisation_id", "name", "contact_email"], [[
    ids.customer, ids.organisation, "QA Synthetic Customer", "qa+customer@example.invalid",
  ]]));

  const projectRows = [];
  const versionRows = [];
  const assetRows = [];
  for (let index = 0; index < scale.projects; index += 1) {
    const projectId = entityId("8201", index + 1);
    const versionId = entityId("8202", index + 1);
    const assetId = entityId("8203", index + 1);
    const projectStatus = projectStatuses[index % projectStatuses.length];
    const versionStatus = sceneVersionStatuses[index % sceneVersionStatuses.length];
    const timestamp = orderedTimestamp(index);
    projectRows.push([
      projectId, ids.organisation, ids.customer, `QA project ${String(index + 1).padStart(4, "0")}`,
      `qa-project-${String(index + 1).padStart(4, "0")}`, projectStatus, "open-import",
      index % 2 === 0 ? "Property showcase" : "Measured capture pack",
      "Synthetic local QA fixture. No customer or production data.", userRows[0][0], timestamp, timestamp,
      "open-import", "{}",
    ]);
    versionRows.push([versionId, projectId, 1, versionStatus, "{}", userRows[0][0], timestamp, timestamp]);
    assetRows.push([
      assetId, ids.organisation, projectId, versionId, "web", "sog",
      `qa/${projectId}/scene.sog`, "scene.sog", "application/octet-stream", 1,
      "qa-etag", "0".repeat(64), "verified", timestamp,
    ]);
  }
  statements.push(sqlInsert("projects", [
    "id", "organisation_id", "customer_id", "name", "slug", "status", "capture_adapter",
    "delivery_template", "notes", "created_by", "created_at", "updated_at", "capture_adapter_v2",
    "workflow_policy_json",
  ], projectRows));
  statements.push(sqlInsert("scene_versions", [
    "id", "project_id", "version_number", "status", "source_provenance_json", "created_by", "created_at", "updated_at",
  ], versionRows));
  statements.push(sqlInsert("assets", [
    "id", "organisation_id", "project_id", "version_id", "kind", "format", "object_key", "file_name",
    "mime_type", "size_bytes", "etag", "sha256", "integrity_status", "created_at",
  ], assetRows));

  const templateRows = Array.from({ length: scale.templates }, (_, index) => [
    entityId("8301", index + 1), ids.organisation, `QA template ${String(index + 1).padStart(4, "0")}`,
    "Synthetic template", "open-import", "Property showcase", null,
    `qa-template-${index + 1}`, "qa-request-hash", userRows[0][0], orderedTimestamp(index), orderedTimestamp(index),
    "open-import", "{}",
  ]);
  statements.push(sqlInsert("project_templates", [
    "id", "organisation_id", "name", "description", "capture_adapter", "delivery_template", "notes",
    "client_operation_id", "request_hash", "created_by", "created_at", "updated_at", "capture_adapter_v2", "policy_json",
  ], templateRows));
  const viewRows = Array.from({ length: scale.savedViews }, (_, index) => [
    entityId("8302", index + 1), ids.organisation, userRows[0][0],
    `QA view ${String(index + 1).padStart(4, "0")}`, JSON.stringify({
      query: "",
      statuses: [projectStatuses[index % projectStatuses.length]],
      captureAdapters: [],
      deliveryTemplates: [],
      sort: "updated_desc",
    }),
    index === 0 ? 1 : 0, `qa-view-${index + 1}`, "qa-request-hash", orderedTimestamp(index), orderedTimestamp(index),
  ]);
  statements.push(sqlInsert("project_saved_views", [
    "id", "organisation_id", "user_id", "name", "filter_json", "is_default", "client_operation_id",
    "request_hash", "created_at", "updated_at",
  ], viewRows));

  const jobRows = Array.from({ length: scale.jobs }, (_, index) => {
    const projectIndex = index % projectRows.length;
    const state = jobStates[index % jobStates.length];
    return [
      entityId("8401", index + 1), ids.organisation, projectRows[projectIndex][0], versionRows[projectIndex][0], assetRows[projectIndex][0],
      "qa_fixture", "qa-local", `qa-job-${index + 1}`, state,
      state === "SUCCEEDED" ? 100 : 0, `Synthetic ${state.toLowerCase()} fixture`, orderedTimestamp(index), orderedTimestamp(index), 0,
    ];
  });
  statements.push(sqlInsert("processing_jobs", [
    "id", "organisation_id", "project_id", "version_id", "input_asset_id", "job_type", "processor_version",
    "idempotency_key", "state", "progress", "progress_message", "created_at", "updated_at", "retry_count",
  ], jobRows));

  const releaseRows = Array.from({ length: scale.releases }, (_, index) => [
    entityId("8501", index + 1), ids.organisation, projectRows[0][0], versionRows[0][0], assetRows[0][0], null,
    releasePolicies[index % releasePolicies.length], index % releasePolicies.length === 2 ? `qa-token-${index + 1}` : null,
    "{}", orderedTimestamp(index), null, index % projectStatuses.length === 0 ? orderedTimestamp(index + 1) : null,
    userRows[0][0], orderedTimestamp(index), `qa-release-${index + 1}`, index + 1,
  ]);
  statements.push(sqlInsert("releases", [
    "id", "organisation_id", "project_id", "version_id", "web_asset_id", "poster_asset_id", "access_policy",
    "access_token_hash", "viewer_config_json", "published_at", "expires_at", "revoked_at", "created_by", "created_at",
    "client_operation_id", "release_number",
  ], releaseRows));
  statements.push(sqlInsert("release_channels", [
    "id", "organisation_id", "project_id", "slug", "active_release_id", "activation_generation",
  ], [[entityId("8502", 1), ids.organisation, projectRows[0][0], "qa-synthetic-release", releaseRows.at(-1)[0], 1]]));
  statements.push(sqlInsert("project_access", [
    "organisation_id", "project_id", "user_id", "role", "invited_by",
  ], [
    [ids.organisation, projectRows[0][0], userRows[2][0], "customer_reviewer", userRows[0][0]],
    [ids.organisation, projectRows[0][0], userRows[3][0], "customer_readonly", userRows[0][0]],
  ]));
  return `${statements.join("\n")}\n`;
}

function sqlInsert(table, columns, rows) {
  if (!rows.length) return "";
  return rows
    .map((row) => `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${row.map(sqlValue).join(", ")});`)
    .join("\n");
}

function sqlValue(value) {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function entityId(namespace, value) {
  return `00000000-0000-4000-${namespace}-${value.toString(16).padStart(12, "0")}`;
}

function orderedTimestamp(index) {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
}
