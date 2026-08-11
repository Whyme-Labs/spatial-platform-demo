import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { otpHash } from "../src/worker/auth";

const origin = "https://spatial.test";

async function login(requestedEmail = env.ADMIN_EMAIL): Promise<string> {
  const email = requestedEmail.toLowerCase();
  const challengeId = crypto.randomUUID();
  const code = "867530";
  await env.DB.prepare(`
    INSERT INTO auth_otp_challenges (id, email, code_hash, expires_at)
    VALUES (?, ?, ?, ?)
  `).bind(
    challengeId,
    email,
    await otpHash(challengeId, email, code, env.OTP_PEPPER),
    new Date(Date.now() + 60_000).toISOString(),
  ).run();
  const response = await exports.default.fetch(`${origin}/api/auth/otp/verify`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "CF-Connecting-IP": `2001:db8::${crypto.getRandomValues(new Uint16Array(1))[0].toString(16)}`,
    },
    body: JSON.stringify({ email, challengeId, code }),
  });
  expect(response.status).toBe(200);
  const access = (response.headers.get("set-cookie") ?? "")
    .match(/spatial_access=([^;,]+)/)?.[1];
  expect(access).toBeTruthy();
  return `spatial_access=${access}`;
}

describe("project capture and policy governance", () => {
  it("creates a project from an explicit capture origin, asset producer, and compatible asset purposes", async () => {
    const cookie = await login();
    const response = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        name: "Phone capture reconstructed externally",
        captureOrigin: "phone",
        assetProducer: "open-import",
        capturePlan: [
          { purpose: "web_scene", format: "rad" },
          { purpose: "metric_point_cloud", format: "ply" },
        ],
        deliveryTemplate: "Property showcase",
      }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      project: {
        captureOrigin: "phone",
        assetProducer: "open-import",
      },
    });
  });

  it("rejects an incompatible capture plan before creating the project", async () => {
    const cookie = await login();
    const clientOperationId = crypto.randomUUID();
    const response = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId,
        name: "Invalid phone capture plan",
        captureOrigin: "phone",
        assetProducer: "open-import",
        capturePlan: [
          { purpose: "gaussian_splat", format: "mp4" },
          { purpose: "metric_point_cloud", format: "ply" },
        ],
        deliveryTemplate: "Property showcase",
      }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("mp4"),
    });
    const project = await env.DB.prepare(
      "SELECT id FROM projects WHERE client_operation_id = ?",
    ).bind(clientOperationId).first();
    expect(project).toBeNull();
  });

  it("prevents production operators from changing project policy", async () => {
    const adminCookie = await login();
    const projectResponse = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Governed venue",
        captureAdapter: "open-import",
        deliveryTemplate: "Venue navigator",
      }),
    });
    const { project } = await projectResponse.json<{ project: { id: string } }>();
    const admin = await env.DB.prepare(`
      SELECT organisation_id FROM memberships WHERE role = 'platform_admin' LIMIT 1
    `).first<{ organisation_id: string }>();
    const operatorId = crypto.randomUUID();
    const operatorEmail = `operator-${operatorId.slice(0, 8)}@example.test`;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (id, email, display_name) VALUES (?, ?, 'Policy operator')",
      ).bind(operatorId, operatorEmail),
      env.DB.prepare(`
        INSERT INTO memberships (organisation_id, user_id, role)
        VALUES (?, ?, 'production_operator')
      `).bind(admin!.organisation_id, operatorId),
    ]);
    const operatorCookie = await login(operatorEmail);

    const response = await exports.default.fetch(`${origin}/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { cookie: operatorCookie, "content-type": "application/json" },
      body: JSON.stringify({ deliveryTemplate: "Property showcase" }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("administrator"),
    });
  });

  it("enforces publication and navigation policy before release processing", async () => {
    const cookie = await login();
    const projectResponse = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Private measured capture",
        captureAdapter: "open-import",
        deliveryTemplate: "Measured capture pack",
      }),
    });
    const { project } = await projectResponse.json<{ project: { id: string } }>();
    const response = await exports.default.fetch(`${origin}/api/projects/${project.id}/releases`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        slug: "crafted-public-fly-release",
        accessPolicy: "public",
        viewerConfig: {
          title: "Crafted release",
          measurementDisclaimer: "Visual reference only.",
          defaultMovementMode: "fly",
        },
      }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      details: {
        accessPolicy: [expect.stringContaining("private review")],
        defaultMovementMode: [expect.stringContaining("walking")],
      },
    });

    const venueResponse = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        name: "ADA-governed venue",
        captureAdapter: "open-import",
        deliveryTemplate: "Venue navigator",
      }),
    });
    const venue = await venueResponse.json<{ project: { id: string } }>();
    const uploadResponse = await exports.default.fetch(
      `${origin}/api/projects/${venue.project.id}/uploads`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "venue.rad",
          sizeBytes: 16,
          format: "rad",
          purpose: "web_scene",
          mimeType: "application/octet-stream",
        }),
      },
    );
    const upload = await uploadResponse.json<{ upload: { versionId: string } }>();
    const provisionalProfile = await exports.default.fetch(
      `${origin}/api/projects/${venue.project.id}/spatial/navigation-profile`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          versionId: upload.upload.versionId,
          worldUnit: "scene_units",
          agentRadius: 0.3,
          agentHeight: 1.75,
          eyeHeight: 1.58,
          maxStepMetres: 0.08,
        }),
      },
    );
    expect(provisionalProfile.status).toBe(200);
    const venueRelease = await exports.default.fetch(
      `${origin}/api/projects/${venue.project.id}/releases`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          slug: "uncleared-ada-venue",
          accessPolicy: "public",
          viewerConfig: {
            title: "Uncleared venue",
            measurementDisclaimer: "Visual reference only.",
            defaultMovementMode: "walk",
          },
        }),
      },
    );
    expect(venueRelease.status).toBe(422);
    await expect(venueRelease.json()).resolves.toMatchObject({
      details: {
        navigationClearance: [expect.stringContaining("ADA route review")],
      },
    });
  });

  it("enforces hidden and indicative measurement policy at the API", async () => {
    const cookie = await login();
    const create = async (name: string, deliveryTemplate: string) => {
      const response = await exports.default.fetch(`${origin}/api/projects`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ name, captureAdapter: "open-import", deliveryTemplate }),
      });
      const created = await response.json<{ project: { id: string } }>();
      const uploadResponse = await exports.default.fetch(
        `${origin}/api/projects/${created.project.id}/uploads`,
        {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({
            fileName: "policy.rad",
            sizeBytes: 16,
            format: "rad",
            purpose: "web_scene",
            mimeType: "application/octet-stream",
          }),
        },
      );
      expect(uploadResponse.status).toBe(201);
      const upload = await uploadResponse.json<{ upload: { versionId: string } }>();
      return { ...created, versionId: upload.upload.versionId };
    };
    const hidden = await create("Hidden measurements", "Property showcase");
    const indicative = await create("Indicative measurements", "Venue navigator");
    const brief = (versionId: string, relianceClass: string) => ({
      versionId,
      productType: "measured_floor_plan",
      intendedUse: "Policy enforcement regression",
      units: "metres",
      toleranceMm: 50,
      relianceClass,
    });

    const hiddenResponse = await exports.default.fetch(
      `${origin}/api/projects/${hidden.project.id}/measurement/briefs`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(brief(hidden.versionId, "indicative")),
      },
    );
    expect(hiddenResponse.status).toBe(422);
    await expect(hiddenResponse.json()).resolves.toMatchObject({
      error: expect.stringContaining("hidden"),
    });

    const indicativeResponse = await exports.default.fetch(
      `${origin}/api/projects/${indicative.project.id}/measurement/briefs`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(brief(indicative.versionId, "project_verified")),
      },
    );
    expect(indicativeResponse.status).toBe(422);
    await expect(indicativeResponse.json()).resolves.toMatchObject({
      error: expect.stringContaining("indicative"),
    });
  });

  it("keeps a scene version bound to its original policy revision after project defaults change", async () => {
    const cookie = await login();
    const projectResponse = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Version-bound policy",
        captureAdapter: "open-import",
        deliveryTemplate: "Property showcase",
      }),
    });
    const { project } = await projectResponse.json<{ project: { id: string } }>();
    const uploadResponse = await exports.default.fetch(`${origin}/api/projects/${project.id}/uploads`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "scene.rad",
        sizeBytes: 16,
        format: "rad",
        purpose: "web_scene",
        mimeType: "application/octet-stream",
      }),
    });
    expect(uploadResponse.status).toBe(201);
    const transition = await exports.default.fetch(`${origin}/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ deliveryTemplate: "Film production scene" }),
    });
    expect(transition.status).toBe(200);

    const detailResponse = await exports.default.fetch(`${origin}/api/projects/${project.id}`, {
      headers: { cookie },
    });
    const detail = await detailResponse.json<{
      project: { workflowPolicy: { publication: string }; workflowPolicyRevisionId: string };
      versions: Array<{
        id: string;
        workflow_policy_revision_id: string;
        workflow_policy_json: string;
      }>;
    }>();
    expect(detail.project.workflowPolicy.publication).toBe("private-review");
    expect(JSON.parse(detail.versions[0]!.workflow_policy_json)).toMatchObject({
      publication: "public-after-approval",
    });
    expect(detail.versions[0]!.workflow_policy_revision_id)
      .not.toBe(detail.project.workflowPolicyRevisionId);

    const newerDefaults = await exports.default.fetch(`${origin}/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ deliveryTemplate: "Venue navigator" }),
    });
    expect(newerDefaults.status).toBe(200);
    await env.DB.prepare(`
      UPDATE scene_versions SET workflow_policy_revision_id = NULL
      WHERE id = ?
    `).bind(detail.versions[0]!.id).run();
    const releaseWithMissingRevision = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/releases`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          slug: "missing-policy-revision",
          accessPolicy: "public",
          viewerConfig: {
            title: "Missing policy revision",
            measurementDisclaimer: "Visual reference only.",
            defaultMovementMode: "walk",
          },
        }),
      },
    );
    expect(releaseWithMissingRevision.status).toBe(422);
    await expect(releaseWithMissingRevision.json()).resolves.toMatchObject({
      details: {
        accessPolicy: [expect.stringContaining("private review")],
      },
    });
  });

  it("records the actual fields changed by a policy-only revision", async () => {
    const cookie = await login();
    const create = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Policy delta receipt",
        captureAdapter: "open-import",
        deliveryTemplate: "Property showcase",
      }),
    });
    const { project } = await create.json<{
      project: { id: string; workflowPolicy: Record<string, string> };
    }>();
    const transition = await exports.default.fetch(`${origin}/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        workflowPolicy: { ...project.workflowPolicy, quality: "high-detail" },
      }),
    });
    expect(transition.status).toBe(200);
    const revision = await env.DB.prepare(`
      SELECT transition_reason FROM project_workflow_policy_revisions
      WHERE project_id = ? ORDER BY revision_number DESC LIMIT 1
    `).bind(project.id).first<{ transition_reason: string }>();
    expect(revision?.transition_reason).toContain("Workflow policy revised");
    expect(revision?.transition_reason).toContain("quality");
    expect(revision?.transition_reason).not.toContain("changed from Property showcase to Property showcase");
  });

  it("does not promote operator-attested registration to public or verified claims", async () => {
    const cookie = await login();
    const createProject = async (name: string, deliveryTemplate: string) => {
      const response = await exports.default.fetch(`${origin}/api/projects`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ name, captureAdapter: "open-import", deliveryTemplate }),
      });
      return response.json<{ project: { id: string } }>();
    };
    const createAttestedVersion = async (projectId: string) => {
      const response = await exports.default.fetch(`${origin}/api/projects/${projectId}/uploads`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "attested.rad",
          sizeBytes: 16,
          format: "rad",
          purpose: "web_scene",
          mimeType: "application/octet-stream",
          captureJourney: {
            id: crypto.randomUUID(),
            sameFrameConfirmed: true,
          },
        }),
      });
      expect(response.status).toBe(201);
      return response.json<{ upload: { versionId: string } }>();
    };

    const publicProject = await createProject("Attested public scene", "Property showcase");
    await createAttestedVersion(publicProject.project.id);
    const release = await exports.default.fetch(
      `${origin}/api/projects/${publicProject.project.id}/releases`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          slug: "attested-public-scene",
          accessPolicy: "public",
          viewerConfig: {
            title: "Attested scene",
            measurementDisclaimer: "Visual reference only.",
            defaultMovementMode: "walk",
          },
        }),
      },
    );
    expect(release.status).toBe(422);
    await expect(release.json()).resolves.toMatchObject({
      error: expect.stringContaining("processor-qualified"),
    });

    const measuredProject = await createProject("Attested measured scene", "Measured capture pack");
    const measuredVersion = await createAttestedVersion(measuredProject.project.id);
    const brief = await exports.default.fetch(
      `${origin}/api/projects/${measuredProject.project.id}/measurement/briefs`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          versionId: measuredVersion.upload.versionId,
          productType: "measured_floor_plan",
          intendedUse: "Assurance regression",
          units: "metres",
          toleranceMm: 50,
          relianceClass: "project_verified",
        }),
      },
    );
    expect(brief.status).toBe(422);
    await expect(brief.json()).resolves.toMatchObject({
      error: expect.stringContaining("processor-qualified"),
    });

    const unqualifiedProject = await createProject(
      "Missing measured registration",
      "Measured capture pack",
    );
    const unqualifiedUpload = await exports.default.fetch(
      `${origin}/api/projects/${unqualifiedProject.project.id}/uploads`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "unqualified.rad",
          sizeBytes: 16,
          format: "rad",
          purpose: "web_scene",
          mimeType: "application/octet-stream",
        }),
      },
    );
    const unqualifiedVersion = await unqualifiedUpload.json<{
      upload: { versionId: string };
    }>();
    const unqualifiedBrief = await exports.default.fetch(
      `${origin}/api/projects/${unqualifiedProject.project.id}/measurement/briefs`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          versionId: unqualifiedVersion.upload.versionId,
          productType: "measured_floor_plan",
          intendedUse: "Missing-evidence regression",
          units: "metres",
          toleranceMm: 50,
          relianceClass: "project_verified",
        }),
      },
    );
    expect(unqualifiedBrief.status).toBe(422);
    await expect(unqualifiedBrief.json()).resolves.toMatchObject({
      error: expect.stringContaining("registration evidence"),
    });

    const measuredOwner = await env.DB.prepare(`
      SELECT organisation_id, created_by FROM projects WHERE id = ?
    `).bind(measuredProject.project.id).first<{
      organisation_id: string;
      created_by: string;
    }>();
    const legacyBriefId = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO measurement_briefs (
        id, organisation_id, project_id, version_id, product_type,
        intended_use, units, tolerance_mm, reliance_class, status, created_by
      ) VALUES (?, ?, ?, ?, 'measured_floor_plan',
        'Legacy accepted brief regression', 'metres', 50,
        'project_verified', 'accepted', ?)
    `).bind(
      legacyBriefId,
      measuredOwner!.organisation_id,
      measuredProject.project.id,
      measuredVersion.upload.versionId,
      measuredOwner!.created_by,
    ).run();
    const legacyDeliverable = await exports.default.fetch(
      `${origin}/api/projects/${measuredProject.project.id}/measurement/briefs/${legacyBriefId}/deliverables`,
      { method: "POST", headers: { cookie } },
    );
    expect(legacyDeliverable.status).toBe(422);
    await expect(legacyDeliverable.json()).resolves.toMatchObject({
      error: expect.stringContaining("processor-qualified"),
    });
    const signoff = await exports.default.fetch(
      `${origin}/api/projects/${measuredProject.project.id}/measurement/briefs/${legacyBriefId}/signoffs`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          professionalName: "Assurance Reviewer",
          registrationBody: "Test Registration Board",
          registrationNumber: "TEST-001",
          scope: "Legacy trust-elevation regression",
          signedAt: new Date().toISOString(),
        }),
      },
    );
    expect(signoff.status).toBe(422);
    await expect(signoff.json()).resolves.toMatchObject({
      error: expect.stringContaining("processor-qualified"),
    });

    const indicativeBriefId = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO measurement_briefs (
        id, organisation_id, project_id, version_id, product_type,
        intended_use, units, tolerance_mm, reliance_class, status, created_by
      ) VALUES (?, ?, ?, ?, 'measured_floor_plan',
        'Indicative promotion regression', 'metres', 50,
        'indicative', 'accepted', ?)
    `).bind(
      indicativeBriefId,
      measuredOwner!.organisation_id,
      measuredProject.project.id,
      measuredVersion.upload.versionId,
      measuredOwner!.created_by,
    ).run();
    const indicativeSignoff = await exports.default.fetch(
      `${origin}/api/projects/${measuredProject.project.id}/measurement/briefs/${indicativeBriefId}/signoffs`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          professionalName: "Assurance Reviewer",
          registrationBody: "Test Registration Board",
          registrationNumber: "TEST-002",
          scope: "Indicative promotion regression",
          signedAt: new Date().toISOString(),
        }),
      },
    );
    expect(indicativeSignoff.status).toBe(409);
    await expect(indicativeSignoff.json()).resolves.toMatchObject({
      error: expect.stringContaining("project-verified brief"),
    });
  });
});
