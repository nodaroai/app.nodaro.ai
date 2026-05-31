import "dotenv/config"
import { z } from "zod"

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  R2_ACCOUNT_ID: z.string().default(""),
  R2_ACCESS_KEY_ID: z.string().default(""),
  R2_SECRET_ACCESS_KEY: z.string().default(""),
  R2_BUCKET_NAME: z.string().default("scenenode-assets"),
  R2_PUBLIC_URL: z.string().default(""),
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
  KIE_API_KEY: z.string().default(""),
  ANTHROPIC_API_KEY: z.string().default(""),
  ELEVENLABS_API_KEY: z.string().default(""),
  APIFY_API_TOKEN: z.string().default(""),
  PORT: z.coerce.number().default(8000),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  EDITION: z.enum(["community", "business", "cloud"]).default("community"),
  /** Comma-separated list of allowed CORS origins (e.g. "https://app.nodaro.ai,http://localhost:3000") */
  CORS_ORIGIN: z.string().default(""),
  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  /** Number of parallel browser tabs for Remotion renders. null = Remotion default (50% CPU cores) */
  REMOTION_CONCURRENCY: z.coerce.number().int().min(1).max(32).nullable().default(null),
  /** KIE.ai account unique ID for credit audit API (constant per account) */
  KIE_UNIQUE_ID: z.string().default(""),
  /** 64-char hex string (32 bytes) for AES-256-GCM encryption of social media OAuth tokens */
  SOCIAL_ENCRYPTION_KEY: z.string().default(""),
  /** Base URL for OAuth redirects (e.g. https://app.nodaro.ai or http://localhost:8000) */
  PUBLIC_URL: z.string().default(""),
  /** Email of the platform owner whose super_admin role is protected from changes by other admins. Empty = no protected owner (self-host default). */
  PLATFORM_OWNER_EMAIL: z.string().default(""),
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
  MCP_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  /** Dynamic Client Registration mode. "allowlist" = only allow known MCP clients (Claude/Cursor/etc); "open" = allow any client_name; "off" = DCR disabled entirely (returns 403). */
  MCP_DYNAMIC_REGISTRATION: z.enum(["allowlist", "open", "off"]).default("allowlist"),
  /** Comma-separated allowlist of MCP client_name values that may register dynamically. Only used when MCP_DYNAMIC_REGISTRATION="allowlist". */
  MCP_DCR_ALLOWLIST: z.string().default("Claude,Claude Code,Cursor,Cline,Continue,Goose,ChatGPT,OpenAI,Lovable,Gemini,Gemini CLI,Codex,MCP Inspector,mcp-inspector"),
})

export type Edition = "community" | "business" | "cloud"

/** community = open source, no credits, no admin */
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
