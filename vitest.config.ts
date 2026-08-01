import path from "node:path";
import { webcrypto } from "node:crypto";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(
        path.join(import.meta.dirname, "migrations"),
      );
      const { privateKey } = await webcrypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"],
      );
      const privateJwk = await webcrypto.subtle.exportKey("jwk", privateKey);
      const now = new Date();
      const kid = "test-es256-key";
      const jwtKeyRing = JSON.stringify({
        version: 1,
        activeKid: kid,
        keys: [{
          kid,
          status: "active",
          privateJwk,
          createdAt: now.toISOString(),
          notBefore: new Date(now.getTime() - 60_000).toISOString(),
        }],
      });

      return {
        // Unit and integration suites must remain deterministic and runnable
        // without Cloudflare account credentials. Live Workers AI acceptance
        // is covered by the explicit production smoke checks instead.
        remoteBindings: false,
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            APP_ORIGIN: "https://spatial.test",
            JWT_ISSUER: "https://spatial.test",
            SESSION_PEPPER: "test-session-pepper",
            WORKER_API_TOKEN: "test-worker-token",
            JWT_KEYRING: jwtKeyRing,
            OTP_PEPPER: "test-otp-pepper",
            REFRESH_TOKEN_PEPPER: "test-refresh-pepper",
            TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
            TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
            TEST_MIGRATIONS: migrations,
          },
        },
      };
    }),
  ],
  test: {
    exclude: [
      "**/node_modules/**",
      "**/.git/**",
      ".tools/**",
      "node-test/**",
      "e2e/**",
      "playwright-report/**",
      "test-results/**",
    ],
    setupFiles: ["./test/apply-migrations.ts"],
    // Each suite boots an isolated workerd runtime. Starting every suite at
    // once can exhaust local runner sockets and produce false ECONNRESET
    // failures before any application code runs.
    maxWorkers: 1,
    // Worker integration tests exercise D1, R2, email, JWT signing, and full
    // release lifecycles through Miniflare. Keep a bounded production gate
    // without misclassifying workerd startup or storage latency as an
    // application assertion failure.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    coverage: {
      provider: "istanbul",
      include: [
        "src/worker/**/*.ts",
        "src/shared/**/*.ts",
        "src/processor-cloud/**/*.ts",
        "src/client/action-state.ts",
        "src/client/floor-plan.ts",
      ],
      exclude: [
        "src/worker/env.d.ts",
      ],
      reporter: [
        "text-summary",
        "json-summary",
        "lcov",
        "html",
      ],
      reportsDirectory: "coverage",
      reportOnFailure: true,
      thresholds: {
        statements: 66,
        branches: 50,
        functions: 82,
        lines: 74,
      },
    },
  },
});
