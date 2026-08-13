export const PROCESSOR_PROTOCOL_VERSION = "spatial-processor-lease/1";

export type ProcessorCapability = {
  jobType: string;
  contractVersion: string;
};

export type ProcessorIdentity = {
  agentBuildSha: string;
  imageDigest: string;
  protocolVersion: string;
  capabilities: ProcessorCapability[];
};

// This is the executable's explicit compatibility surface. A new contract is
// added only after the processor can satisfy it; queued work never guesses from
// a package version or from a mutable image tag.
export const PROCESSOR_CAPABILITIES: ProcessorCapability[] = [
  { jobType: "asset.validate", contractVersion: "open-import-v1" },
  { jobType: "asset.evidence-validate", contractVersion: "spatial-evidence/1.0.0" },
  { jobType: "floorplan.extract-v1", contractVersion: "spatial-processor/0.11.0" },
  { jobType: "navigation.build-v1", contractVersion: "spatial-processor/0.11.0" },
  { jobType: "canary.roundtrip-v1", contractVersion: "spatial-processor/0.16.0" },
  { jobType: "registered-scene-change-v1", contractVersion: "spatial-processor/0.4.0" },
  { jobType: "semantic.extract-v1", contractVersion: "spatial-processor/0.11.0" },
];

const gitShaPattern = /^[a-f0-9]{40}$/;
const imageDigestPattern = /^sha256:[a-f0-9]{64}$/;
const capabilityValuePattern = /^[a-z0-9][a-z0-9._/-]*$/;

export function parseProcessorIdentity(value: unknown): ProcessorIdentity | null {
  if (!value || typeof value !== "object") return null;
  const agentBuildSha = Reflect.get(value, "agentBuildSha");
  const imageDigest = Reflect.get(value, "imageDigest");
  const protocolVersion = Reflect.get(value, "protocolVersion");
  const rawCapabilities = Reflect.get(value, "capabilities");
  if (
    typeof agentBuildSha !== "string" || !gitShaPattern.test(agentBuildSha) ||
    typeof imageDigest !== "string" || !imageDigestPattern.test(imageDigest) ||
    protocolVersion !== PROCESSOR_PROTOCOL_VERSION ||
    !Array.isArray(rawCapabilities) || rawCapabilities.length === 0
  ) return null;
  const capabilities: ProcessorCapability[] = [];
  const unique = new Set<string>();
  for (const raw of rawCapabilities) {
    if (!raw || typeof raw !== "object") return null;
    const jobType = Reflect.get(raw, "jobType");
    const contractVersion = Reflect.get(raw, "contractVersion");
    if (
      typeof jobType !== "string" || !capabilityValuePattern.test(jobType) ||
      typeof contractVersion !== "string" || !capabilityValuePattern.test(contractVersion)
    ) return null;
    const key = `${jobType}\u0000${contractVersion}`;
    if (unique.has(key)) return null;
    unique.add(key);
    capabilities.push({ jobType, contractVersion });
  }
  return { agentBuildSha, imageDigest, protocolVersion, capabilities };
}

export function deploymentProcessorIdentity(
  agentBuildSha: string,
  imageDigest: string,
): ProcessorIdentity {
  const identity = parseProcessorIdentity({
    agentBuildSha: agentBuildSha.trim().toLowerCase(),
    imageDigest: imageDigest.trim().toLowerCase(),
    protocolVersion: PROCESSOR_PROTOCOL_VERSION,
    capabilities: PROCESSOR_CAPABILITIES,
  });
  if (!identity) {
    throw new Error(
      "Processor deployment identity requires a 40-character Git SHA and sha256 image digest",
    );
  }
  return identity;
}

export function processorCanRun(
  identity: ProcessorIdentity,
  jobType: string,
  contractVersion: string,
): boolean {
  return identity.capabilities.some((capability) =>
    capability.jobType === jobType && capability.contractVersion === contractVersion
  );
}

export function processorContractVersionForJob(jobType: string): string {
  const matches = PROCESSOR_CAPABILITIES.filter((capability) => capability.jobType === jobType);
  if (matches.length !== 1) {
    throw new Error(`Processor job ${jobType} must declare exactly one supported contract version`);
  }
  return matches[0]!.contractVersion;
}

export function processorIdentityEquals(
  left: ProcessorIdentity,
  right: ProcessorIdentity,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
