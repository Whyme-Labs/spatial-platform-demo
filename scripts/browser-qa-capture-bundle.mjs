import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.SPATIAL_QA_ORIGIN ?? "http://localhost:8787";
const projectId = process.env.SPATIAL_QA_PROJECT_ID;
const cookieJarPath = process.env.SPATIAL_QA_COOKIE_JAR;

if (!projectId || !cookieJarPath) {
  throw new Error(
    "Set SPATIAL_QA_PROJECT_ID and SPATIAL_QA_COOKIE_JAR before running this authenticated local QA.",
  );
}

const cookieJar = await readFile(cookieJarPath, "utf8");
const cookies = cookieJar
  .split(/\r?\n/)
  .filter((line) => line && (!line.startsWith("#") || line.startsWith("#HttpOnly_")))
  .map((line) => line.replace(/^#HttpOnly_/, "").split("\t"))
  .filter((fields) => fields[5] && fields[6])
  .map((fields) => ({
    name: fields[5],
    value: fields[6],
    domain: new URL(baseUrl).hostname,
    path: fields[2] || "/",
    httpOnly: true,
    secure: false,
    sameSite: "Strict",
  }));

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_EXECUTABLE_PATH
    ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies(cookies);
  const page = await context.newPage();
  const unexpectedErrors = [];
  let expectedFailureActive = false;
  page.on("console", (message) => {
    if (message.type() === "error" && !expectedFailureActive) {
      unexpectedErrors.push(`console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => unexpectedErrors.push(`page: ${error.message}`));

  await page.goto(
    `${baseUrl}/studio.html#projects/${encodeURIComponent(projectId)}`,
    { waitUntil: "domcontentloaded", timeout: 20_000 },
  );
  await page.getByRole("button", { name: "Register capture bundle" })
    .waitFor({ state: "visible", timeout: 20_000 });
  if (await page.locator("#loginDialog[open]").count()) {
    throw new Error("The QA session was not authenticated.");
  }

  await page.getByRole("button", { name: "Register capture bundle" }).click();
  const dialog = page.locator("#captureBundleDialog");
  await dialog.waitFor({ state: "visible" });
  await formField(dialog, "model").fill("Browser QA source");
  await formField(dialog, "exporterVersion").fill("qa-1.0");
  await formField(dialog, "registrationMethod").fill(
    "Browser QA preserves the immutable source scale, origin, and right-handed Y-up frame.",
  );
  await formField(dialog, "rightsEvidence").fill(
    "Browser QA fixture records written commercial use, self-hosting, and derived redistribution permission.",
  );
  for (const name of [
    "commercialUseConfirmed",
    "selfHostingConfirmed",
    "redistributionConfirmed",
  ]) {
    await formField(dialog, name).check();
  }

  const selectedAssetsBefore = await dialog.locator(
    "input[name='captureAsset']:checked",
  ).count();
  if (!selectedAssetsBefore) {
    throw new Error("The fixture did not preselect any compatible verified asset.");
  }

  let submitCount = 0;
  expectedFailureActive = true;
  await page.route("**/api/projects/*/capture-bundles", async (route) => {
    submitCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: "QA-injected manifest outage. Exact evidence remains retryable.",
      }),
    });
  });

  const form = page.locator("#captureBundleForm");
  const submit = form.getByRole("button", { name: "Register immutable capture bundle" });
  await submit.evaluate((button) => {
    window.setTimeout(() => {
      const formElement = document.querySelector("#captureBundleForm");
      const trigger = formElement?.querySelector("[type='submit']");
      window.__spatialCaptureBundlePending = {
        label: trigger?.textContent ?? null,
        disabled: trigger instanceof HTMLButtonElement ? trigger.disabled : null,
        busy: formElement?.getAttribute("aria-busy") ?? null,
        disabledControlCount: formElement?.querySelectorAll(
          "input:disabled, select:disabled, textarea:disabled, button:disabled",
        ).length ?? 0,
      };
    }, 100);
    button.click();
    button.click();
  });

  await page.locator("#captureBundleError").getByText(
    "QA-injected manifest outage. Exact evidence remains retryable.",
  ).waitFor({ state: "visible", timeout: 5_000 });
  const pending = {
    requestCount: submitCount,
    ...await page.evaluate(() => window.__spatialCaptureBundlePending),
  };
  if (
    pending.requestCount !== 1 ||
    pending.label !== "Registering bundle…" ||
    !pending.disabled ||
    pending.busy !== "true" ||
    pending.disabledControlCount < 20
  ) {
    throw new Error(`Invalid pending state: ${JSON.stringify(pending)}`);
  }
  expectedFailureActive = false;

  const recovered = {
    requestCount: submitCount,
    label: await submit.textContent(),
    disabled: await submit.isDisabled(),
    busy: await form.getAttribute("aria-busy"),
    rightsEvidence: await formField(dialog, "rightsEvidence").inputValue(),
    selectedAssets: await dialog.locator("input[name='captureAsset']:checked").count(),
    selectedRoles: await dialog.locator("select[data-capture-roles] option:checked").count(),
    error: await page.locator("#captureBundleError").textContent(),
  };
  if (
    recovered.requestCount !== 1 ||
    recovered.label !== "Register immutable capture bundle" ||
    recovered.disabled ||
    recovered.busy !== null ||
    recovered.selectedAssets !== selectedAssetsBefore ||
    recovered.selectedRoles < 1 ||
    !recovered.rightsEvidence.startsWith("Browser QA fixture")
  ) {
    throw new Error(`Invalid recovery state: ${JSON.stringify(recovered)}`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  const mobile = await page.evaluate(() => {
    const dialogElement = document.querySelector("#captureBundleDialog");
    const formElement = document.querySelector("#captureBundleForm");
    if (!(dialogElement instanceof HTMLDialogElement) || !(formElement instanceof HTMLFormElement)) {
      return null;
    }
    const bounds = dialogElement.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      dialogLeft: bounds.left,
      dialogRight: bounds.right,
      formClientWidth: formElement.clientWidth,
      formScrollWidth: formElement.scrollWidth,
    };
  });
  if (
    !mobile ||
    mobile.documentScrollWidth > mobile.viewportWidth + 1 ||
    mobile.dialogLeft < -1 ||
    mobile.dialogRight > mobile.viewportWidth + 1 ||
    mobile.formScrollWidth > mobile.formClientWidth + 1
  ) {
    throw new Error(`Mobile horizontal overflow: ${JSON.stringify(mobile)}`);
  }

  if (unexpectedErrors.length) {
    throw new Error(`Unexpected browser errors:\n${unexpectedErrors.join("\n")}`);
  }

  process.stdout.write(`${JSON.stringify({
    desktop: {
      actionEnabled: true,
      selectedAssetsBefore,
      pending,
      recovered,
    },
    mobile: {
      ...mobile,
      noHorizontalOverflow: true,
    },
    unexpectedErrors: 0,
  }, null, 2)}\n`);
} finally {
  await browser.close();
}

function formField(parent, name) {
  return parent.locator(`[name="${name}"]`);
}
