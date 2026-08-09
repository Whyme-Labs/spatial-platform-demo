import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  parseProcessorCanaryInput,
  processorCanaryOutput,
} from "../scripts/processing-agent-core.mjs";

const NONCE = "0f7a1c2d-3b4e-45f6-8a9b-0c1d2e3f4a5b";

test("canary input round-trips through the parser", () => {
  const payload = `${JSON.stringify({ schemaVersion: "processor-canary-input-v1", nonce: NONCE })}\n`;
  const parsed = parseProcessorCanaryInput(payload);
  assert.deepEqual(parsed, { schemaVersion: "processor-canary-input-v1", nonce: NONCE });
});

test("canary input parser rejects wrong schema, bad nonce, and non-JSON", () => {
  assert.throws(() => parseProcessorCanaryInput("not json"), /not JSON/);
  assert.throws(
    () => parseProcessorCanaryInput(JSON.stringify({ schemaVersion: "other", nonce: NONCE })),
    /Unrecognised/,
  );
  assert.throws(
    () => parseProcessorCanaryInput(JSON.stringify({ schemaVersion: "processor-canary-input-v1", nonce: "short" })),
    /Unrecognised/,
  );
  assert.throws(
    () => parseProcessorCanaryInput(JSON.stringify({ schemaVersion: "processor-canary-input-v1" })),
    /Unrecognised/,
  );
});

test("canary output is a byte-pinned pure function of nonce and input digest", () => {
  const inputPayload = `${JSON.stringify({ schemaVersion: "processor-canary-input-v1", nonce: NONCE })}\n`;
  const inputSha256 = createHash("sha256").update(inputPayload).digest("hex");
  const output = processorCanaryOutput({ nonce: NONCE }, inputSha256);
  // The CI driver recomputes this exact string locally and compares digests
  // against what the container stored in R2 — any format drift between the
  // driver and the processor is a canary failure, so the bytes are pinned.
  assert.equal(
    output,
    `{"schemaVersion":"processor-canary-output-v1","nonce":"${NONCE}","inputSha256":"${inputSha256}"}\n`,
  );
  assert.equal(output, processorCanaryOutput({ nonce: NONCE }, inputSha256));
});

test("canary output refuses a missing or malformed input digest", () => {
  assert.throws(() => processorCanaryOutput({ nonce: NONCE }, undefined), /SHA-256/);
  assert.throws(() => processorCanaryOutput({ nonce: NONCE }, "abc"), /SHA-256/);
});
