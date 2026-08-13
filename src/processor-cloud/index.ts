import { Container, getContainer } from "@cloudflare/containers";
import {
  parseProcessingDispatchMessage,
  processorEnvironment,
  type ProcessingDispatchMessage,
} from "./dispatch";
import { deploymentProcessorIdentity } from "../shared/processor-identity";

type ProcessorCloudEnvironment = {
  PROCESSOR_CONTAINER: DurableObjectNamespace<SpatialProcessorContainer>;
  APP_ORIGIN: string;
  WORKER_API_TOKEN: string;
  PROCESSOR_MAX_CHANGE_INPUT_MIB: string;
  PROCESSOR_MAX_JOB_RUNTIME_MINUTES: string;
  PROCESSOR_MAX_POINTCLOUD_INPUT_MIB?: string;
  PROCESSOR_POLL_SECONDS?: string;
  PROCESSOR_HEARTBEAT_SECONDS?: string;
  PROCESSOR_AGENT_BUILD_SHA: string;
  PROCESSOR_IMAGE_DIGEST: string;
};

// Must exceed PROCESSOR_MAX_JOB_RUNTIME_MINUTES (180). This lane starts the
// container with an entrypoint and never fetches it, and @cloudflare/containers
// only renews the activity window on start/fetch, so the alarm treats
// `sleepAfter` as a wall-clock cap on a running job rather than an idle window:
// a shorter value stops the container mid-job. Idle instances are not the reason
// this value is large — the `--once` entrypoint exits on its own and releases
// the instance slot without waiting for this timeout.
export const PROCESSOR_CONTAINER_IDLE_TIMEOUT = "4h";

export class SpatialProcessorContainer extends Container {
  sleepAfter = PROCESSOR_CONTAINER_IDLE_TIMEOUT;
  enableInternet = true;

  override onStart(): void {
    console.log(JSON.stringify({ event: "processor.container_started" }));
  }

  override onStop(): void {
    console.log(JSON.stringify({ event: "processor.container_stopped" }));
  }

  override onError(error: unknown): void {
    console.error(JSON.stringify({
      event: "processor.container_error",
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

const worker = {
  async fetch(_request: Request, env: ProcessorCloudEnvironment): Promise<Response> {
    const identity = deploymentProcessorIdentity(
      env.PROCESSOR_AGENT_BUILD_SHA,
      env.PROCESSOR_IMAGE_DIGEST,
    );
    return Response.json({
      service: "spatial-processor-cloud",
      status: "ok",
      identity,
      renderer: "Spark 2.1.0",
      execution: "cloudflare-container",
    });
  },

  async queue(
    batch: MessageBatch<ProcessingDispatchMessage>,
    env: ProcessorCloudEnvironment,
  ): Promise<void> {
    for (const message of batch.messages) {
      const dispatch = parseProcessingDispatchMessage(message.body);
      if (!dispatch) {
        console.error(JSON.stringify({
          event: "processor.dispatch_rejected",
          attempt: message.attempts,
        }));
        message.ack();
        continue;
      }
      try {
        // Old messages carry only a job id; fall back to it so in-flight
        // dispatches from before the deploy still start.
        const container = getContainer(
          env.PROCESSOR_CONTAINER,
          dispatch.dispatchId ?? dispatch.jobId,
        );
        await container.start({
          entrypoint: ["node", "scripts/processing-agent.mjs", "--once"],
          envVars: processorEnvironment({
            appOrigin: env.APP_ORIGIN,
            workerApiToken: env.WORKER_API_TOKEN,
            maximumChangeInputMib: env.PROCESSOR_MAX_CHANGE_INPUT_MIB,
            maximumJobRuntimeMinutes: env.PROCESSOR_MAX_JOB_RUNTIME_MINUTES,
            maximumPointcloudInputMib: env.PROCESSOR_MAX_POINTCLOUD_INPUT_MIB,
            pollSeconds: env.PROCESSOR_POLL_SECONDS,
            heartbeatSeconds: env.PROCESSOR_HEARTBEAT_SECONDS,
            processorIdentityJson: JSON.stringify(deploymentProcessorIdentity(
              env.PROCESSOR_AGENT_BUILD_SHA,
              env.PROCESSOR_IMAGE_DIGEST,
            )),
          }, dispatch.jobId),
          enableInternet: true,
        });
        console.log(JSON.stringify({
          event: "processor.dispatch_started",
          jobId: dispatch.jobId,
          attempt: message.attempts,
        }));
        message.ack();
      } catch (error) {
        console.error(JSON.stringify({
          event: "processor.dispatch_failed",
          jobId: dispatch.jobId,
          attempt: message.attempts,
          error: error instanceof Error ? error.message : String(error),
        }));
        message.retry({
          delaySeconds: Math.min(300, 15 * 2 ** Math.max(0, message.attempts - 1)),
        });
      }
    }
  },
} satisfies ExportedHandler<ProcessorCloudEnvironment, ProcessingDispatchMessage>;

export default worker;
