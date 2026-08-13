export type ProcessingDispatchMessage = {
  jobId: string;
  // Container instances are addressed by name, and a name that repeats reuses
  // whatever instance — and whatever image — served it before. Naming each
  // dispatch uniquely guarantees a retry after a deploy runs the deployed
  // image instead of silently re-running the one that already failed.
  dispatchId?: string;
};

export type ProcessorRuntimeConfiguration = {
  appOrigin: string;
  workerApiToken: string;
  maximumChangeInputMib: string;
  maximumJobRuntimeMinutes: string;
  maximumPointcloudInputMib?: string;
  pollSeconds?: string;
  heartbeatSeconds?: string;
  processorIdentityJson: string;
};

const jobIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseProcessingDispatchMessage(input: unknown): ProcessingDispatchMessage | null {
  if (!input || typeof input !== "object") return null;
  const jobId = Reflect.get(input, "jobId");
  if (typeof jobId !== "string" || !jobIdPattern.test(jobId)) return null;
  const dispatchId = Reflect.get(input, "dispatchId");
  if (dispatchId !== undefined &&
    (typeof dispatchId !== "string" || !jobIdPattern.test(dispatchId))) {
    return null;
  }
  return { jobId, ...(typeof dispatchId === "string" ? { dispatchId } : {}) };
}

export function processorEnvironment(
  configuration: ProcessorRuntimeConfiguration,
  jobId: string,
): Record<string, string> {
  if (!jobIdPattern.test(jobId)) throw new Error("Processor job ID must be a UUID");
  const origin = new URL(configuration.appOrigin);
  if (!["http:", "https:"].includes(origin.protocol)) {
    throw new Error("Processor API origin must use HTTP or HTTPS");
  }
  if (!configuration.workerApiToken) throw new Error("Worker API token is required");
  return {
    SPATIAL_API_ORIGIN: origin.origin,
    WORKER_API_TOKEN: configuration.workerApiToken,
    PROCESSOR_WORKER_ID: `cloudflare-container:${jobId}`,
    PROCESSOR_JOB_ID: jobId,
    PROCESSOR_IDENTITY_JSON: configuration.processorIdentityJson,
    PROCESSOR_MAX_CHANGE_INPUT_MIB: configuration.maximumChangeInputMib,
    PROCESSOR_MAX_JOB_RUNTIME_MINUTES: configuration.maximumJobRuntimeMinutes,
    ...(configuration.maximumPointcloudInputMib
      ? { PROCESSOR_MAX_POINTCLOUD_INPUT_MIB: configuration.maximumPointcloudInputMib }
      : {}),
    ...(configuration.pollSeconds
      ? { PROCESSOR_POLL_SECONDS: configuration.pollSeconds }
      : {}),
    ...(configuration.heartbeatSeconds
      ? { PROCESSOR_HEARTBEAT_SECONDS: configuration.heartbeatSeconds }
      : {}),
    PROCESSOR_CHROME_PATH: "/usr/bin/chromium",
    SPARK_BUILD_LOD_BIN: "/usr/local/bin/spark-build-lod",
  };
}
