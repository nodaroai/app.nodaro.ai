import "dotenv/config"
import { z } from "zod"
import {
  PROVIDER_KEY_ENV,
  PROVIDER_KEY_IDS,
  resolveProviderKey,
  setEnvProviderKey,
  setEnvProviderKeys,
  type ProviderKeyId,
} from "./provider-keys-runtime.js"

/**
 * An overridable service base URL: defaults to the vendor's own host, and
 * trailing slashes are stripped so an operator pasting `https://proxy/kie/`
 * cannot produce `//api/v1/...` at every call site. Every consumer builds
 * `${BASE}/path`.
 */
export function baseUrl(fallback: string) {
  return z
    .string()
    .default(fallback)
    .transform((v) => (v.trim() || fallback).replace(/\/+$/, ""))
    .refine((v) => /^https?:\/\/[^/?#\s]+/.test(v), {
      message: "must be an absolute http(s) URL, e.g. https://proxy.example.com",
    })
}

export const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  R2_ACCOUNT_ID: z.string().default(""),
  R2_ACCESS_KEY_ID: z.string().default(""),
  R2_SECRET_ACCESS_KEY: z.string().default(""),
  R2_BUCKET_NAME: z.string().default("scenenode-assets"),
  R2_PUBLIC_URL: z.string().default(""),
  /**
   * Custom S3-compatible storage endpoint (e.g. http://minio:9000 for the
   * MinIO service bundled in docker-compose.community.yml, or any other
   * S3-compatible server). Empty = Cloudflare R2, derived from R2_ACCOUNT_ID
   * (the pre-existing behavior). When set, R2_ACCOUNT_ID is not needed.
   */
  R2_ENDPOINT: z.string().default(""),
  /**
   * Use path-style S3 addressing (https://host/bucket/key instead of
   * https://bucket.host/key). Required by MinIO and most self-hosted
   * S3-compatible servers; leave false for Cloudflare R2 / AWS S3.
   * Strict parsing: only "true" or "1" enable it (same rationale as
   * MCP_ENABLED — z.coerce.boolean() would treat "false" as true).
   */
  R2_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  /**
   * S3 region. "auto" is Cloudflare R2's own value and MinIO ignores the
   * field entirely, which is why it was hardcoded — but a Supabase-local
   * stack wants "local" and DO Spaces / AWS want a real region ("nyc3",
   * "us-east-1", …) and reject "auto" outright. Default unchanged.
   *
   * The trim-to-default matters: zod `.default()` fires only on an UNDEFINED
   * value, and `.env.example` ships this key blank, so `cp .env.example .env`
   * would otherwise hand the S3 client `region: ""` — which throws "Region is
   * missing" from the constructor at import time, taking the whole API down
   * with a message that never names this variable.
   */
  R2_REGION: z
    .string()
    .default("auto")
    .transform((v) => v.trim() || "auto"),
  /**
   * Canned ACL to stamp on every object this app writes. EMPTY BY DEFAULT,
   * meaning the header is omitted entirely — which is what Cloud sends to R2
   * today, and what self-host needs too, because public read is already
   * solved there by the boot-time bucket policy (see storage.ts
   * buildPublicReadPolicy). A constant "public-read" would change Cloud
   * behaviour, so this is opt-in.
   *
   * It exists for the third shape: S3-compatible stores that refuse
   * PutBucketPolicy to a bucket-scoped key — DigitalOcean Spaces is the
   * common one — where per-object ACLs are the only way to make media
   * readable. Validated here rather than at the store, so a typo is a boot
   * error instead of a 400 on every upload.
   */
  STORAGE_OBJECT_ACL: z
    .enum([
      "",
      "private",
      "public-read",
      "public-read-write",
      "authenticated-read",
      "aws-exec-read",
      "bucket-owner-read",
      "bucket-owner-full-control",
    ])
    .default(""),
  /**
   * Extra hostname to allow in the /v1/download + /v1/image-proxy origin
   * allowlist, in addition to the origin derived from R2_PUBLIC_URL. Use when
   * assets are served from a different host than R2_PUBLIC_URL (e.g. a raw
   * `pub-<id>.r2.dev` bucket host alongside a custom CDN domain). Empty by
   * default — self-hosters typically only need R2_PUBLIC_URL.
   */
  R2_PUBLIC_FALLBACK_DOMAIN: z.string().default(""),
  REPLICATE_API_TOKEN: z.string().default(""),
  /** Replicate Standard Webhooks signing secret. Required in Cloud edition for character LoRA training callbacks. */
  REPLICATE_WEBHOOK_SECRET: z.string().default(""),
  /**
   * Operational kill-switch for the character LoRA inference path. When
   * "false" (or "0"), the orchestrator + single-node Run skip the swap to
   * `flux-lora-character` and trained-character generations fall back to
   * standard reference-image injection. Training routes still work; only
   * the inference routing is gated. Default: enabled.
   */
  CHARACTER_LORA_ROUTING_ENABLED: z
    .string()
    .default("true")
    .transform((s) => s.toLowerCase() !== "false" && s !== "0"),
  /** fal.ai API key (https://fal.ai/dashboard/keys). Empty by default — fal provider is gated behind `falEnabled()`. */
  FAL_KEY: z.string().default(""),
  /** nodaro.ai as a provider like the others: a personal API token from
   *  app.nodaro.ai (Settings -> API), billed to that account. Alternative to
   *  the OAuth "Connect nodaro.ai" flow, which stays the per-instance-accounted
   *  path and wins when both exist. See lib/nodaro-connect.ts. */
  NODARO_API_KEY: z.string().default(""),
  KIE_API_KEY: z.string().default(""),
  /**
   * Base URL for the KIE.ai API. Override to route provider traffic through an
   * egress proxy that holds the real key — key custody, audit logging, or
   * regional routing, all of which a self-hoster may need and none of which
   * the app should know about. Default = KIE direct (unchanged behaviour).
   *
   * CONSEQUENCE, easy to miss: `lib/llm-client.ts` imports the same
   * `KIE_API_BASE` const, so this ALSO reroutes the KIE-fronted LLM lanes
   * (Claude, Gemini, the OpenAI-compatible ones) — not just media generation.
   * A proxy set here must speak both the /api/v1 task API and the
   * /claude/v1/messages + /<family>/v1/chat/completions LLM paths.
   */
  KIE_API_BASE_URL: baseUrl("https://api.kie.ai"),
  ANTHROPIC_API_KEY: z.string().default(""),
  /** Google Gemini API key (https://aistudio.google.com/apikey). Enables the
   *  direct-Google lane for models declaring `directGeminiModel`; empty leaves
   *  every Gemini model on KIE. Deliberately NOT named `GOOGLE_API_KEY` — the
   *  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` pair is OAuth login, unrelated. */
  GEMINI_API_KEY: z.string().default(""),
  ELEVENLABS_API_KEY: z.string().default(""),
  /**
   * Base URL for the ElevenLabs API. Same egress-proxy rationale as
   * KIE_API_BASE_URL; default = ElevenLabs direct (unchanged behaviour).
   */
  ELEVENLABS_BASE_URL: baseUrl("https://api.elevenlabs.io"),
  HEYGEN_API_KEY: z.string().default(""),
  /**
   * How often the shared (Redis) HeyGen public catalog — ≈7,000 preset
   * avatar looks + ≈2,500 voices — is refetched from HeyGen. The account's own
   * (private) looks are fetched separately every couple of minutes, so this
   * only bounds how quickly NEW PRESETS appear. Fractional hours are fine.
   */
  HEYGEN_CATALOG_REFRESH_HOURS: z.coerce.number().positive().max(24 * 30).default(24),
  BEEBLE_API_KEY: z.string().default(""),
  APIFY_API_TOKEN: z.string().default(""),
  /** Loops (loops.so) API key for the Cloud-only marketing-consent -> contact
   *  sync (ee/lib/loops-client.ts). Empty on community/self-host, where the
   *  sync no-ops. Not a provider key; not in PROVIDER_KEY_IDS. */
  LOOPS_API_KEY: z.string().default(""),
  PORT: z.coerce.number().default(8000),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  EDITION: z.enum(["community", "business", "cloud"]).default("community"),
  /**
   * Deployment surface profile (B1) — inline JSON or "@/path/to/profile.json".
   * Documents the env surface here for typing/validation; the resolved profile
   * is read fresh from process.env by runtimeSurfaceProfile() in
   * surface-profile.ts (config snapshots env at import, which the memoized
   * getter's test hook must be able to bypass). Business+ only — see d2.
   */
  NODARO_SURFACE_PROFILE: z.string().optional(),
  // External SSO (B6). Inline JSON or "@/path/to/file.json" describing the
  // trusted IdP list. Unset ⇒ no SSO (inert). Parsed + validated in
  // lib/sso-providers.ts (fail-loud: a typo'd secret-bearing entry must NOT
  // silently drop — unlike the surface profile's element-wise degrade).
  EXTERNAL_SSO_PROVIDERS: z.string().default(""),
  // Global gate: may a verified-email assertion link to a PRE-EXISTING account
  // that is not already SSO-linked? Default false (takeover-safe). ANDed with
  // the per-assertion email_verified claim in sso-linking.ts.
  EXTERNAL_SSO_LINK_EXISTING: z.string().default("false"),
  /**
   * Comma-separated list of directories holding operator-supplied tutorial
   * packs. Each directory: a manifest.json (name, categories, optional
   * locale/version/forbiddenPromptTerms) plus one *.json per tutorial (the
   * TutorialTemplateDoc shape). Read fresh from process.env by
   * loadTutorialPacks() (config snapshots env at import; the loader needs a
   * test seam) — documented here for the env surface. Business/self-host only:
   * Cloud never seeds. A malformed pack is skipped whole and logged; the base
   * tutorials always seed. Unset/blank = base tutorials only. Restart to apply.
   */
  NODARO_TUTORIAL_PACKS: z.string().default(""),
  /** Comma-separated list of allowed CORS origins (e.g. "https://app.nodaro.ai,http://localhost:3000") */
  CORS_ORIGIN: z.string().default(""),
  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  /** Number of parallel browser tabs for Remotion renders. null = Remotion default (50% CPU cores) */
  REMOTION_CONCURRENCY: z.coerce.number().int().min(1).max(32).nullable().default(null),
  /** KIE.ai account unique ID for credit audit API (constant per account) */
  KIE_UNIQUE_ID: z.string().default(""),
  /** 64-char hex string (32 bytes): the instance encryption key for every
   *  secret the server stores for itself (social OAuth tokens, operator-
   *  supplied provider keys) — see lib/instance-cipher.ts. The community
   *  compose stack generates it once on first boot; managed deployments must
   *  set it. SOCIAL_ENCRYPTION_KEY below is the older name, still accepted. */
  NODARO_ENCRYPTION_KEY: z.string().default(""),
  /** Older name for NODARO_ENCRYPTION_KEY — kept so no existing install re-encrypts. */
  SOCIAL_ENCRYPTION_KEY: z.string().default(""),
  /** Base URL for OAuth redirects (e.g. https://app.nodaro.ai or http://localhost:8000) */
  PUBLIC_URL: z.string().default(""),
  /** Public base URL of the MCP host when it differs from PUBLIC_URL (on Nodaro Cloud: https://mcp.nodaro.ai, a subdomain host-routed to the same backend). Drives the RFC 9728 protected-resource identity and MCP upload-proxy links. Self-hosters serving MCP on their main host should set this to the same value as PUBLIC_URL; empty = the Nodaro Cloud default. */
  MCP_PUBLIC_URL: z.string().default(""),
  /** Email of the platform owner whose super_admin role is protected from changes by other admins. Empty = no protected owner (self-host default). */
  PLATFORM_OWNER_EMAIL: z.string().default(""),
  /**
   * Comma-separated emails allowed to reach the MONEY admin routes (credit
   * grants, tier/role changes, model pricing, markup settings) on a deployment
   * that has a `billing.payerAccount` — i.e. one whose identity provider the
   * CUSTOMER runs, where `profiles.role` is downstream of the customer and
   * cannot protect spend. ANDed with a non-federated account in
   * `ee/middleware/require-platform-operator.ts`. Empty falls back to
   * PLATFORM_OWNER_EMAIL; empty with no owner set closes those routes to
   * everyone (fail-closed). INERT on a deployment with no payer configured.
   */
  PLATFORM_OPERATOR_EMAILS: z.string().default(""),
  /**
   * Hours a job may sit in `pending_review` (held by a registered job policy
   * for human review) before the platform AUTO-REJECTS it: the reservation is
   * refunded, the withheld output is deleted, and the decision is recorded
   * with `policy_id = "platform"`, `reason = "hold-expired"`.
   *
   * Empty (the default) DISABLES the sweep entirely — `sweepExpiredHolds` does
   * nothing at all, so a deployment with no job policy is byte-identical. A
   * held row is exempt from every other liveness sweep by construction (its
   * status is outside `pending|processing`), so without a TTL an abandoned
   * review strands the user's credits forever. This is the ONE sweep permitted
   * to write a `pending_review` row.
   *
   * Auto-APPROVE is deliberately not an option: it would publish exactly the
   * output a human declined to look at. Recommended value on a moderated
   * deployment: 72. Kept as a string (not z.coerce.number) so "unset" and
   * "0 hours" stay distinguishable — see lib/reconcile/hold-expiry.ts.
   */
  JOB_HOLD_TTL_HOURS: z.string().default(""),
  /** Max nodes a single workflow execution can run concurrently (default 3). Prevents one large workflow from starving other users. */
  MAX_CONCURRENT_NODES_PER_EXECUTION: z.coerce.number().int().min(1).max(20).default(6),
  /** BullMQ concurrency for the video worker (default 50). Safe to set high — work is I/O-bound (external API calls). */
  VIDEO_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(200).default(50),
  /** BullMQ concurrency for the orchestrator worker (default 20). I/O-bound — just DB polling and job dispatching. */
  ORCHESTRATOR_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(20),
  /** BullMQ concurrency for the render worker (default 2). CPU-bound — each render spawns headless Chrome. */
  RENDER_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  /** Max concurrent ffmpeg child processes (default 4). FFmpeg is CPU-bound; too many parallel processes thrash the box. Applies across every ffmpeg node (resize, combine, social-format, etc.). */
  FFMPEG_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  /** Shared secret for authenticating internal orchestrator → API calls (replaces the unreliable `req.ip === 127.0.0.1` check). MUST be set to ≥32 random bytes hex. In Docker, start.sh auto-generates one if unset so all sibling processes inherit the same value. */
  INTERNAL_ORCHESTRATOR_SECRET: z.string().min(32, "INTERNAL_ORCHESTRATOR_SECRET must be at least 32 characters (use `openssl rand -hex 32`)"),
  /** Master feature flag for the MCP server. Default false; set to true once v1.2 ships.
   *  Strict parsing: only "true" or "1" are truthy; anything else (incl. "false", "0", "", or unset) is false.
   *  z.coerce.boolean() would be wrong here — Boolean("false") === true, so MCP_ENABLED=false would silently enable. */
  /** Auto-recharge kill switch (design 2026-07-05 §5.2 step 5). Default OFF;
   *  guards the trigger+charge path only — webhook provisioning stays on so
   *  in-flight PaymentIntents settle. Strict parsing like MCP_ENABLED. */
  AUTO_RECHARGE_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  /** Multi-tenant organizations rollout gate (cloud only — see hasOrganizations()).
   *  Default OFF so the feature ships dark and is flipped on deliberately at
   *  launch; the migrations run everywhere regardless. Strict parsing like
   *  MCP_ENABLED. */
  ORGS_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  /** Community cloud-connect (Phase 4a). Gates the community_instance DCR
   *  branch and the connected-instances surface. Default OFF — also guards
   *  the window before migration 312 reaches the shared DB. Strict parse. */
  COMMUNITY_CONNECT_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  /** Spend-surface enforcement kill switch (decision log D1, 2026-08-12):
   *  when on, pay-as-you-go accounts (stored free + lifetime top-ups > 0) are
   *  blocked from SPENDING via first-party consumer surfaces (source web /
   *  extension on a browser-session JWT) with 403 subscription_required.
   *  Buying credits and all programmatic surfaces stay open. Default OFF;
   *  strict parsing like MCP_ENABLED. */
  PAYG_WEB_BLOCK_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  /** Comma-separated user ids exempt from the payg web block (grandfathered
   *  accounts that purchased before the surface model changed). */
  PAYG_WEB_BLOCK_EXEMPT_USER_IDS: z.string().default(""),
  MCP_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  /** Kill switch for the in-app Workflow Copilot (cloud). Unset/false = the
   *  routes answer 503 feature_disabled. Strict parsing like MCP_ENABLED; the
   *  admin `copilot_enabled` app setting can additionally pause it at runtime. */
  COPILOT_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  /** Dynamic Client Registration mode. "allowlist" = only allow known MCP clients (Claude/Cursor/etc); "open" = allow any client_name; "off" = DCR disabled entirely (returns 403). */
  MCP_DYNAMIC_REGISTRATION: z.enum(["allowlist", "open", "off"]).default("allowlist"),
  /** Comma-separated allowlist of MCP client_name values that may register dynamically. Only used when MCP_DYNAMIC_REGISTRATION="allowlist". */
  MCP_DCR_ALLOWLIST: z.string().default("Claude,Claude Code,Cursor,Cline,Continue,Goose,ChatGPT,OpenAI,Lovable,Gemini,Gemini CLI,Codex,MCP Inspector,mcp-inspector"),
})

export type Edition = "community" | "business" | "cloud"

/** community = source-available self-host, no credits, no admin */
export function isCommunity(): boolean {
  return config.EDITION === "community"
}

/** business = self-hosted with admin, user mgmt, no credits */
export function isBusiness(): boolean {
  return config.EDITION === "business"
}

/** cloud = full SaaS with credits, billing, markup */
export function isCloud(): boolean {
  return config.EDITION === "cloud"
}

/** business + cloud have admin panel and user management */
export function hasAdmin(): boolean {
  return config.EDITION === "business" || config.EDITION === "cloud"
}

/** only cloud edition has credit system */
export function hasCredits(): boolean {
  return config.EDITION === "cloud"
}

/** business + cloud are multi-user (community is single-user → sharing is inert) */
export function isMultiUser(): boolean {
  return config.EDITION === "business" || config.EDITION === "cloud"
}

/**
 * Organizations / workspaces / memberships — cloud edition AND the runtime
 * ORGS_ENABLED flag. An edition test alone would light the feature up for
 * every production user the moment the code merges; the flag is the launch
 * lever. Every org route registers behind this, every org UI element hides
 * behind its frontend twin.
 */
export function hasOrganizations(): boolean {
  return config.EDITION === "cloud" && config.ORGS_ENABLED
}

function loadConfig() {
  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    const missing = result.error.issues.map((i) => i.path.join(".")).join(", ")
    throw new Error(`Missing or invalid env vars: ${missing}`)
  }
  return result.data
}

const baseConfig = loadConfig()

export const config = {
  ...baseConfig,
  /** Parsed `string[]` form of `MCP_DCR_ALLOWLIST` (split on commas, trimmed, empties dropped). */
  MCP_DCR_ALLOWLIST_PARSED: baseConfig.MCP_DCR_ALLOWLIST.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
}
export type Config = z.infer<typeof envSchema> & { MCP_DCR_ALLOWLIST_PARSED: string[] }

// ---------------------------------------------------------------------------
// Provider keys are LIVE.
//
// `config.KIE_API_KEY` & co (the seven ids in lib/provider-keys-runtime.ts)
// are getters, not the parsed strings: they resolve through
// resolveProviderKey(), i.e. the environment value first, and — where env is
// empty — the operator-supplied key stored encrypted in provider_credentials
// (loaded at boot and refreshed on write / TTL by lib/provider-credentials.ts).
// That is what lets a self-hoster paste a key on /setup and Run without a
// restart, while the ~120 existing read sites stay untouched — every one of
// them reads per call (KIE, ElevenLabs, fal, the LLM lanes) or through a
// token-checking factory (Replicate, Gemini), see tools/check-provider-key-captures.mjs.
//
// Setters exist because tests assign `config.ELEVENLABS_API_KEY = "…"`; they
// write the env layer, which keeps precedence intact. Tests that vi.mock this
// module with a plain object never see any of this — that is deliberate: do
// not "simplify" the getters back into fields.
// ---------------------------------------------------------------------------
setEnvProviderKeys(
  Object.fromEntries(
    PROVIDER_KEY_IDS.map((id) => [id, (baseConfig as Record<string, unknown>)[PROVIDER_KEY_ENV[id]] as string | undefined]),
  ) as Partial<Record<ProviderKeyId, string>>,
)
for (const id of PROVIDER_KEY_IDS) {
  const envVar = PROVIDER_KEY_ENV[id]
  // Only keys the schema actually declares (keeps this safe if a provider is
  // added to the runtime list before its env var reaches the schema).
  if (!(envVar in baseConfig)) continue
  Object.defineProperty(config, envVar, {
    enumerable: true,
    configurable: false,
    get: () => resolveProviderKey(id)?.value ?? "",
    set: (value: string) => setEnvProviderKey(id, value),
  })
}
