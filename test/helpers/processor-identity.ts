import {
  PROCESSOR_CAPABILITIES,
  PROCESSOR_PROTOCOL_VERSION,
  type ProcessorIdentity,
} from "../../src/shared/processor-identity";

export const testProcessorIdentity: ProcessorIdentity = {
  agentBuildSha: "a".repeat(40),
  imageDigest: `sha256:${"b".repeat(64)}`,
  protocolVersion: PROCESSOR_PROTOCOL_VERSION,
  capabilities: PROCESSOR_CAPABILITIES,
};

export function processorLeaseRequest(workerId: string, jobId?: string) {
  return {
    workerId,
    ...(jobId ? { jobId } : {}),
    processorIdentity: testProcessorIdentity,
  };
}
