import { type Context, type Hono } from "hono";
import {
  changeDetectionReviewSchema,
  changeDetectionSchema,
  registeredSceneChangeReviewSchema,
  registeredSceneChangeSchema,
  type AuthContext,
} from "../contracts";
import { computeAuthoredGeometryChange, type GeometryEntity } from "../geometry-change";
import {
  sha256Hex,
  signSceneToken,
  verifySceneToken,
} from "../security";
import { parseWorldUnit } from "../../shared/world-units";
import {
  type ComparisonMode,
  type ComparisonReadiness,
} from "../../shared/comparison-readiness";

type ComparisonRouteEnvironment = {
  Bindings: Env;
  Variables: { requestId: string };
};

type ComparisonContext = Context<ComparisonRouteEnvironment>;

type ComparisonProject = {
  id: string;
  name: string;
  status: string;
  capture_adapter: string;
};

type ComparisonAssetRow = {
  id: string;
  organisation_id: string;
  project_id: string;
  version_id: string;
  kind: string;
  format: string;
  object_key: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  etag: string | null;
  sha256: string | null;
  integrity_status: string;
};

type RegisteredSceneChangeRow = {
  id: string;
  organisation_id: string;
  project_id: string;
  baseline_version_id: string;
  candidate_version_id: string;
  baseline_asset_id: string;
  candidate_asset_id: string;
  job_id: string;
  client_operation_id: string;
  request_hash: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "DEAD_LETTER" | "REVIEWED";
  coordinate_assurance: "shared_local_frame" | "registered_project_frame";
  registration_evidence: string;
  registration_mode: "declared" | "automatic_rigid";
  registration_search_radius_m: number;
  registration_maximum_rmse_mm: number;
  registration_minimum_overlap_percent: number;
  registration_status: "accepted" | "blocked" | null;
  registration_summary_json: string | null;
  voxel_size_m: number;
  structural_threshold_percent: number;
  photometric_threshold_percent: number;
  centroid_threshold_mm: number;
  maximum_sample_points: number;
  report_asset_id: string | null;
  result: "changes_detected" | "no_material_change" | null;
  summary_json: string | null;
  error_json: string | null;
  review_decision: "accepted" | "needs_recapture" | "investigate" | null;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type NavigationPreview = {
  spatial: Record<string, unknown>;
  collisionAsset: ComparisonAssetRow;
  registration: {
    sourceToWorld: unknown;
    receipt: Record<string, unknown>;
  };
};

export type ComparisonRouteDependencies = {
  requireOperator: (context: ComparisonContext) => Promise<AuthContext | Response>;
  requireReviewProject: (
    context: ComparisonContext,
    projectId: string,
  ) => Promise<{ auth: AuthContext; project: ComparisonProject; accessRole: string } | Response>;
  scopedProject: (
    database: D1Database,
    organisationId: string,
    projectId: string,
  ) => Promise<ComparisonProject | null>;
  isSameOrigin: (context: ComparisonContext) => Promise<boolean>;
  readJson: (context: ComparisonContext) => Promise<unknown>;
  spatialVersionWorldUnit: (
    database: D1Database,
    organisationId: string,
    projectId: string,
    versionId: string,
  ) => Promise<string>;
  approvedNavigationPreview: (
    env: Env,
    organisationId: string,
    projectId: string,
    versionId: string,
  ) => Promise<NavigationPreview | null>;
  projectComparisonReadiness: (
    env: Env,
    organisationId: string,
    projectId: string,
    versionRows: readonly unknown[],
    assetRows: readonly unknown[],
  ) => Promise<ComparisonReadiness>;
  audit: (
    context: ComparisonContext,
    auth: AuthContext,
    action: string,
    resourceType: string,
    resourceId: string,
    metadata?: Record<string, unknown>,
  ) => Promise<void>;
  dispatchProcessingJob: (context: ComparisonContext, jobId: string) => void;
  serveR2Object: (
    context: ComparisonContext,
    objectKey: string,
  ) => Promise<Response>;
};

const allowedWebFormats = new Set(["rad", "spz", "sog"]);

export function registerComparisonRoutes(
  app: Hono<ComparisonRouteEnvironment>,
  dependencies: ComparisonRouteDependencies,
): void {
  app.get("/api/projects/:projectId/versions/compare", async (context) => {
    const access = await dependencies.requireReviewProject(context, context.req.param("projectId"));
    if (access instanceof Response) return access;
    const leftId = context.req.query("left");
    const rightId = context.req.query("right");
    if (!leftId || !rightId || leftId === rightId) {
      return validationError(context, { versions: ["Two distinct version IDs are required"] });
    }
    const versions = await context.env.DB.prepare(`
      SELECT id, version_number, status, source_provenance_json, manifest_json, created_at, updated_at
      FROM scene_versions WHERE project_id = ? AND id IN (?, ?)
      ORDER BY version_number
    `).bind(access.project.id, leftId, rightId).all();
    if (versions.results.length !== 2) return notFound(context, "One or both versions were not found");
    const details = await context.env.DB.batch([
      context.env.DB.prepare(`
        SELECT id, version_id, kind, format, file_name, mime_type, object_key,
          size_bytes, sha256, integrity_status
        FROM assets WHERE project_id = ? AND organisation_id = ? AND version_id IN (?, ?)
        ORDER BY version_id, kind, created_at
      `).bind(access.project.id, access.auth.organisationId, leftId, rightId),
      context.env.DB.prepare(`
        SELECT version_id, kind, status, COUNT(*) AS count
        FROM review_comments WHERE project_id = ? AND organisation_id = ? AND version_id IN (?, ?)
        GROUP BY version_id, kind, status
      `).bind(access.project.id, access.auth.organisationId, leftId, rightId),
      context.env.DB.prepare(`
        SELECT version_id, decision, COUNT(*) AS count, MAX(created_at) AS latest_at
        FROM version_review_decisions
        WHERE project_id = ? AND organisation_id = ? AND version_id IN (?, ?)
        GROUP BY version_id, decision
      `).bind(access.project.id, access.auth.organisationId, leftId, rightId),
      context.env.DB.prepare(`
        SELECT version_id, viewer_config_json, published_at
        FROM releases
        WHERE project_id = ? AND organisation_id = ? AND version_id IN (?, ?)
          AND revoked_at IS NULL
        ORDER BY published_at DESC
      `).bind(access.project.id, access.auth.organisationId, leftId, rightId),
      context.env.DB.prepare(`
        SELECT d.id, d.version_id, d.decision, d.note, d.created_at,
          u.display_name AS reviewer_name, u.email AS reviewer_email
        FROM version_review_decisions d
        JOIN users u ON u.id = d.reviewer_user_id
        WHERE d.project_id = ? AND d.organisation_id = ? AND d.version_id IN (?, ?)
        ORDER BY d.created_at DESC
        LIMIT 100
      `).bind(access.project.id, access.auth.organisationId, leftId, rightId),
      context.env.DB.prepare(`
        SELECT c.id, c.version_id, c.kind, c.status, c.body, c.created_at,
          u.display_name AS author_name, u.email AS author_email
        FROM review_comments c
        JOIN users u ON u.id = c.author_user_id
        WHERE c.project_id = ? AND c.organisation_id = ? AND c.version_id IN (?, ?)
        ORDER BY c.created_at DESC
        LIMIT 100
      `).bind(access.project.id, access.auth.organisationId, leftId, rightId),
    ]);
    const versionRows = versions.results as Array<{
      id: string;
      version_number: number;
      status: string;
      source_provenance_json: string | null;
      manifest_json: string | null;
      created_at: string;
      updated_at: string;
    }>;
    const assetRows = requiredBatchResult(details, 0).results as Array<ComparisonAssetRow>;
    const releaseConfigs = requiredBatchResult(details, 3).results as Array<{
      version_id: string;
      viewer_config_json: string;
      published_at: string;
    }>;
    const tokenTtl = positiveInteger(context.env.SCENE_SESSION_TTL_SECONDS, 1800);
    const sessionExpiresAt = Math.floor(Date.now() / 1000) + tokenTtl;
    const renderables = (await Promise.all(versionRows.map(async (version) => {
      const navigation = await dependencies.approvedNavigationPreview(
        context.env,
        access.auth.organisationId,
        access.project.id,
        version.id,
      );
      if (!navigation) return null;
      const manifest = parseStoredObject(version.manifest_json ?? "{}");
      const approvedAssetId = readStringProperty(manifest, "webAssetId");
      const asset = assetRows.find((candidate) =>
        candidate.version_id === version.id &&
        candidate.id === approvedAssetId &&
        candidate.kind === "web" &&
        candidate.integrity_status === "verified" &&
        allowedWebFormats.has(candidate.format)
      ) ?? assetRows.find((candidate) =>
        candidate.version_id === version.id &&
        candidate.kind === "web" &&
        candidate.integrity_status === "verified" &&
        allowedWebFormats.has(candidate.format)
      );
      if (!asset || !(await context.env.SPATIAL_ASSETS.head(asset.object_key))) return null;
      const token = await signSceneToken({
        releaseId: comparisonAssetTokenScope(access.project.id, version.id, asset.id),
        expiresAt: sessionExpiresAt,
      }, context.env.SESSION_PEPPER);
      const collisionToken = await signSceneToken({
        releaseId: comparisonAssetTokenScope(
          access.project.id,
          version.id,
          navigation.collisionAsset.id,
        ),
        expiresAt: sessionExpiresAt,
      }, context.env.SESSION_PEPPER);
      const releaseConfig = releaseConfigs.find((candidate) => candidate.version_id === version.id);
      const storedViewer = releaseConfig ? parseStoredObject(releaseConfig.viewer_config_json) : {};
      return {
        versionId: version.id,
        assetId: asset.id,
        format: asset.format,
        fileName: asset.file_name,
        mimeType: asset.mime_type,
        sizeBytes: asset.size_bytes,
        sha256: asset.sha256,
        contentUrl: `/comparison-asset/${access.project.id}/${version.id}/${asset.id}/${encodeURIComponent(asset.file_name)}?token=${encodeURIComponent(token)}`,
        collisionUrl: `/comparison-asset/${access.project.id}/${version.id}/${navigation.collisionAsset.id}/${encodeURIComponent(navigation.collisionAsset.file_name)}?token=${encodeURIComponent(collisionToken)}`,
        sessionExpiresAt: new Date(sessionExpiresAt * 1000).toISOString(),
        viewer: {
          ...(storedViewer && typeof storedViewer === "object" ? storedViewer : {}),
          sourceToWorld: navigation.registration.sourceToWorld,
          captureRegistration: navigation.registration.receipt,
        },
        spatial: navigation.spatial,
      };
    }))).filter((value) => value !== null);
    if (renderables.length !== 2) {
      return conflict(
        context,
        "Comparison blocked: both selected versions need verified capture registration plus approved v7+ collision and navigation artifacts",
      );
    }
    return context.json({
      requested: { left: leftId, right: rightId },
      versions: versionRows,
      assets: assetRows.map(({ object_key: _objectKey, ...asset }) => asset),
      reviewComments: requiredBatchResult(details, 1).results,
      reviewDecisions: requiredBatchResult(details, 2).results,
      reviewDecisionHistory: requiredBatchResult(details, 4).results,
      reviewCommentHistory: requiredBatchResult(details, 5).results,
      renderables,
    });
  });

  app.post("/api/projects/:projectId/spatial/change-reports", async (context) => {
    const auth = await dependencies.requireOperator(context);
    if (auth instanceof Response) return auth;
    if (!(await dependencies.isSameOrigin(context))) return forbidden(context, "Cross-origin request rejected");
    const parsed = changeDetectionSchema.safeParse(await dependencies.readJson(context));
    if (!parsed.success) return validationError(context, parsed.error.flatten());
    const project = await dependencies.scopedProject(context.env.DB, auth.organisationId, context.req.param("projectId"));
    if (!project) return notFound(context, "Project not found");
    const canonicalRequest = JSON.stringify(parsed.data);
    const requestHash = await sha256Hex(canonicalRequest);
    const prior = await context.env.DB.prepare(`
      SELECT request_hash, response_json
      FROM change_detection_operations
      WHERE organisation_id = ? AND client_operation_id = ?
    `).bind(auth.organisationId, parsed.data.clientOperationId).first<{
      request_hash: string;
      response_json: string;
    }>();
    if (prior) {
      if (prior.request_hash !== requestHash) {
        return context.json({ error: "Operation ID was already used for a different geometry comparison" }, 409);
      }
      return context.json({
        ...(JSON.parse(prior.response_json) as Record<string, unknown>),
        idempotent: true,
      });
    }
    const versions = await context.env.DB.prepare(`
      SELECT id, version_number FROM scene_versions
      WHERE project_id = ? AND id IN (?, ?)
    `).bind(project.id, parsed.data.fromVersionId, parsed.data.toVersionId).all<{
      id: string;
      version_number: number;
    }>();
    if (versions.results.length !== 2) return notFound(context, "One or both scene versions were not found");
    const authoredReadiness = await dependencies.projectComparisonReadiness(
      context.env,
      auth.organisationId,
      project.id,
      versions.results,
      await comparisonProjectAssets(context.env.DB, auth.organisationId, project.id, [
        parsed.data.fromVersionId,
        parsed.data.toVersionId,
      ]),
    );
    if (!pairSupportsMode(
      authoredReadiness,
      parsed.data.fromVersionId,
      parsed.data.toVersionId,
      "authored_geometry",
    )) {
      return conflict(
        context,
        "Authored geometry comparison requires two versions with reviewed metric structure",
      );
    }
    const versionUnits = await Promise.all([
      dependencies.spatialVersionWorldUnit(
        context.env.DB,
        auth.organisationId,
        project.id,
        parsed.data.fromVersionId,
      ),
      dependencies.spatialVersionWorldUnit(
        context.env.DB,
        auth.organisationId,
        project.id,
        parsed.data.toVersionId,
      ),
    ]);
    if (versionUnits.includes("scene_units")) {
      return conflict(
        context,
        "Authored geometry change evidence requires reviewed metric metres. Provisional scene-unit versions support relative navigation only.",
      );
    }
    const entities = await context.env.DB.prepare(`
      SELECT id, version_id, kind, label, geometry_json, world_unit
      FROM scene_entities
      WHERE project_id = ? AND version_id IN (?, ?) AND status = 'active'
        AND kind IN ('floor', 'room', 'doorway') AND geometry_json IS NOT NULL
      ORDER BY version_id, kind, lower(label), id
    `).bind(
      project.id,
      parsed.data.fromVersionId,
      parsed.data.toVersionId,
    ).all<GeometryEntity & { version_id: string }>();
    if (entities.results.some((entity) =>
      parseWorldUnit(Reflect.get(entity, "world_unit")) !== "metres"
    )) {
      return conflict(
        context,
        "Authored geometry change evidence cannot mix provisional scene units with metric geometry",
      );
    }
    const fromVersion = versions.results.find((version) => version.id === parsed.data.fromVersionId)!;
    const toVersion = versions.results.find((version) => version.id === parsed.data.toVersionId)!;
    const fromEntities = entities.results.filter((entity) => entity.version_id === fromVersion.id);
    const toEntities = entities.results.filter((entity) => entity.version_id === toVersion.id);
    const summary = computeAuthoredGeometryChange({
      fromVersion: { id: fromVersion.id, versionNumber: fromVersion.version_number },
      toVersion: { id: toVersion.id, versionNumber: toVersion.version_number },
      fromEntities,
      toEntities,
      thresholdMm: parsed.data.thresholdMm,
      coordinateAssurance: parsed.data.coordinateAssurance,
      registrationEvidence: parsed.data.registrationEvidence,
    });
    const sourceGeometryHash = await sha256Hex(JSON.stringify({ from: fromEntities, to: toEntities }));
    const reportId = crypto.randomUUID();
    const stored = await context.env.DB.prepare(`
      INSERT INTO change_detection_reports
        (id, organisation_id, project_id, from_version_id, to_version_id, status,
          summary_json, created_by, method, result, threshold_mm,
          coordinate_assurance, registration_evidence, source_geometry_hash,
          client_operation_id, request_hash)
      VALUES (?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, from_version_id, to_version_id) DO UPDATE SET
        summary_json = excluded.summary_json,
        status = 'ready',
        method = excluded.method,
        result = excluded.result,
        threshold_mm = excluded.threshold_mm,
        coordinate_assurance = excluded.coordinate_assurance,
        registration_evidence = excluded.registration_evidence,
        source_geometry_hash = excluded.source_geometry_hash,
        client_operation_id = excluded.client_operation_id,
        request_hash = excluded.request_hash,
        review_decision = NULL,
        review_note = NULL,
        reviewed_by = NULL,
        reviewed_at = NULL,
        updated_at = datetime('now')
      RETURNING id, created_at, updated_at
    `).bind(
      reportId,
      auth.organisationId,
      project.id,
      parsed.data.fromVersionId,
      parsed.data.toVersionId,
      JSON.stringify(summary),
      auth.userId,
      summary.method,
      summary.result,
      parsed.data.thresholdMm,
      parsed.data.coordinateAssurance,
      parsed.data.registrationEvidence,
      sourceGeometryHash,
      parsed.data.clientOperationId,
      requestHash,
    ).first<{ id: string; created_at: string; updated_at: string }>();
    if (!stored) throw new Error("Geometry change report was not persisted");
    const responsePayload = {
      report: {
        id: stored.id,
        status: "ready",
        summary,
        reviewDecision: null,
        reviewNote: null,
        reviewedAt: null,
        createdAt: stored.created_at,
        updatedAt: stored.updated_at,
      },
    };
    await context.env.DB.prepare(`
      INSERT INTO change_detection_operations
        (organisation_id, project_id, client_operation_id, request_hash, response_json, report_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      auth.organisationId,
      project.id,
      parsed.data.clientOperationId,
      requestHash,
      JSON.stringify(responsePayload),
      stored.id,
    ).run();
    await dependencies.audit(context, auth, "spatial.change_report.create", "change_detection_report", stored.id, {
      ...parsed.data,
      sourceGeometryHash,
      result: summary.result,
    });
    return context.json(responsePayload, 201);
  });

  app.patch("/api/projects/:projectId/spatial/change-reports/:reportId", async (context) => {
    const auth = await dependencies.requireOperator(context);
    if (auth instanceof Response) return auth;
    if (!(await dependencies.isSameOrigin(context))) return forbidden(context, "Cross-origin request rejected");
    const parsed = changeDetectionReviewSchema.safeParse(await dependencies.readJson(context));
    if (!parsed.success) return validationError(context, parsed.error.flatten());
    const report = await context.env.DB.prepare(`
      UPDATE change_detection_reports
      SET status = 'reviewed', review_decision = ?, review_note = ?,
        reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND project_id = ? AND organisation_id = ?
      RETURNING id, status, review_decision, review_note, reviewed_at, updated_at
    `).bind(
      parsed.data.decision,
      parsed.data.note,
      auth.userId,
      context.req.param("reportId"),
      context.req.param("projectId"),
      auth.organisationId,
    ).first<{
      id: string;
      status: string;
      review_decision: string;
      review_note: string;
      reviewed_at: string;
      updated_at: string;
    }>();
    if (!report) return notFound(context, "Geometry change report not found");
    await dependencies.audit(context, auth, "spatial.change_report.review", "change_detection_report", report.id, parsed.data);
    return context.json({
      report: {
        id: report.id,
        status: report.status,
        reviewDecision: report.review_decision,
        reviewNote: report.review_note,
        reviewedAt: report.reviewed_at,
        updatedAt: report.updated_at,
      },
    });
  });

  app.post("/api/projects/:projectId/spatial/raw-change-reports", async (context) => {
    const auth = await dependencies.requireOperator(context);
    if (auth instanceof Response) return auth;
    if (!(await dependencies.isSameOrigin(context))) return forbidden(context, "Cross-origin request rejected");
    const parsed = registeredSceneChangeSchema.safeParse(await dependencies.readJson(context));
    if (!parsed.success) return validationError(context, parsed.error.flatten());
    const project = await dependencies.scopedProject(context.env.DB, auth.organisationId, context.req.param("projectId"));
    if (!project) return notFound(context, "Project not found");
    const requestHash = await sha256Hex(JSON.stringify(parsed.data));
    const prior = await context.env.DB.prepare(`
      SELECT * FROM registered_scene_change_reports
      WHERE organisation_id = ? AND client_operation_id = ?
    `).bind(auth.organisationId, parsed.data.clientOperationId).first<RegisteredSceneChangeRow>();
    if (prior) {
      if (prior.request_hash !== requestHash) {
        return conflict(context, "Operation ID was already used for a different raw-scene comparison");
      }
      return context.json({ report: registeredSceneChangeApi(prior), idempotent: true });
    }
    const versions = await context.env.DB.prepare(`
      SELECT id, version_number FROM scene_versions
      WHERE project_id = ? AND id IN (?, ?)
    `).bind(
      project.id,
      parsed.data.baselineVersionId,
      parsed.data.candidateVersionId,
    ).all<{ id: string; version_number: number }>();
    if (versions.results.length !== 2) {
      return notFound(context, "One or both immutable scene versions were not found");
    }
    const rawReadiness = await dependencies.projectComparisonReadiness(
      context.env,
      auth.organisationId,
      project.id,
      versions.results,
      await comparisonProjectAssets(context.env.DB, auth.organisationId, project.id, [
        parsed.data.baselineVersionId,
        parsed.data.candidateVersionId,
      ]),
    );
    if (!pairSupportsMode(
      rawReadiness,
      parsed.data.baselineVersionId,
      parsed.data.candidateVersionId,
      "raw",
    )) {
      return conflict(
        context,
        "Raw scene comparison requires two verified source PLY versions with qualified registration evidence",
      );
    }
    const assets = await context.env.DB.prepare(`
      SELECT id, version_id, kind, format, object_key, sha256, integrity_status
      FROM assets
      WHERE project_id = ? AND organisation_id = ? AND id IN (?, ?)
        AND deleted_at IS NULL
    `).bind(
      project.id,
      auth.organisationId,
      parsed.data.baselineAssetId,
      parsed.data.candidateAssetId,
    ).all<{
      id: string;
      version_id: string;
      kind: string;
      format: string;
      object_key: string;
      sha256: string | null;
      integrity_status: string;
    }>();
    const baselineAsset = assets.results.find((asset) => asset.id === parsed.data.baselineAssetId);
    const candidateAsset = assets.results.find((asset) => asset.id === parsed.data.candidateAssetId);
    if (!baselineAsset || !candidateAsset) {
      return notFound(context, "One or both raw-scene assets were not found");
    }
    for (const [label, asset, versionId] of [
      ["Baseline", baselineAsset, parsed.data.baselineVersionId],
      ["Candidate", candidateAsset, parsed.data.candidateVersionId],
    ] as const) {
      if (asset.version_id !== versionId) {
        return unprocessable(context, { assets: [`${label} asset does not belong to its selected version`] });
      }
      if (!["source", "master", "pointcloud"].includes(asset.kind) || asset.format.toLowerCase() !== "ply") {
        return unprocessable(context, { assets: [`${label} asset must be a source, master, or point-cloud PLY`] });
      }
      if (asset.integrity_status !== "verified") {
        return conflict(context, `${label} asset has not passed immutable integrity verification`);
      }
      if (!asset.sha256 || !/^[a-f0-9]{64}$/i.test(asset.sha256)) {
        return conflict(context, `${label} asset has no immutable SHA-256 identity`);
      }
      if (!(await context.env.SPATIAL_ASSETS.head(asset.object_key))) {
        return conflict(context, `${label} asset object is missing from immutable storage`);
      }
    }
    const reportId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    await context.env.DB.batch([
      context.env.DB.prepare(`
        INSERT INTO processing_jobs (
          id, organisation_id, project_id, version_id, input_asset_id, job_type,
          processor_version, contract_version, idempotency_key, state, priority, max_attempts,
          progress_message
        ) VALUES (?, ?, ?, ?, ?, 'registered-scene-change-v1',
          'spatial-processor/0.4.0', 'spatial-processor/0.4.0', ?, 'QUEUED', 80, 3,
          'Waiting for a registered-scene change worker')
      `).bind(
        jobId,
        auth.organisationId,
        project.id,
        parsed.data.candidateVersionId,
        parsed.data.baselineAssetId,
        `raw-change:${auth.organisationId}:${parsed.data.clientOperationId}`,
      ),
      context.env.DB.prepare(`
        INSERT INTO registered_scene_change_reports (
          id, organisation_id, project_id, baseline_version_id,
          candidate_version_id, baseline_asset_id, candidate_asset_id, job_id,
          client_operation_id, request_hash, status, coordinate_assurance,
          registration_evidence, registration_mode, registration_search_radius_m,
          registration_maximum_rmse_mm, registration_minimum_overlap_percent,
          voxel_size_m, structural_threshold_percent,
          photometric_threshold_percent, centroid_threshold_mm,
          maximum_sample_points, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        reportId,
        auth.organisationId,
        project.id,
        parsed.data.baselineVersionId,
        parsed.data.candidateVersionId,
        parsed.data.baselineAssetId,
        parsed.data.candidateAssetId,
        jobId,
        parsed.data.clientOperationId,
        requestHash,
        parsed.data.coordinateAssurance,
        parsed.data.registrationEvidence,
        parsed.data.registrationMode,
        parsed.data.registrationSearchRadiusM,
        parsed.data.registrationMaximumRmseMm,
        parsed.data.registrationMinimumOverlapPercent,
        parsed.data.voxelSizeM,
        parsed.data.structuralChangeThresholdPercent,
        parsed.data.photometricChangeThresholdPercent,
        parsed.data.centroidChangeThresholdMm,
        parsed.data.maximumSamplePoints,
        auth.userId,
      ),
    ]);
    await dependencies.audit(context, auth, "spatial.raw_change.create", "registered_scene_change_report", reportId, {
      jobId,
      baselineVersionId: parsed.data.baselineVersionId,
      candidateVersionId: parsed.data.candidateVersionId,
      baselineAssetId: parsed.data.baselineAssetId,
      candidateAssetId: parsed.data.candidateAssetId,
      registrationMode: parsed.data.registrationMode,
      coordinateAssurance: parsed.data.coordinateAssurance,
    });
    dependencies.dispatchProcessingJob(context, jobId);
    const created = await context.env.DB.prepare(
      "SELECT * FROM registered_scene_change_reports WHERE id = ?",
    ).bind(reportId).first<RegisteredSceneChangeRow>();
    return context.json({ report: registeredSceneChangeApi(created!) }, 202);
  });

  app.post("/api/projects/:projectId/spatial/raw-change-reports/:reportId/retry", async (context) => {
    const auth = await dependencies.requireOperator(context);
    if (auth instanceof Response) return auth;
    if (!(await dependencies.isSameOrigin(context))) return forbidden(context, "Cross-origin request rejected");
    const report = await context.env.DB.prepare(`
      SELECT r.*, j.state AS job_state
      FROM registered_scene_change_reports r
      JOIN processing_jobs j ON j.id = r.job_id
      WHERE r.id = ? AND r.project_id = ? AND r.organisation_id = ?
    `).bind(
      context.req.param("reportId"),
      context.req.param("projectId"),
      auth.organisationId,
    ).first<RegisteredSceneChangeRow & { job_state: string }>();
    if (!report) return notFound(context, "Raw-scene change report not found");
    if (["QUEUED", "LEASED", "RUNNING"].includes(report.job_state)) {
      return context.json({ report: registeredSceneChangeApi(report), idempotent: true }, 202);
    }
    if (report.job_state === "SUCCEEDED") {
      return conflict(context, "Completed raw-scene evidence cannot be retried");
    }
    await context.env.DB.batch([
      context.env.DB.prepare(`
        UPDATE processing_jobs
        SET state = 'QUEUED', attempt_count = 0, progress = 0,
          progress_message = 'Deliberate retry queued', error_json = NULL,
          lease_token_hash = NULL, leased_by = NULL, lease_expires_at = NULL,
          completed_at = NULL, updated_at = datetime('now')
        WHERE id = ? AND organisation_id = ?
      `).bind(report.job_id, auth.organisationId),
      context.env.DB.prepare(`
        UPDATE registered_scene_change_reports
        SET status = 'QUEUED', error_json = NULL, completed_at = NULL,
          updated_at = datetime('now')
        WHERE id = ? AND organisation_id = ?
      `).bind(report.id, auth.organisationId),
    ]);
    await dependencies.audit(context, auth, "spatial.raw_change.retry", "registered_scene_change_report", report.id, {
      jobId: report.job_id,
    });
    dependencies.dispatchProcessingJob(context, report.job_id);
    return context.json({
      report: { ...registeredSceneChangeApi(report), status: "QUEUED", errorJson: null },
    }, 202);
  });

  app.patch("/api/projects/:projectId/spatial/raw-change-reports/:reportId", async (context) => {
    const auth = await dependencies.requireOperator(context);
    if (auth instanceof Response) return auth;
    if (!(await dependencies.isSameOrigin(context))) return forbidden(context, "Cross-origin request rejected");
    const parsed = registeredSceneChangeReviewSchema.safeParse(await dependencies.readJson(context));
    if (!parsed.success) return validationError(context, parsed.error.flatten());
    const report = await context.env.DB.prepare(`
      UPDATE registered_scene_change_reports
      SET status = 'REVIEWED', review_decision = ?, review_note = ?,
        reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND project_id = ? AND organisation_id = ?
        AND status IN ('COMPLETED', 'REVIEWED')
      RETURNING *
    `).bind(
      parsed.data.decision,
      parsed.data.note,
      auth.userId,
      context.req.param("reportId"),
      context.req.param("projectId"),
      auth.organisationId,
    ).first<RegisteredSceneChangeRow>();
    if (!report) {
      const exists = await context.env.DB.prepare(`
        SELECT status FROM registered_scene_change_reports
        WHERE id = ? AND project_id = ? AND organisation_id = ?
      `).bind(
        context.req.param("reportId"),
        context.req.param("projectId"),
        auth.organisationId,
      ).first<{ status: string }>();
      if (!exists) return notFound(context, "Raw-scene change report not found");
      return conflict(context, `Raw-scene evidence is ${exists.status.toLowerCase()} and cannot be reviewed yet`);
    }
    await dependencies.audit(context, auth, "spatial.raw_change.review", "registered_scene_change_report", report.id, parsed.data);
    return context.json({ report: registeredSceneChangeApi(report) });
  });

  app.get("/comparison-asset/:projectId/:versionId/:assetId/:fileName", async (context) => {
    const token = context.req.query("token");
    if (!token) return unauthorized(context, "Missing comparison token");
    const payload = await verifySceneToken(token, context.env.SESSION_PEPPER);
    const expectedScope = comparisonAssetTokenScope(
      context.req.param("projectId"),
      context.req.param("versionId"),
      context.req.param("assetId"),
    );
    if (!payload || payload.scope || payload.releaseId !== expectedScope) {
      return unauthorized(context, "Invalid or expired comparison token");
    }
    const asset = await context.env.DB.prepare(`
      SELECT * FROM assets
      WHERE id = ? AND project_id = ? AND version_id = ?
        AND integrity_status = 'verified' AND deleted_at IS NULL
    `).bind(
      context.req.param("assetId"),
      context.req.param("projectId"),
      context.req.param("versionId"),
    ).first<ComparisonAssetRow>();
    const supportedAsset = asset && (
      (asset.kind === "web" && allowedWebFormats.has(asset.format)) ||
      (asset.kind === "collision" && asset.format === "glb")
    );
    if (!supportedAsset) return notFound(context, "Comparison asset not found");
    if (context.req.param("fileName") !== asset.file_name) {
      return notFound(context, "Comparison asset not found");
    }
    return dependencies.serveR2Object(context, asset.object_key);
  });
}

async function comparisonProjectAssets(
  database: D1Database,
  organisationId: string,
  projectId: string,
  versionIds: readonly [string, string],
): Promise<unknown[]> {
  const result = await database.prepare(`
    SELECT id, version_id, kind, format, object_key, sha256, integrity_status
    FROM assets
    WHERE organisation_id = ? AND project_id = ? AND version_id IN (?, ?)
      AND deleted_at IS NULL
  `).bind(organisationId, projectId, ...versionIds).all();
  return result.results;
}

function pairSupportsMode(
  readiness: ComparisonReadiness,
  leftVersionId: string,
  rightVersionId: string,
  mode: ComparisonMode,
): boolean {
  return readiness.eligiblePairs.some((pair) =>
    pair.modes.includes(mode) &&
    ((pair.leftVersionId === leftVersionId && pair.rightVersionId === rightVersionId) ||
      (pair.leftVersionId === rightVersionId && pair.rightVersionId === leftVersionId))
  );
}

function comparisonAssetTokenScope(projectId: string, versionId: string, assetId: string): string {
  return `comparison:${projectId}:${versionId}:${assetId}`;
}

function positiveInteger(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function requiredBatchResult(results: D1Result<unknown>[], index: number): D1Result<unknown> {
  const result = results[index];
  if (!result) throw new Error(`D1 batch result ${index} is missing`);
  return result;
}

function readStringProperty(value: unknown, property: string): string | null {
  if (!value || typeof value !== "object") return null;
  const candidate = Reflect.get(value, property);
  return typeof candidate === "string" ? candidate : null;
}

function parseStoredObject(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

function registeredSceneChangeApi(report: RegisteredSceneChangeRow): Record<string, unknown> {
  return {
    id: report.id,
    projectId: report.project_id,
    baselineVersionId: report.baseline_version_id,
    candidateVersionId: report.candidate_version_id,
    baselineAssetId: report.baseline_asset_id,
    candidateAssetId: report.candidate_asset_id,
    jobId: report.job_id,
    status: report.status,
    coordinateAssurance: report.coordinate_assurance,
    registrationEvidence: report.registration_evidence,
    registration: {
      mode: report.registration_mode,
      searchRadiusM: report.registration_search_radius_m,
      maximumRmseMm: report.registration_maximum_rmse_mm,
      minimumOverlapPercent: report.registration_minimum_overlap_percent,
      status: report.registration_status,
      summary: parseStoredObject(report.registration_summary_json ?? "null"),
    },
    parameters: {
      voxelSizeM: report.voxel_size_m,
      structuralChangeThresholdPercent: report.structural_threshold_percent,
      photometricChangeThresholdPercent: report.photometric_threshold_percent,
      centroidChangeThresholdMm: report.centroid_threshold_mm,
      maximumSamplePoints: report.maximum_sample_points,
    },
    reportAssetId: report.report_asset_id,
    result: report.result,
    summary: parseStoredObject(report.summary_json ?? "null"),
    error: parseStoredObject(report.error_json ?? "null"),
    reviewDecision: report.review_decision,
    reviewNote: report.review_note,
    reviewedAt: report.reviewed_at,
    createdAt: report.created_at,
    updatedAt: report.updated_at,
    completedAt: report.completed_at,
  };
}

function validationError(context: ComparisonContext, details: unknown): Response {
  return context.json({ error: "Validation failed", details, requestId: context.get("requestId") }, 400);
}

function unprocessable(context: ComparisonContext, details: unknown): Response {
  return context.json({ error: "Request cannot be applied", details, requestId: context.get("requestId") }, 422);
}

function unauthorized(context: ComparisonContext, message: string): Response {
  context.header("Cache-Control", "private, no-store");
  return context.json({ error: message, requestId: context.get("requestId") }, 401);
}

function forbidden(context: ComparisonContext, message: string): Response {
  context.header("Cache-Control", "private, no-store");
  return context.json({ error: message, requestId: context.get("requestId") }, 403);
}

function conflict(context: ComparisonContext, message: string): Response {
  return context.json({ error: message, requestId: context.get("requestId") }, 409);
}

function notFound(context: ComparisonContext, message: string): Response {
  return context.json({ error: message, requestId: context.get("requestId") }, 404);
}
