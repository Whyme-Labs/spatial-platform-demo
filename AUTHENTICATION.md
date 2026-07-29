# Authentication and key lifecycle

Spatial Studio supports passwordless email OTP and organisation-scoped
enterprise OpenID Connect (OIDC). Both successful login methods issue the same
two application token types:

- ES256 access JWT: five-minute lifetime, sent in an HttpOnly, Secure,
  SameSite=Strict cookie. Each request verifies signature, issuer, audience,
  time claims, `kid`, active membership, and the non-revoked D1 session.
- opaque refresh token: 30-day lifetime, restricted to `/api/auth`, hashed in
  D1, rotated on every use. Hashes of consumed tokens are retained so reuse of
  any earlier refresh token revokes the session.

Cloudflare Email Sending delivers both text and HTML OTP messages from
`login@whymelabs.com`. OTP challenges expire after ten minutes, allow at most
five attempts, and are consumed atomically in D1. Responses are deliberately
generic so the endpoint does not disclose which emails are authorised.

Every OTP request and resend also requires a fresh Cloudflare Turnstile token.
The browser widget uses action `otp_request`; the Worker validates the
single-use token through Siteverify before creating a D1 challenge or sending
email, and rejects mismatched action or hostname results. Siteverify uses the
request's Cloudflare client address, a per-request idempotency key, an
eight-second timeout, and one bounded transient retry. Turnstile complements
the authoritative D1 IP/email limits; it does not replace them. The public
sitekey is returned by `/api/auth/config`, while `TURNSTILE_SECRET_KEY` exists
only as a Worker secret.

Organisation team invitations use the same verified email identity boundary,
but do not make membership active when an administrator merely types an email.
The D1 membership remains `invited` until a valid, unexpired invitation is
accepted by a successful OTP verification. Expired invitations are revoked by
the scheduled lifecycle Worker.

## Enterprise OIDC

Platform administrators can register an organisation-specific OIDC provider
with an issuer, public client ID, and exact allowed email domains. Registration
creates a D1 `draft`; it does not make SSO available. Activation succeeds only
when:

- `OIDC_CLIENT_SECRETS` contains a client secret under the provider's generated
  UUID;
- live issuer discovery succeeds without redirects or local/numeric hosts;
- discovery confirms authorization-code flow, PKCE S256, and RS256 or ES256
  signed ID tokens.

The client secret is a Worker secret. It is never submitted through the Studio
UI, returned by an API, or stored in D1.

Login discovery returns only active providers whose exact email domain matches
and whose secret remains configured. Starting login creates a ten-minute,
single-use D1 attempt with hashed state, hashed nonce, hashed requested email,
and AES-GCM-encrypted nonce/PKCE verifier. A separate HttpOnly, Secure,
SameSite=Lax state-binding cookie prevents login CSRF on the cross-site
top-level callback.

The callback atomically consumes the attempt before token exchange, re-runs
discovery, exchanges the authorization code with PKCE, and verifies:

- signature against the current provider JWKS;
- advertised RS256/ES256 algorithm and `kid`;
- exact issuer, client audience, and `azp` when multiple audiences exist;
- expiry, recent issue time, optional not-before, and exact nonce;
- verified email, exact allowed domain, and exact email used to start login.

An OIDC subject is linked only to an existing active member or a matching live
invitation in that provider's organisation. A matching domain never creates an
uninvited user. The subject/user link is unique and retained as audit history.
OIDC sessions cannot switch into a different organisation. Disabling a provider
revokes every session issued through it immediately.

## Why D1, R2, and KV have different jobs

| Store | Authoritative use |
|---|---|
| R2 | raw captures, Gaussian masters, SOG/SPZ/LCC2 derivatives, collision meshes, reports |
| D1 | users, membership, OTP hashes/attempts, OIDC provider metadata and subject links, encrypted short-lived OIDC attempts, revocable refresh sessions, asset metadata, workflow state, audit/security events |
| KV | short-lived OTP resend suppression and future non-authoritative public discovery caches |

KV is eventually consistent. It must never decide whether an OTP is valid,
whether a refresh token is current, whether a session is revoked, or what role
a user has.

## ES256 key ring

`JWT_KEYRING` is a Worker secret containing one active P-256 private JWK and
zero or more verification-only predecessor keys. JWT headers include `kid`.
Only public `x`/`y` coordinates are exposed at `/.well-known/jwks.json`.

Keep an encrypted operational copy of the current private key ring outside the
repository. Cloudflare secrets cannot be read back after upload.

The deployed staging and production source rings are stored in macOS Keychain
under:

- `com.whymelabs.spatial-studio.jwt.staging`
- `com.whymelabs.spatial-studio.jwt.production`

Retrieve a ring into a permission-restricted temporary file only for rotation:

```bash
umask 077
security find-generic-password -w \
  -s com.whymelabs.spatial-studio.jwt.production > jwt-keyring.json
```

Create an initial ring:

```bash
node scripts/auth-keyring.mjs new jwt-keyring.json
```

Rotate with overlap:

```bash
node scripts/auth-keyring.mjs rotate jwt-keyring.json jwt-keyring-next.json
npx wrangler secret put JWT_KEYRING --env staging < jwt-keyring-next.json
```

The script makes the new key active, marks predecessors verification-only, and
retains them for a ten-minute overlap—twice the current access-token lifetime.
After staging validation, upload the same intended production ring (or a
separately generated production ring), securely archive the new source ring,
and destroy obsolete copies. A later rotation removes keys whose
`retireAfter` has passed.

After changing the production secret, advance and verify the custom-domain
trigger:

```bash
npx wrangler triggers deploy --env production
curl --fail https://spatial.whymelabs.com/.well-known/jwks.json
```

Emergency rotation can replace the ring immediately. That invalidates access
JWTs signed by removed keys; refresh sessions remain usable unless revoked.

## Session response actions

- logout sets `auth_sessions.revoked_at` and clears both cookies
- old refresh-token reuse revokes the entire session
- membership/role changes take effect immediately because D1 is checked on
  every access-token request
- every team role change or revocation also revokes all target `auth_sessions`;
  stale access JWTs and refresh tokens therefore fail immediately
- disabling an OIDC provider revokes every session carrying that provider ID
- OIDC sessions remain bound to the provider's organisation and cannot use
  account-level organisation switching
- self-demotion/self-revocation and removal of the final active platform
  administrator are blocked
- email-OTP sessions may deliberately switch among active memberships by
  rotating credentials and revoking the prior session
- suspected refresh compromise: revoke the affected session rows
- signing-key compromise: replace `JWT_KEYRING`, then revoke affected sessions

The legacy bootstrap-token login returns HTTP 410 and is not an authentication
path.
