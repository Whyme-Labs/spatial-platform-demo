import { readFile } from "node:fs/promises";

const repositoryRoot = new URL("../", import.meta.url);
const application = JSON.parse(
  await readFile(new URL("wrangler.jsonc", repositoryRoot), "utf8"),
);
const processor = JSON.parse(
  await readFile(new URL("wrangler.processor.jsonc", repositoryRoot), "utf8"),
);

function requireConfiguration(condition, message) {
  if (!condition) {
    throw new Error(`Production configuration audit failed: ${message}`);
  }
}

function bindingByName(bindings, binding) {
  return bindings.find((entry) => entry.binding === binding);
}

const appStaging = application.env?.staging;
const appProduction = application.env?.production;
const processorProduction = processor.env?.production;

requireConfiguration(appStaging, "application staging environment is missing");
requireConfiguration(appProduction, "application production environment is missing");
requireConfiguration(processorProduction, "processor production environment is missing");

requireConfiguration(
  appProduction.workers_dev === false,
  "production workers.dev route must stay disabled",
);
requireConfiguration(
  appProduction.preview_urls === false,
  "production preview URLs must stay disabled",
);
requireConfiguration(
  appProduction.routes?.some(
    (route) =>
      route.pattern === "spatial.whymelabs.com" &&
      route.custom_domain === true,
  ),
  "production custom domain must be spatial.whymelabs.com",
);
requireConfiguration(
  appProduction.vars?.APP_ORIGIN === "https://spatial.whymelabs.com" &&
    appProduction.vars?.JWT_ISSUER === "https://spatial.whymelabs.com",
  "production origin and JWT issuer must use the canonical HTTPS domain",
);
requireConfiguration(
  application.assets?.run_worker_first === true,
  "static assets must pass through Worker security middleware",
);

const stagingDatabase = bindingByName(appStaging.d1_databases ?? [], "DB");
const productionDatabase = bindingByName(appProduction.d1_databases ?? [], "DB");
const stagingBucket = bindingByName(appStaging.r2_buckets ?? [], "SPATIAL_ASSETS");
const productionBucket = bindingByName(appProduction.r2_buckets ?? [], "SPATIAL_ASSETS");
const stagingAuthCache = bindingByName(appStaging.kv_namespaces ?? [], "AUTH_CACHE");
const productionAuthCache = bindingByName(appProduction.kv_namespaces ?? [], "AUTH_CACHE");

requireConfiguration(
  stagingDatabase?.database_id &&
    productionDatabase?.database_id &&
    stagingDatabase.database_id !== productionDatabase.database_id,
  "staging and production D1 databases must be isolated",
);
requireConfiguration(
  stagingBucket?.bucket_name &&
    productionBucket?.bucket_name &&
    stagingBucket.bucket_name !== productionBucket.bucket_name,
  "staging and production R2 buckets must be isolated",
);
requireConfiguration(
  stagingAuthCache?.id &&
    productionAuthCache?.id &&
    stagingAuthCache.id !== productionAuthCache.id,
  "staging and production KV namespaces must be isolated",
);

for (const secret of [
  "JWT_KEYRING",
  "OTP_PEPPER",
  "REFRESH_TOKEN_PEPPER",
  "SESSION_PEPPER",
  "WORKER_API_TOKEN",
]) {
  requireConfiguration(
    appProduction.secrets?.required?.includes(secret),
    `production required secret ${secret} is not declared`,
  );
}

requireConfiguration(
  processorProduction.vars?.APP_ORIGIN === "https://spatial.whymelabs.com",
  "processor must call the canonical production application origin",
);
requireConfiguration(
  processorProduction.secrets?.required?.includes("WORKER_API_TOKEN"),
  "processor WORKER_API_TOKEN must be declared",
);
requireConfiguration(
  processorProduction.queues?.consumers?.some(
    (consumer) =>
      consumer.queue === "spatial-processing-dispatch-production" &&
      consumer.dead_letter_queue ===
        "spatial-processing-dispatch-production-dlq",
  ),
  "processor production dispatch queue and dead-letter queue are missing",
);

console.log(
  "Production configuration audit passed: canonical domain only, isolated storage, declared secrets, and guarded processor dispatch.",
);
