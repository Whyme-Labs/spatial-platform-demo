export type ProcessingDispatchMessage = {
  jobId: string;
};

export type ProcessorRuntimeConfiguration = {
  appOrigin: string;
  workerApiToken: string;
  maximumChangeInputMib: string;
  maximumJobRuntimeMinutes: string;
};

const jobIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseProcessingDispatchMessage(input: unknown): ProcessingDispatchMessage | null {
  if (!input || typeof input !== "object") return null;
  const jobId = Reflect.get(input, "jobId");
  if (typeof jobId !== "string" || !jobIdPattern.test(jobId)) return null;
  return { jobId };
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
    PROCESSOR_MAX_CHANGE_INPUT_MIB: configuration.maximumChangeInputMib,
    PROCESSOR_MAX_JOB_RUNTIME_MINUTES: configuration.maximumJobRuntimeMinutes,
    PROCESSOR_CHROME_PATH: "/usr/bin/chromium",
    SPARK_BUILD_LOD_BIN: "/usr/local/bin/spark-build-lod",
  };
}
