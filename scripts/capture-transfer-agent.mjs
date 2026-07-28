import { createHash } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import {
  CaptureTransferError,
  captureOperationId,
  captureTransferFailure,
  parseCaptureTransferManifest,
  planCaptureTransferParts,
} from "./capture-transfer-agent-core.mjs";

const once = process.argv.includes("--once");
const manifestIndex = process.argv.indexOf("--manifest");
const explicitManifest = manifestIndex >= 0
  ? resolve(requiredArgument("--manifest", process.argv[manifestIndex + 1]))
  : null;
const configuration = {
  origin: requiredEnvironment("SPATIAL_API_ORIGIN").replace(/\/+$/, ""),
  token: requiredEnvironment("SPATIAL_CAPTURE_AGENT_TOKEN"),
  inbox: resolve(process.env.SPATIAL_CAPTURE_INBOX?.trim() || process.cwd()),
  pollMs: positiveInteger(process.env.SPATIAL_CAPTURE_POLL_SECONDS, 15) * 1_000,
  settleMs: nonnegativeInteger(process.env.SPATIAL_CAPTURE_SETTLE_SECONDS, 10) * 1_000,
  requestAttempts: positiveInteger(process.env.SPATIAL_CAPTURE_REQUEST_ATTEMPTS, 4),
};

if (!/^spcap_[0-9a-f-]{36}\.[A-Za-z0-9_-]{32,128}$/i.test(configuration.token)) {
  throw new CaptureTransferError(
    "INVALID_AGENT_TOKEN",
    "SPATIAL_CAPTURE_AGENT_TOKEN is not a capture-agent credential",
  );
}

const stateDirectory = join(configuration.inbox, ".spatial-transfer");
await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    log("capture_transfer.stopping", { signal });
  });
}

log("capture_transfer.started", {
  origin: configuration.origin,
  inbox: configuration.inbox,
  mode: once ? "once" : "continuous",
  explicitManifest: explicitManifest ? basename(explicitManifest) : null,
});

do {
  const manifests = explicitManifest
    ? [explicitManifest]
    : (await readdir(configuration.inbox, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".spatial-capture.json"))
      .map((entry) => join(configuration.inbox, entry.name))
      .sort();
  let failures = 0;
  for (const manifestPath of manifests) {
    if (stopping) break;
    try {
      const outcome = await withManifestLock(manifestPath, () =>
        transferManifest(manifestPath));
      if (outcome) log("capture_transfer.manifest_complete", outcome);
    } catch (error) {
      failures += 1;
      const failure = safeFailure(error);
      log("capture_transfer.manifest_failed", {
        manifest: basename(manifestPath),
        ...failure,
      });
    }
  }
  if (once) {
    if (failures) process.exitCode = 1;
    break;
  }
  if (!stopping) await delay(configuration.pollMs);
} while (!stopping);

async function transferManifest(manifestPath) {
  const receiptPath = `${manifestPath}.receipt.json`;
  if (await exists(receiptPath)) return null;
  const rawManifest = await readFile(manifestPath, "utf8");
  let parsedJson;
  try {
    parsedJson = JSON.parse(rawManifest);
  } catch (error) {
    throw new CaptureTransferError(
      "INVALID_CAPTURE_MANIFEST",
      "Capture manifest is not valid JSON",
      { cause: error },
    );
  }
  const manifest = parseCaptureTransferManifest(parsedJson);
  const artifact = manifest.files[0];
  const manifestDirectory = dirname(manifestPath);
  const artifactPath = resolve(manifestDirectory, artifact.path);
  if (!artifactPath.startsWith(`${resolve(manifestDirectory)}${sep}`)) {
    throw new CaptureTransferError(
      "INVALID_CAPTURE_MANIFEST",
      "Capture artifact resolves outside the manifest directory",
    );
  }
  const artifactStat = await stat(artifactPath).catch((error) => {
    throw new CaptureTransferError(
      "CAPTURE_ARTIFACT_UNAVAILABLE",
      `Capture artifact ${artifact.path} is not readable`,
      { retryable: true, cause: error },
    );
  });
  if (!artifactStat.isFile() || artifactStat.size <= 0) {
    throw new CaptureTransferError(
      "INVALID_CAPTURE_ARTIFACT",
      "Capture artifact must be a non-empty regular file",
    );
  }
  if (Date.now() - artifactStat.mtimeMs < configuration.settleMs) {
    throw new CaptureTransferError(
      "CAPTURE_ARTIFACT_STILL_CHANGING",
      "Capture artifact is newer than the configured settle window",
      { retryable: true },
    );
  }
  const [manifestSha256, artifactSha256] = await Promise.all([
    sha256String(rawManifest),
    sha256File(artifactPath),
  ]);
  if (artifact.sha256 && artifact.sha256 !== artifactSha256) {
    throw new CaptureTransferError(
      "CAPTURE_ARTIFACT_HASH_MISMATCH",
      "Capture artifact SHA-256 does not match the manifest",
    );
  }
  const statePath = captureStatePath(manifestPath);
  let state = await readState(statePath);
  const sourceIdentity = {
    manifestSha256,
    artifactPath: artifact.path,
    sizeBytes: artifactStat.size,
    modifiedAt: artifactStat.mtime.toISOString(),
    sha256: artifactSha256,
  };
  if (
    !state ||
    state.manifestSha256 !== manifestSha256 ||
    state.file?.sha256 !== artifactSha256 ||
    state.file?.sizeBytes !== artifactStat.size
  ) {
    state = {
      schemaVersion: "1.0.0",
      manifestSha256,
      operationGeneration: 0,
      operationId: operationIdFor(manifest, sourceIdentity, 0),
      status: "queued",
      attempts: 0,
      file: sourceIdentity,
      uploadedParts: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await writeState(statePath, state);
  }
  if (state.status === "failed_terminal") {
    throw new CaptureTransferError(
      state.error?.code || "CAPTURE_TRANSFER_TERMINAL",
      state.error?.message || "Capture transfer requires manifest or file correction",
    );
  }
  if (state.nextAttemptAt && Date.parse(state.nextAttemptAt) > Date.now()) {
    return null;
  }

  try {
    state.status = "validating";
    state.attempts += 1;
    state.updatedAt = new Date().toISOString();
    delete state.error;
    delete state.nextAttemptAt;
    await writeState(statePath, state);
    const projectInventory = await requestJson("/api/capture-agent/projects");
    const project = projectInventory.projects?.find(
      (candidate) => candidate.id === manifest.projectId,
    );
    if (!project) {
      throw new CaptureTransferError(
        "PROJECT_NOT_ASSIGNED",
        "Credential is not assigned to the manifest project",
      );
    }
    if (project.captureAdapter !== manifest.adapter) {
      throw new CaptureTransferError(
        "CAPTURE_ADAPTER_MISMATCH",
        `Manifest adapter ${manifest.adapter} does not match project adapter ${project.captureAdapter}`,
      );
    }

    state.status = "uploading";
    await writeState(statePath, state);
    let create;
    try {
      create = await requestJson(`/api/projects/${manifest.projectId}/uploads`, {
        method: "POST",
        body: JSON.stringify({
          clientOperationId: state.operationId,
          fileName: basename(artifact.path),
          sizeBytes: artifactStat.size,
          format: artifact.format,
          purpose: artifact.purpose,
          mimeType: artifact.mimeType,
          sha256: artifactSha256,
        }),
      });
    } catch (error) {
      if (
        error instanceof CaptureTransferError &&
        error.details?.status === 410 &&
        state.uploadId
      ) {
        await requestJson(`/api/uploads/${state.uploadId}`, {
          method: "DELETE",
        }, { allowNoContent: true }).catch(() => undefined);
        state.operationGeneration += 1;
        state.operationId = operationIdFor(
          manifest,
          sourceIdentity,
          state.operationGeneration,
        );
        state.uploadId = null;
        state.uploadedParts = [];
        await writeState(statePath, state);
        create = await requestJson(`/api/projects/${manifest.projectId}/uploads`, {
          method: "POST",
          body: JSON.stringify({
            clientOperationId: state.operationId,
            fileName: basename(artifact.path),
            sizeBytes: artifactStat.size,
            format: artifact.format,
            purpose: artifact.purpose,
            mimeType: artifact.mimeType,
            sha256: artifactSha256,
          }),
        });
      } else {
        throw error;
      }
    }
    state.uploadId = create.upload.id;
    state.versionId = create.upload.versionId;
    state.assetId = create.upload.assetId;
    state.updatedAt = new Date().toISOString();
    await writeState(statePath, state);

    if (create.upload.status !== "COMPLETED") {
      const recovery = await requestJson(
        `/api/projects/${manifest.projectId}/uploads/open`,
      );
      const remoteUpload = recovery.uploads?.find(
        (candidate) => candidate.id === create.upload.id,
      );
      const uploadedParts = remoteUpload?.parts ?? state.uploadedParts ?? [];
      state.uploadedParts = uploadedParts;
      await writeState(statePath, state);
      const plan = planCaptureTransferParts(
        artifactStat.size,
        create.upload.partSizeBytes,
        uploadedParts,
      );
      const handle = await open(artifactPath, "r");
      try {
        for (const partPlan of plan) {
          if (stopping) {
            throw new CaptureTransferError(
              "CAPTURE_TRANSFER_STOPPED",
              "Capture transfer stopped before completion",
              { retryable: true },
            );
          }
          const bytes = Buffer.allocUnsafe(partPlan.length);
          const result = await handle.read(
            bytes,
            0,
            partPlan.length,
            partPlan.offset,
          );
          if (result.bytesRead !== partPlan.length) {
            throw new CaptureTransferError(
              "CAPTURE_ARTIFACT_CHANGED",
              "Capture artifact changed or became unreadable during transfer",
            );
          }
          const uploaded = await requestJson(
            `/api/uploads/${create.upload.id}/parts/${partPlan.partNumber}`,
            {
              method: "PUT",
              headers: {
                "content-type": "application/octet-stream",
                "content-length": String(partPlan.length),
              },
              body: bytes,
            },
          );
          state.uploadedParts = [
            ...(state.uploadedParts ?? []).filter(
              (part) => part.partNumber !== partPlan.partNumber,
            ),
            {
              partNumber: partPlan.partNumber,
              etag: uploaded.part.etag,
              sizeBytes: partPlan.length,
            },
          ].sort((left, right) => left.partNumber - right.partNumber);
          state.updatedAt = new Date().toISOString();
          await writeState(statePath, state);
          log("capture_transfer.part_uploaded", {
            manifest: basename(manifestPath),
            partNumber: partPlan.partNumber,
            totalParts: Math.ceil(artifactStat.size / create.upload.partSizeBytes),
          });
        }
      } finally {
        await handle.close();
      }
    }

    const complete = await requestJson(
      `/api/uploads/${create.upload.id}/complete`,
      {
        method: "POST",
        body: JSON.stringify({
          parts: (state.uploadedParts ?? []).map((part) => ({
            partNumber: part.partNumber,
            etag: part.etag,
          })),
        }),
      },
    );
    const receipt = {
      schemaVersion: "1.0.0",
      status: "completed",
      manifest: {
        path: basename(manifestPath),
        sha256: manifestSha256,
        projectId: manifest.projectId,
        adapter: manifest.adapter,
      },
      source: {
        path: artifact.path,
        sizeBytes: artifactStat.size,
        sha256: artifactSha256,
        modifiedAt: artifactStat.mtime.toISOString(),
      },
      transfer: {
        credentialId: projectInventory.credential?.id,
        credentialGeneration: projectInventory.credential?.generation,
        operationId: state.operationId,
        uploadId: create.upload.id,
        versionId: create.upload.versionId,
        assetId: create.upload.assetId,
        partCount: state.uploadedParts?.length ?? 0,
      },
      result: {
        asset: complete.asset,
        job: complete.job ?? null,
        idempotent: Boolean(complete.idempotent),
      },
      completedAt: new Date().toISOString(),
    };
    await atomicJsonWrite(receiptPath, receipt, 0o600);
    state.status = "completed";
    state.completedAt = receipt.completedAt;
    state.updatedAt = receipt.completedAt;
    await writeState(statePath, state);
    return {
      manifest: basename(manifestPath),
      projectId: manifest.projectId,
      assetId: create.upload.assetId,
      sizeBytes: artifactStat.size,
      sha256: artifactSha256,
      receipt: basename(receiptPath),
    };
  } catch (error) {
    const failure = safeFailure(error);
    state.status = failure.retryable ? "failed_retryable" : "failed_terminal";
    state.error = failure;
    state.updatedAt = new Date().toISOString();
    if (failure.retryable) {
      const delaySeconds = Math.min(15 * 60, 15 * (2 ** Math.min(state.attempts - 1, 6)));
      state.nextAttemptAt = new Date(Date.now() + delaySeconds * 1_000).toISOString();
    }
    await writeState(statePath, state);
    throw error;
  }
}

async function requestJson(path, init = {}, { allowNoContent = false } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= configuration.requestAttempts; attempt += 1) {
    try {
      const response = await fetch(`${configuration.origin}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${configuration.token}`,
          ...(init.body && !(init.body instanceof Uint8Array)
            ? { "content-type": "application/json" }
            : {}),
          ...init.headers,
        },
      });
      if (allowNoContent && response.status === 204) return {};
      const text = await response.text();
      const payload = text ? safeJson(text) : {};
      if (response.ok) return payload;
      const failure = captureTransferFailure(response.status, payload);
      if (!failure.retryable || attempt === configuration.requestAttempts) throw failure;
      lastError = failure;
      await retryDelay(attempt, failure.details?.retryAfterSeconds);
    } catch (error) {
      if (error instanceof CaptureTransferError && !error.retryable) throw error;
      lastError = error instanceof CaptureTransferError
        ? error
        : new CaptureTransferError(
          "NETWORK_ERROR",
          error instanceof Error ? error.message : "Capture transfer network failure",
          { retryable: true, cause: error },
        );
      if (attempt === configuration.requestAttempts) throw lastError;
      await retryDelay(attempt);
    }
  }
  throw lastError;
}

async function withManifestLock(manifestPath, callback) {
  const lockPath = `${captureStatePath(manifestPath)}.lock`;
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const lockStat = await stat(lockPath).catch(() => null);
    if (lockStat && Date.now() - lockStat.mtimeMs > 2 * 60 * 60 * 1_000) {
      await rm(lockPath, { force: true });
      handle = await open(lockPath, "wx", 0o600);
    } else {
      return null;
    }
  }
  try {
    await handle.writeFile(JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }));
    return await callback();
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}

function captureStatePath(manifestPath) {
  const identity = createHash("sha256").update(resolve(manifestPath)).digest("hex").slice(0, 16);
  const name = basename(manifestPath).replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120);
  return join(stateDirectory, `${name}.${identity}.state.json`);
}

function operationIdFor(manifest, sourceIdentity, generation) {
  const fingerprint = createHash("sha256").update(JSON.stringify({
    projectId: manifest.projectId,
    adapter: manifest.adapter,
    file: sourceIdentity,
    format: manifest.files[0].format,
    purpose: manifest.files[0].purpose,
    generation,
  })).digest("hex");
  return captureOperationId(fingerprint);
}

async function sha256File(path) {
  const hash = createHash("sha256");
  const handle = await open(path, "r");
  const buffer = Buffer.allocUnsafe(4 * 1024 * 1024);
  try {
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}

async function sha256String(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readState(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new CaptureTransferError(
      "INVALID_LOCAL_STATE",
      "Capture transfer checkpoint is unreadable",
      { cause: error },
    );
  }
}

async function writeState(path, state) {
  state.updatedAt = new Date().toISOString();
  await atomicJsonWrite(path, state, 0o600);
}

async function atomicJsonWrite(path, value, mode) {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode });
  await rename(temporary, path);
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function safeFailure(error) {
  if (error instanceof CaptureTransferError) {
    return {
      code: error.code,
      message: error.message,
      retryable: Boolean(error.retryable),
      details: error.details,
    };
  }
  return {
    code: "CAPTURE_TRANSFER_ERROR",
    message: error instanceof Error ? error.message : "Unknown capture transfer failure",
    retryable: true,
    details: {},
  };
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return { error: "Spatial Studio returned an invalid JSON response" };
  }
}

async function retryDelay(attempt, retryAfterSeconds) {
  const milliseconds = Number.isFinite(retryAfterSeconds)
    ? Math.min(60_000, Math.max(250, retryAfterSeconds * 1_000))
    : Math.min(10_000, 250 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 250);
  await delay(milliseconds);
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredArgument(name, value) {
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonnegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function log(event, metadata = {}) {
  process.stdout.write(`${JSON.stringify({
    event,
    at: new Date().toISOString(),
    ...metadata,
  })}\n`);
}
