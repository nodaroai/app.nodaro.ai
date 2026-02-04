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
  EDITION: z.enum(["self-hosted", "cloud"]).default("self-hosted"),
})

export type Edition = "self-hosted" | "cloud"

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
