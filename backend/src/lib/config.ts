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
  PORT: z.coerce.number().default(8000),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  EDITION: z.enum(["community", "business", "cloud"]).default("community"),
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
