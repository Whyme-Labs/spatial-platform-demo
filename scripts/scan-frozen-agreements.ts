// Validates every frozen capture-agreement blob with the EXACT runtime
// parser the Worker consumes them with — a second handwritten approximation
// would drift, and a scan that disagrees with runtime consumption proves
// nothing. Bundled with esbuild at run time (extensionless worker imports),
// fed the raw D1 query output on stdin, and printing only the aggregate:
// raw rows never reach the evidence directory.
//
//   npx esbuild scripts/scan-frozen-agreements.ts --bundle --format=esm \
//     --platform=node --outfile="$RUNNER_TEMP/scan.mjs"
//   node "$RUNNER_TEMP/scan.mjs" < d1-rows.json
import { parseFrozenCaptureAgreement } from "../src/worker/contracts";

const chunks: Buffer[] = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  const rows = JSON.parse(Buffer.concat(chunks).toString("utf8"))[0]
    .results as Array<{ capture_agreement_json: string | null }>;
  let valid = 0;
  let invalid = 0;
  for (const row of rows) {
    const parsed = parseFrozenCaptureAgreement(row.capture_agreement_json);
    if (parsed === null) invalid += 1;
    else valid += 1;
  }
  process.stdout.write(JSON.stringify({
    schemaVersion: "legacy-capture-agreement-integrity-scan-v1",
    database: "spatial-studio-production",
    parser: "runtime parseFrozenCaptureAgreement (bundled from src/worker/contracts)",
    gitSha: process.env.DEPLOY_SHA ?? null,
    rowsWithCaptureAgreement: rows.length,
    validRows: valid,
    invalidRows: invalid,
    note: "Invalid rows fail closed at runtime and require operator re-review.",
    scannedAt: new Date().toISOString(),
  }, null, 2));
});
