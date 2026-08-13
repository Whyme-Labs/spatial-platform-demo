import { describe, expect, it } from "vitest";
import {
  PROCESSOR_CAPABILITIES,
  PROCESSOR_PROTOCOL_VERSION,
  parseProcessorIdentity,
  processorCanRun,
} from "../src/shared/processor-identity";

const identity = {
  agentBuildSha: "a".repeat(40),
  imageDigest: `sha256:${"b".repeat(64)}`,
  protocolVersion: PROCESSOR_PROTOCOL_VERSION,
  capabilities: PROCESSOR_CAPABILITIES,
};

describe("processor execution identity", () => {
  it("accepts an exact immutable build and image identity", () => {
    expect(parseProcessorIdentity(identity)).toEqual(identity);
  });

  it("rejects a mutable or malformed identity", () => {
    expect(parseProcessorIdentity({ ...identity, agentBuildSha: "main" })).toBeNull();
    expect(parseProcessorIdentity({ ...identity, imageDigest: "spatial:latest" })).toBeNull();
    expect(parseProcessorIdentity({ ...identity, capabilities: [] })).toBeNull();
  });

  it("matches jobs only by the declared capability contract", () => {
    expect(processorCanRun(identity, "navigation.build-v1", "spatial-processor/0.11.0"))
      .toBe(true);
    expect(processorCanRun(identity, "navigation.build-v1", "spatial-processor/0.99.0"))
      .toBe(false);
    expect(processorCanRun(identity, "unknown-job", "spatial-processor/0.11.0"))
      .toBe(false);
  });
});
