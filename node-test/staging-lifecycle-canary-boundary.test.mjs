import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  automaticallyRegisterSceneSignatures,
  compareRegisteredScenes,
  parsePlySceneSignature,
} from "../scripts/processing-agent-core.mjs";
import {
  metricPointCloudPly,
  metricRoomPoints,
} from "../scripts/staging-lifecycle-fixture.mjs";

const canaryUrl = new URL("../scripts/staging-lifecycle-canary.mjs", import.meta.url);

test("the lifecycle deadline bounds network, browser, and Wrangler operations", async () => {
  const source = await readFile(canaryUrl, "utf8");
  assert.match(source, /Math\.min\(budget\.limit, lifecycleRemaining\)/);
  assert.match(source, /timeout: remainingLifecycleMilliseconds\("chrome launch"\)/);
  assert.match(source, /child\.kill\("SIGKILL"\)/);
  assert.match(source, /maximumSubprocessMilliseconds/);
  assert.match(source, /report\.status === "passed" && Date\.now\(\) > deadline/);
});

test("new and rotated sessions are captured before identity checks and revoked on rejection", async () => {
  const source = await readFile(canaryUrl, "utf8");
  const initialCapture = source.indexOf("const candidateCookie = sessionCookieCandidate(setCookie)");
  const initialIdentity = source.indexOf('assertServiceOperatorIdentity(payload.user, "OTP verification")');
  assert.ok(initialCapture >= 0 && initialCapture < initialIdentity);
  const refreshStart = source.indexOf("async function refreshServiceOperatorSession");
  const refreshCapture = source.indexOf("const candidateCookie = sessionCookieCandidate(setCookie)", refreshStart);
  const refreshIdentity = source.indexOf('assertServiceOperatorIdentity(payload.user, "session refresh")', refreshStart);
  assert.ok(refreshCapture >= refreshStart && refreshCapture < refreshIdentity);
  assert.match(source, /await revokeRejectedSession\(candidateCookie, "initial identity verification", error\)/);
  assert.match(source, /await revokeRejectedSession\(candidateCookie, "refreshed identity verification", error\)/);
});

test("the raw comparison fixture is distinct and registers without ambiguity", async () => {
  const baselinePoints = metricRoomPoints();
  const candidatePoints = metricRoomPoints({ candidateChange: true });
  assert.notDeepEqual(candidatePoints, baselinePoints);
  const options = { voxelSizeM: 0.1, maximumSamplePoints: 2_000_000 };
  const baseline = parsePlySceneSignature(metricPointCloudPly(baselinePoints), options);
  const candidate = parsePlySceneSignature(metricPointCloudPly(candidatePoints), options);
  const registration = automaticallyRegisterSceneSignatures({
    baseline,
    candidate,
    parameters: {
      searchRadiusM: 1,
      maximumRmseMm: 100,
      minimumOverlapPercent: 55,
    },
  });
  assert.equal(registration.status, "accepted");
  assert.equal(registration.summary.ambiguous, false);
  assert.ok(registration.registeredCandidate);
  const comparison = compareRegisteredScenes({
    baseline,
    candidate: registration.registeredCandidate,
    parameters: {
      structuralChangeThresholdPercent: 2,
      photometricChangeThresholdPercent: 12,
      centroidChangeThresholdMm: 50,
    },
  });
  assert.ok(comparison.summary.addedVoxels > 0);
});
