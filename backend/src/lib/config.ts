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
  REPLICATE_API_TOKEN: z.string().default(""),
  KIE_API_KEY: z.string().default(""),
  ANTHROPIC_API_KEY: z.string().default(""),
  ELEVENLABS_API_KEY: z.string().default(""),
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
  /** Max nodes a single workflow execution can run concurrently (default 3). Prevents one large workflow from starving other users. */
  MAX_CONCURRENT_NODES_PER_EXECUTION: z.coerce.number().int().min(1).max(20).default(6),
  /** BullMQ concurrency for the video worker (default 50). Safe to set high — work is I/O-bound (external API calls). */
  VIDEO_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(200).default(50),
  /** BullMQ concurrency for the orchestrator worker (default 20). I/O-bound — just DB polling and job dispatching. */
  ORCHESTRATOR_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(20),
  /** BullMQ concurrency for the render worker (default 2). CPU-bound — each render spawns headless Chrome. */
  RENDER_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
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

export const config = loadConfig()
export type Config = z.infer<typeof envSchema>
