// Validates every frozen capture-agreement blob with the EXACT runtime
// parser the Worker consumes them with — a second handwritten approximation
// would drift, and a scan that disagrees with runtime consumption proves
// nothing. Bundled with esbuild at run time (extensionless worker imports),
// fed the raw D1 query output on stdin, and printing only the aggregate
// plus row IDENTIFIERS (never blob content): raw rows never reach the
// evidence directory.
//
// Enforcement policy (ninth audit): an invalid row that an APPROVED build,
// an in-flight build, or an active release still references makes the scan
// exit non-zero — the deployment must not be attested over inconsistent
// evidence that production surfaces depend on. Invalid rows nothing active
// references are quarantined by the runtime's fail-closed parse (they
// force operator re-review) and are escalated as remediation issues by the
// workflow, without blocking the deploy.
//
//   npx esbuild scripts/scan-frozen-agreements.ts --bundle --format=esm \
//     --platform=node --outfile="$RUNNER_TEMP/scan.mjs"
//   node "$RUNNER_TEMP/scan.mjs" < d1-rows.json
import { parseFrozenCaptureAgreement } from "../src/worker/contracts";

interface ScanRow {
  id: string;
  capture_agreement_json: string | null;
  revision_status: string;
  approved_build: number;
  pending_build: number;
  active_release: number;
}

const chunks: Buffer[] = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  const rows = JSON.parse(Buffer.concat(chunks).toString("utf8"))[0]
    .results as ScanRow[];
  let valid = 0;
  const invalidActiveReferenced: Array<Record<string, unknown>> = [];
  const invalidInactive: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const parsed = parseFrozenCaptureAgreement(row.capture_agreement_json);
    if (parsed !== null) {
      valid += 1;
      continue;
    }
    const reference = {
      revisionId: row.id,
      revisionStatus: row.revision_status,
      approvedBuild: Boolean(row.approved_build),
      pendingBuild: Boolean(row.pending_build),
      activeRelease: Boolean(row.active_release),
    };
    if (reference.approvedBuild || reference.pendingBuild || reference.activeRelease) {
      invalidActiveReferenced.push(reference);
    } else {
      invalidInactive.push(reference);
    }
  }
  process.stdout.write(JSON.stringify({
    schemaVersion: "legacy-capture-agreement-integrity-scan-v2",
    database: "spatial-studio-production",
    parser: "runtime parseFrozenCaptureAgreement (bundled from src/worker/contracts)",
    gitSha: process.env.DEPLOY_SHA ?? null,
    rowsWithCaptureAgreement: rows.length,
    validRows: valid,
    invalidRows: invalidActiveReferenced.length + invalidInactive.length,
    invalidActiveReferenced,
    invalidInactive,
    policy: "active-referenced invalid rows block the deploy; inactive invalid rows fail closed at runtime (operator re-review) and are escalated as remediation issues",
    scannedAt: new Date().toISOString(),
  }, null, 2));
  process.exitCode = invalidActiveReferenced.length > 0 ? 1 : 0;
});
