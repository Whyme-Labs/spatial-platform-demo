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
  .map((fields) => ({
    name: fields[5],
    value: fields[6],
    domain: new URL(baseUrl).hostname,
    path: fields[2] || "/",
    httpOnly: true,
    // Wrangler serves local development over HTTP. Production cookies remain Secure.
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
    `${baseUrl}/studio.html#spatial/${encodeURIComponent(projectId)}`,
    { waitUntil: "domcontentloaded", timeout: 20_000 },
  );
  await page.locator("h4", { hasText: "Registered raw-scene change evidence" })
    .waitFor({ state: "visible", timeout: 20_000 });

  if (await page.locator("#loginDialog[open]").count()) {
    throw new Error("The QA session was not authenticated.");
  }

  const openButton = page.getByRole("button", {
    name: /Register and compare PLY assets|Queue another registration \+ comparison/,
  });
  if (await openButton.isDisabled()) {
    throw new Error("Raw-scene comparison stayed disabled despite two eligible fixture versions.");
  }
  await openButton.click();

  const dialog = page.locator("#rawSceneChangeDialog");
  await dialog.waitFor({ state: "visible" });
  const evidence = formField(dialog, "registrationEvidence");
  await evidence.fill(
    "Browser QA: fixture exports use metres and the same gravity-aligned axis; yaw and origin require bounded registration.",
  );
  if (await formField(dialog, "registrationMode").inputValue() !== "automatic_rigid") {
    throw new Error("Automatic rigid registration was not the default production workflow.");
  }

  let submitCount = 0;
  expectedFailureActive = true;
  await page.route("**/api/projects/*/spatial/raw-change-reports", async (route) => {
    submitCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: "QA-injected processor outage. Retry remains safe.",
      }),
    });
  });

  const form = page.locator("#rawSceneChangeForm");
  const submit = form.getByRole("button", { name: "Queue registration and comparison" });
  await submit.evaluate((button) => {
    window.setTimeout(() => {
      const formElement = document.querySelector("#rawSceneChangeForm");
      const trigger = formElement?.querySelector("[type='submit']");
      window.__spatialQaPending = {
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

  await page.locator("#rawSceneChangeError").getByText(
    "QA-injected processor outage. Retry remains safe.",
  ).waitFor({ state: "visible", timeout: 5_000 });
  const pending = {
    requestCount: submitCount,
    ...await page.evaluate(() => window.__spatialQaPending),
  };
  if (
    pending.requestCount !== 1
    || pending.label !== "Queueing registration…"
    || !pending.disabled
    || pending.busy !== "true"
  ) {
    throw new Error(`Invalid pending state: ${JSON.stringify(pending)}`);
  }

  expectedFailureActive = false;

  const recovered = {
    requestCount: submitCount,
    label: await submit.textContent(),
    disabled: await submit.isDisabled(),
    busy: await form.getAttribute("aria-busy"),
    evidence: await evidence.inputValue(),
    registrationMode: await formField(dialog, "registrationMode").inputValue(),
    searchRadiusM: await formField(dialog, "registrationSearchRadiusM").inputValue(),
    maximumRmseMm: await formField(dialog, "registrationMaximumRmseMm").inputValue(),
    minimumOverlapPercent: await formField(dialog, "registrationMinimumOverlapPercent").inputValue(),
    error: await page.locator("#rawSceneChangeError").textContent(),
  };
  if (
    recovered.requestCount !== 1
    || recovered.label !== "Queue registration and comparison"
    || recovered.disabled
    || recovered.busy !== null
    || recovered.registrationMode !== "automatic_rigid"
    || recovered.searchRadiusM !== "1"
    || recovered.maximumRmseMm !== "100"
    || recovered.minimumOverlapPercent !== "55"
    || !recovered.evidence.startsWith("Browser QA: fixture exports use metres")
  ) {
    throw new Error(`Invalid recovery state: ${JSON.stringify(recovered)}`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  const viewport = await page.evaluate(() => {
    const dialog = document.querySelector("#rawSceneChangeDialog");
    const form = document.querySelector("#rawSceneChangeForm");
    const bounds = dialog?.getBoundingClientRect();
    return {
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      dialogLeft: bounds?.left ?? null,
      dialogRight: bounds?.right ?? null,
      formClientWidth: form?.clientWidth ?? null,
      formScrollWidth: form?.scrollWidth ?? null,
    };
  });
  if (
    viewport.scrollWidth > viewport.width + 1 ||
    viewport.dialogLeft === null ||
    viewport.dialogRight === null ||
    viewport.dialogLeft < -1 ||
    viewport.dialogRight > viewport.width + 1 ||
    viewport.formClientWidth !== viewport.formScrollWidth
  ) {
    throw new Error(`Mobile horizontal overflow: ${JSON.stringify(viewport)}`);
  }
  await page.locator("#rawSceneChangeDialog .dialog-close").click();

  if (unexpectedErrors.length) {
    throw new Error(`Unexpected browser errors:\n${unexpectedErrors.join("\n")}`);
  }

  process.stdout.write(`${JSON.stringify({
    desktop: {
      rawSceneActionEnabled: true,
      pending,
      recovered,
    },
    mobile: {
      viewport,
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
