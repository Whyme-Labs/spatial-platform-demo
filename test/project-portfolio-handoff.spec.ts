import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { otpHash } from "../src/worker/auth";

const origin = "https://spatial.test";

async function login(): Promise<string> {
  const email = env.ADMIN_EMAIL.toLowerCase();
  const challengeId = crypto.randomUUID();
  const code = "515151";
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
  const access = (response.headers.get("set-cookie") ?? "").match(/spatial_access=([^;,]+)/)?.[1];
  expect(access).toBeTruthy();
  return `spatial_access=${access}`;
}

async function addOrganisationMembership(role = "platform_admin"): Promise<{
  organisationId: string;
  userId: string;
}> {
  const user = await env.DB.prepare(
    "SELECT id FROM users WHERE lower(email) = lower(?)",
  ).bind(env.ADMIN_EMAIL).first<{ id: string }>();
  if (!user) throw new Error("Expected the authenticated fixture user");
  const organisationId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO organisations (id, name, slug)
      VALUES (?, ?, ?)
    `).bind(
      organisationId,
      `Destination ${organisationId.slice(0, 8)}`,
      `destination-${organisationId.slice(0, 8)}`,
    ),
    env.DB.prepare(`
      INSERT INTO memberships
        (organisation_id, user_id, role, status, updated_at)
      VALUES (?, ?, ?, 'active', datetime('now'))
    `).bind(organisationId, user.id, role),
  ]);
  return { organisationId, userId: user.id };
}

describe("advanced project metadata and cross-organisation portfolio handoff", () => {
  it("preserves typed custom fields in an idempotent, metadata-only handoff", async () => {
    const cookie = await login();
    const destination = await addOrganisationMembership();
    const fieldOperationId = crypto.randomUUID();
    const fieldBody = {
      clientOperationId: fieldOperationId,
      key: "portfolio_code",
      label: "Portfolio code",
      description: "Internal portfolio reference used by the commercial team.",
      type: "text",
      required: true,
    };
    const createField = await exports.default.fetch(`${origin}/api/project-fields`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(fieldBody),
    });
    expect(createField.status).toBe(201);
    const { field } = await createField.json<{ field: { id: string; key: string } }>();
    expect(field).toMatchObject({ key: "portfolio_code", type: "text", required: true });

    const fieldReplay = await exports.default.fetch(`${origin}/api/project-fields`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(fieldBody),
    });
    expect(fieldReplay.status).toBe(200);
    await expect(fieldReplay.json()).resolves.toMatchObject({
      field: { id: field.id, key: "portfolio_code" },
      idempotent: true,
    });

    const projectOperationId = crypto.randomUUID();
    const projectBody = {
      clientOperationId: projectOperationId,
      name: "Cross-workspace venue",
      customerName: "Venue Group",
      customerEmail: "ops@venue.example",
      captureAdapter: "xgrids-lcc",
      deliveryTemplate: "Venue navigator",
      customFields: { portfolio_code: "VENUE-001" },
    };
    const projectResponse = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(projectBody),
    });
    expect(projectResponse.status).toBe(201);
    const { project } = await projectResponse.json<{
      project: { id: string; customFields: Record<string, unknown> };
    }>();
    expect(project.customFields).toEqual({ portfolio_code: "VENUE-001" });
    const changedProjectReplay = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        ...projectBody,
        customFields: { portfolio_code: "VENUE-002" },
      }),
    });
    expect(changedProjectReplay.status).toBe(409);
    const portableExport = await exports.default.fetch(`${origin}/api/projects/export`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ projectIds: [project.id] }),
    });
    expect(portableExport.status).toBe(200);
    await expect(portableExport.json()).resolves.toMatchObject({
      schemaVersion: 2,
      fieldDefinitions: [{
        key: "portfolio_code",
        type: "text",
        required: true,
      }],
      projects: [{
        sourceId: project.id,
        customFields: { portfolio_code: "VENUE-001" },
      }],
    });

    const preview = await exports.default.fetch(
      `${origin}/api/projects/portfolio-handoffs/preview`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          targetOrganisationId: destination.organisationId,
          projectIds: [project.id],
        }),
      },
    );
    expect(preview.status).toBe(200);
    await expect(preview.json()).resolves.toMatchObject({
      valid: true,
      targetOrganisation: { id: destination.organisationId },
      summary: {
        projects: 1,
        customers: 1,
        customFields: 1,
        fieldsToCreate: 1,
      },
      conflicts: [],
      exclusions: {
        versions: true,
        assets: true,
        releases: true,
      },
    });

    const clientOperationId = crypto.randomUUID();
    const handoffBody = {
      clientOperationId,
      targetOrganisationId: destination.organisationId,
      projectIds: [project.id],
    };
    const handoff = await exports.default.fetch(`${origin}/api/projects/portfolio-handoffs`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(handoffBody),
    });
    expect(handoff.status).toBe(201);
    const handoffResult = await handoff.json<{
      handoffId: string;
      projects: Array<{ id: string; sourceId: string; status: string }>;
    }>();
    expect(handoffResult).toMatchObject({
      createdCount: 1,
      targetOrganisation: { id: destination.organisationId },
      projects: [{ sourceId: project.id, status: "DRAFT" }],
      exclusions: { versions: true, assets: true, releases: true },
    });
    expect(handoffResult.projects[0]!.id).not.toBe(project.id);

    const handoffReplay = await exports.default.fetch(`${origin}/api/projects/portfolio-handoffs`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(handoffBody),
    });
    expect(handoffReplay.status).toBe(200);
    await expect(handoffReplay.json()).resolves.toMatchObject({
      handoffId: handoffResult.handoffId,
      createdCount: 1,
      idempotent: true,
    });

    const destinationProject = await env.DB.prepare(`
      SELECT p.organisation_id, p.status, d.key, v.value_json
      FROM projects p
      JOIN project_custom_field_values v ON v.project_id = p.id
      JOIN project_custom_field_definitions d ON d.id = v.field_id
      WHERE p.id = ?
    `).bind(handoffResult.projects[0]!.id).first<{
      organisation_id: string;
      status: string;
      key: string;
      value_json: string;
    }>();
    expect(destinationProject).toEqual({
      organisation_id: destination.organisationId,
      status: "DRAFT",
      key: "portfolio_code",
      value_json: JSON.stringify("VENUE-001"),
    });
    const sourceStillExists = await env.DB.prepare(
      "SELECT organisation_id FROM projects WHERE id = ?",
    ).bind(project.id).first<{ organisation_id: string }>();
    expect(sourceStillExists?.organisation_id).not.toBe(destination.organisationId);
  });

  it("blocks handoff without destination administration or with a field-type conflict", async () => {
    const cookie = await login();
    const operatorDestination = await addOrganisationMembership("production_operator");
    const sourceField = await exports.default.fetch(`${origin}/api/project-fields`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        key: "handoff_conflict_code",
        label: "Handoff conflict code",
        type: "text",
        required: false,
      }),
    });
    expect(sourceField.status).toBe(201);
    const projectResponse = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Restricted handoff",
        captureAdapter: "open-import",
        deliveryTemplate: "Property showcase",
        customFields: { portfolio_code: "RESTRICTED-001" },
      }),
    });
    expect(projectResponse.status).toBe(201);
    const { project } = await projectResponse.json<{ project: { id: string } }>();
    const unauthorized = await exports.default.fetch(
      `${origin}/api/projects/portfolio-handoffs/preview`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          targetOrganisationId: operatorDestination.organisationId,
          projectIds: [project.id],
        }),
      },
    );
    expect(unauthorized.status).toBe(403);

    const adminDestination = await addOrganisationMembership();
    await env.DB.prepare(`
      INSERT INTO project_custom_field_definitions
        (id, organisation_id, key, label, field_type, required, active,
          created_by, client_operation_id, request_hash)
      VALUES (?, ?, 'handoff_conflict_code', 'Handoff conflict code', 'number', 0, 1, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      adminDestination.organisationId,
      adminDestination.userId,
      crypto.randomUUID(),
      "a".repeat(64),
    ).run();
    const conflict = await exports.default.fetch(
      `${origin}/api/projects/portfolio-handoffs/preview`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          targetOrganisationId: adminDestination.organisationId,
          projectIds: [project.id],
        }),
      },
    );
    expect(conflict.status).toBe(200);
    await expect(conflict.json()).resolves.toMatchObject({
      valid: false,
      conflicts: [{
        key: "handoff_conflict_code",
        sourceType: "text",
        targetType: "number",
      }],
    });
    const blockedCommit = await exports.default.fetch(
      `${origin}/api/projects/portfolio-handoffs`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: crypto.randomUUID(),
          targetOrganisationId: adminDestination.organisationId,
          projectIds: [project.id],
        }),
      },
    );
    expect(blockedCommit.status).toBe(409);
  });
});
