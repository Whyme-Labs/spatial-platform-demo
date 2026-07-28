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
            TEST_MIGRATIONS: migrations,
          },
        },
      };
    }),
  ],
  test: {
    exclude: ["**/node_modules/**", "**/.git/**", ".tools/**"],
    setupFiles: ["./test/apply-migrations.ts"],
    // Each suite boots an isolated workerd runtime. Starting every suite at
    // once can exhaust local runner sockets and produce false ECONNRESET
    // failures before any application code runs.
    maxWorkers: 1,
    // Worker integration tests exercise D1, R2, email, JWT signing, and full
    // release lifecycles through Miniflare. Remote Cloudflare bindings can
    // transiently take tens of seconds even after the application operation
    // succeeds, so retain a bounded production gate without misclassifying
    // provider transport latency as an application assertion failure.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
