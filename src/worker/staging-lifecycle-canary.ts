import { timingSafeStringEqual } from "./security";

export const STAGING_LIFECYCLE_CANARY_EMAIL =
  "lifecycle-canary@synthetic.invalid" as const;
export const STAGING_LIFECYCLE_CANARY_USER_ID =
  "cafe0000-0000-4000-8000-000000000001" as const;
export const STAGING_LIFECYCLE_CANARY_ORGANISATION_ID =
  "cafe0000-0000-4000-8000-000000000002" as const;

export async function authorizeStagingLifecycleCanary(
  appEnvironment: string,
  configuredToken: string | undefined,
  authorizationHeader: string | undefined,
): Promise<boolean> {
  if (appEnvironment !== "staging" || !configuredToken) return false;
  if (!authorizationHeader?.startsWith("Bearer ")) return false;
  return timingSafeStringEqual(authorizationHeader.slice(7), configuredToken);
}
