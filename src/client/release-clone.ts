// Builds the publish payload that faithfully REPUBLISHES an active release
// with a freshly accepted walking map: same slug, same access policy, same
// stored viewer configuration — nothing re-derived from form state. Pure so
// the cloning rules are unit-testable.
//
// Publication stays an operator-authenticated act: this payload is sent by
// the operator's own Studio session through the same fully-gated publish
// endpoint as the manual button. Where a faithful clone cannot be proven —
// unreadable stored config, a token-gated release whose republish would mint
// a new access token, or a source-to-world transform whose registration
// evidence cannot be re-derived exactly — the clone REFUSES and the operator
// publishes manually instead. A republish must never silently change what
// the public sees except for the walking map it was asked to refresh.

export type ReviewedSourceToWorldEvidence = {
  extractionId: string;
  sourceUpAxis: "Y" | "Z";
  worldUnit: string;
  metresPerSourceUnit: number;
  yawDegrees: number;
  translationMetres: [number, number, number];
};

export type RepublishPayload = {
  clientOperationId: string;
  slug: string;
  accessPolicy: string;
  expiresAt: string | null;
  sourceToWorldEvidenceId?: string;
  viewerConfig: Record<string, unknown>;
};

export type RepublishClone =
  | { ok: true; payload: RepublishPayload }
  | { ok: false; reason: string };

function sourceToWorldMatches(
  stored: Record<string, unknown>,
  evidence: ReviewedSourceToWorldEvidence,
): boolean {
  const translation = stored.translationMetres;
  return stored.sourceUpAxis === evidence.sourceUpAxis &&
    stored.worldUnit === evidence.worldUnit &&
    stored.metresPerSourceUnit === evidence.metresPerSourceUnit &&
    stored.yawDegrees === evidence.yawDegrees &&
    Array.isArray(translation) &&
    translation.length === 3 &&
    translation.every((value, index) => value === evidence.translationMetres[index]);
}

export function buildRepublishPayload(input: {
  slug: string;
  accessPolicy: string;
  expiresAt: string | null;
  viewerConfigJson: string | null | undefined;
  clientOperationId: string;
  reviewedSourceToWorld: ReviewedSourceToWorldEvidence[];
}): RepublishClone {
  if (input.accessPolicy === "token") {
    return {
      ok: false,
      reason: "the live release is token-gated and republishing mints a NEW access token — publish manually so the token handover is deliberate",
    };
  }
  let viewerConfig: unknown;
  try {
    viewerConfig = JSON.parse(input.viewerConfigJson ?? "");
  } catch {
    return { ok: false, reason: "the live release's stored viewer configuration is unreadable" };
  }
  if (!viewerConfig || typeof viewerConfig !== "object" || Array.isArray(viewerConfig)) {
    return { ok: false, reason: "the live release's stored viewer configuration is unreadable" };
  }
  const config = viewerConfig as Record<string, unknown>;
  let sourceToWorldEvidenceId: string | undefined;
  const sourceToWorld = config.sourceToWorld;
  if (sourceToWorld !== undefined) {
    if (!sourceToWorld || typeof sourceToWorld !== "object" || Array.isArray(sourceToWorld)) {
      return { ok: false, reason: "the live release's source-to-world transform is unreadable" };
    }
    const match = input.reviewedSourceToWorld.find((evidence) =>
      sourceToWorldMatches(sourceToWorld as Record<string, unknown>, evidence)
    );
    if (!match) {
      return {
        ok: false,
        reason: "the registration evidence behind the live source-to-world transform could not be re-derived — publish manually",
      };
    }
    sourceToWorldEvidenceId = match.extractionId;
  }
  return {
    ok: true,
    payload: {
      clientOperationId: input.clientOperationId,
      slug: input.slug,
      accessPolicy: input.accessPolicy,
      expiresAt: input.expiresAt,
      ...(sourceToWorldEvidenceId ? { sourceToWorldEvidenceId } : {}),
      viewerConfig: config,
    },
  };
}
