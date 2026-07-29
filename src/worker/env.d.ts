export {};

declare global {
  interface Env {
    JWT_KEYRING: string;
    OTP_PEPPER: string;
    REFRESH_TOKEN_PEPPER: string;
    TURNSTILE_SECRET_KEY: string;
    CLOUDFLARE_SAAS_API_TOKEN?: string;
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
    OIDC_CLIENT_SECRETS?: string;
  }
}
