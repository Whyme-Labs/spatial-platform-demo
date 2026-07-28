import { Container, getContainer } from "@cloudflare/containers";
import {
  parseProcessingDispatchMessage,
  processorEnvironment,
  type ProcessingDispatchMessage,
} from "./dispatch";

type ProcessorCloudEnvironment = {
  PROCESSOR_CONTAINER: DurableObjectNamespace<SpatialProcessorContainer>;
  APP_ORIGIN: string;
  WORKER_API_TOKEN: string;
  PROCESSOR_MAX_CHANGE_INPUT_MIB: string;
  PROCESSOR_MAX_JOB_RUNTIME_MINUTES: string;
};

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
  async fetch(): Promise<Response> {
    return Response.json({
      service: "spatial-processor-cloud",
      status: "ok",
      processor: "spatial-processor/0.7.0",
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
        const container = getContainer(env.PROCESSOR_CONTAINER, dispatch.jobId);
        await container.start({
          entrypoint: ["node", "scripts/processing-agent.mjs", "--once"],
          envVars: processorEnvironment({
            appOrigin: env.APP_ORIGIN,
            workerApiToken: env.WORKER_API_TOKEN,
            maximumChangeInputMib: env.PROCESSOR_MAX_CHANGE_INPUT_MIB,
            maximumJobRuntimeMinutes: env.PROCESSOR_MAX_JOB_RUNTIME_MINUTES,
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
