import { describe, expect, it } from "vitest";
import {
  parseProcessingDispatchMessage,
  processorEnvironment,
} from "../src/processor-cloud/dispatch";
import { PROCESSOR_CONTAINER_IDLE_TIMEOUT } from "../src/processor-cloud";

describe("Cloud processor dispatch", () => {
  it("recycles a finished one-shot processor instead of hoarding an instance slot", () => {
    expect(PROCESSOR_CONTAINER_IDLE_TIMEOUT).toBe("4h");
  });

  it("accepts only a bounded job dispatch contract", () => {
    const jobId = "123e4567-e89b-42d3-a456-426614174000";
    expect(parseProcessingDispatchMessage({ jobId })).toEqual({ jobId });
    expect(parseProcessingDispatchMessage({ jobId: "not-a-job" })).toBeNull();
    expect(parseProcessingDispatchMessage({ scanId: jobId })).toBeNull();
    expect(parseProcessingDispatchMessage(null)).toBeNull();
  });

  it("pins a container to one exact job and passes no R2 credential", () => {
    const jobId = "123e4567-e89b-42d3-a456-426614174000";
    const environment = processorEnvironment({
      appOrigin: "https://spatial.whymelabs.com/path-is-ignored",
      workerApiToken: "worker-secret",
      maximumChangeInputMib: "1024",
      maximumJobRuntimeMinutes: "180",
    }, jobId);
    expect(environment).toMatchObject({
      SPATIAL_API_ORIGIN: "https://spatial.whymelabs.com",
      PROCESSOR_JOB_ID: jobId,
      PROCESSOR_WORKER_ID: `cloudflare-container:${jobId}`,
      PROCESSOR_CHROME_PATH: "/usr/bin/chromium",
      SPARK_BUILD_LOD_BIN: "/usr/local/bin/spark-build-lod",
    });
    expect(environment).not.toHaveProperty("R2_ACCESS_KEY_ID");
    expect(environment).not.toHaveProperty("R2_SECRET_ACCESS_KEY");
    expect(environment).not.toHaveProperty("PROCESSOR_MAX_POINTCLOUD_INPUT_MIB");
    expect(environment).not.toHaveProperty("PROCESSOR_POLL_SECONDS");
    expect(environment).not.toHaveProperty("PROCESSOR_HEARTBEAT_SECONDS");
  });

  it("passes the configured point-cloud, poll, and heartbeat limits through to the container", () => {
    const jobId = "123e4567-e89b-42d3-a456-426614174000";
    const environment = processorEnvironment({
      appOrigin: "https://spatial.whymelabs.com",
      workerApiToken: "worker-secret",
      maximumChangeInputMib: "1024",
      maximumJobRuntimeMinutes: "180",
      maximumPointcloudInputMib: "2048",
      pollSeconds: "5",
      heartbeatSeconds: "30",
    }, jobId);
    expect(environment).toMatchObject({
      PROCESSOR_MAX_POINTCLOUD_INPUT_MIB: "2048",
      PROCESSOR_POLL_SECONDS: "5",
      PROCESSOR_HEARTBEAT_SECONDS: "30",
    });
  });
});
