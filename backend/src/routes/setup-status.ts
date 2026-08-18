import type { FastifyInstance } from "fastify"
import IORedis from "ioredis"
import { ListObjectsV2Command } from "@aws-sdk/client-s3"
import { config } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import { s3, isStorageConfigured } from "../lib/storage.js"
import { SYSTEM_ACCOUNT_EMAIL_PATTERN } from "../lib/system-account.js"
import { encryptionKeySource } from "../lib/instance-cipher.js"
import {
  PROVIDER_KEY_ENV,
  PROVIDER_KEY_IDS,
  PROVIDER_KEY_META,
  resolveProviderKey,
  type ProviderKeyId,
  type ProviderKeyMeta,
} from "../lib/provider-keys-runtime.js"

/**
 * GET /v1/setup/status — self-host install health screen backend.
 *
 * Registered ONLY when !isCloud() (gated in app.ts) and whitelisted as public
 * in middleware/auth.ts: a broken Supabase config breaks login itself, so the
 * one screen that diagnoses it must not require a session.
 *
 * Returns presence/reachability booleans ONLY — never env values, never raw
 * error messages (those are logged server-side). Every probe runs in parallel
 * with a hard timeout so the endpoint answers fast even when a dependency is
 * a black hole.
 */

const PROBE_TIMEOUT_MS = 1500

interface CheckResult {
  readonly ok: boolean
  readonly status: string
  readonly latencyMs: number | null
  readonly hint?: string
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("probe_timeout")), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

/** Postgres/PostgREST codes meaning "reachable, but our tables don't exist". */
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"])

async function probeDatabase(): Promise<CheckResult> {
  const started = Date.now()
  try {
    const { error } = await withTimeout(
      // Cheapest real query against a table every migration set creates.
      Promise.resolve(supabase.from("profiles").select("id").limit(1)),
      PROBE_TIMEOUT_MS,
    )
    const latencyMs = Date.now() - started
    if (!error) return { ok: true, status: "ok", latencyMs }
    if (MISSING_TABLE_CODES.has(error.code ?? "")) {
      return {
        ok: false,
        status: "migrations_missing",
        latencyMs,
        hint: "Database reachable but tables are missing - run the SQL migrations in supabase/migrations/",
      }
    }
    console.error("[setup-status] database probe failed:", error.code, error.message)
    return {
      ok: false,
      status: "error",
      latencyMs,
      hint: "Cannot query Supabase - check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    }
  } catch (err) {
    console.error("[setup-status] database probe threw:", err)
    return {
      ok: false,
      status: "error",
      latencyMs: null,
      hint: "Cannot reach Supabase - check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    }
  }
}

async function probeRedis(): Promise<CheckResult> {
  const started = Date.now()
  // Throwaway client: never reuse the BullMQ connections for a health probe,
  // and never let ioredis retry forever - one shot, tight timeout, cleanup.
  const client = new IORedis(config.REDIS_URL, {
    lazyConnect: true,
    connectTimeout: PROBE_TIMEOUT_MS,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  })
  try {
    await withTimeout(
      client.connect().then(() => client.ping()),
      PROBE_TIMEOUT_MS,
    )
    return { ok: true, status: "ok", latencyMs: Date.now() - started }
  } catch (err) {
    console.error("[setup-status] redis probe failed:", err)
    return {
      ok: false,
      status: "error",
      latencyMs: null,
      hint: "Cannot reach Redis - check REDIS_URL (job queues and workers depend on it)",
    }
  } finally {
    client.disconnect()
  }
}

async function probeStorage(): Promise<CheckResult> {
  if (!isStorageConfigured()) {
    return {
      ok: false,
      status: "not_configured",
      latencyMs: null,
      hint: "No storage configured - generated media cannot be saved. The community compose bundles MinIO (defaults work out of the box); for cloud storage set R2_ACCOUNT_ID (or R2_ENDPOINT), R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME and R2_PUBLIC_URL",
    }
  }
  const started = Date.now()
  try {
    await withTimeout(
      s3.send(new ListObjectsV2Command({ Bucket: config.R2_BUCKET_NAME, MaxKeys: 1 })),
      PROBE_TIMEOUT_MS,
    )
    return { ok: true, status: "ok", latencyMs: Date.now() - started }
  } catch (err) {
    console.error("[setup-status] storage probe failed:", err)
    return {
      ok: false,
      status: "error",
      latencyMs: null,
      hint: "Storage configured but unreachable - check the R2 credentials and bucket name",
    }
  }
}

export async function setupStatusRoutes(app: FastifyInstance) {
  app.get("/v1/setup/status", async (_req, reply) => {
    const [database, redis, storage] = await Promise.all([
      probeDatabase(),
      probeRedis(),
      probeStorage(),
    ])

    // nodaro.ai is a provider like the other six — the tile is lit by EITHER
    // the OAuth connection (Connect nodaro.ai) or NODARO_API_KEY. `keys` is
    // the single list the setup screen renders and counts, so nodaro.ai
    // belongs in it, first: it is the one that needs no third-party account.
    // One list, one resolver: every tile comes from PROVIDER_KEY_IDS and its
    // state from resolveProviderKey() — env first, then the operator-supplied
    // key stored via /setup (lib/provider-keys-runtime.ts). nodaro.ai adds
    // the OAuth connection as a third way to be "set".
    const { getNodaroCredential } = await import("../lib/nodaro-connect.js")
    const nodaroCredential = await getNodaroCredential().catch(() => null)
    const providerKeys = Object.fromEntries(
      PROVIDER_KEY_IDS.map((id) => [id, id === "nodaro" ? nodaroCredential !== null : resolveProviderKey(id) !== null]),
    ) as Record<ProviderKeyId, boolean>
    // Where each set key comes from: "env" | "app" (pasted on /setup) |
    // "oauth" (nodaro.ai only). Booleans/enums only — never a value.
    const providerSources = Object.fromEntries(
      PROVIDER_KEY_IDS.map((id) => [id, id === "nodaro" ? (nodaroCredential?.source ?? null) : (resolveProviderKey(id)?.source ?? null)]),
    ) as Record<ProviderKeyId, "env" | "app" | "oauth" | null>
    // Labels + coverage the frontend renders from, so a provider added to the
    // runtime list shows up on the screen with no frontend change.
    const providerMeta = Object.fromEntries(
      PROVIDER_KEY_IDS.map((id) => [id, { ...PROVIDER_KEY_META[id], env: PROVIDER_KEY_ENV[id] }]),
    ) as Record<ProviderKeyId, ProviderKeyMeta & { env: string }>
    const nodaroConnected = providerKeys.nodaro
    const anyMediaProvider = providerKeys.kie || providerKeys.replicate || nodaroConnected
    const providers = {
      ok: anyMediaProvider,
      // Kept for older frontends; `keys.nodaro` is the tile.
      nodaroCloud: nodaroConnected,
      // How nodaro.ai is authenticated, so the tile can say CONNECTED vs KEY.
      nodaroSource: nodaroCredential?.source ?? null,
      // CAPABILITY, not billing: whether any LLM lane is reachable — a KIE
      // key (the primary proxy for every LLM model), a direct Anthropic or
      // Google key, or the nodaro.ai connection (the LLM routes proxy
      // through it). The frontend gates the "Generate with AI" prompt-helper
      // entry points on this (#752) instead of hasCredits(), which answers
      // "do we charge for this", never "can this install do this". Derived
      // from the same live key resolution as `keys` (env + pasted keys).
      llm: providerKeys.kie || providerKeys.anthropic || providerKeys.gemini || nodaroConnected,
      keys: providerKeys,
      sources: providerSources,
      meta: providerMeta,
      ...(anyMediaProvider
        ? {}
        : {
            hint: "No media provider configured - connect nodaro.ai from Integrations (OAuth sign-in, no API keys to manage), set NODARO_API_KEY, or add KIE_API_KEY (kie.ai) / REPLICATE_API_TOKEN (replicate.com)",
          }),
    }

    // First-boot detection: a fresh install has no operator account yet —
    // the frontend lands on /setup and leads with "create your account"
    // instead of a sign-in form (founder feedback 2026-08-13). Booleans
    // only, same public-surface stance as the rest of this route.
    // Server-owned accounts (the tutorial-seed owner, minted on first boot)
    // must not count — a pristine install would otherwise report its login
    // as already created (2026-08-16, community stack).
    let hasUsers = false
    try {
      const { count } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .not("email", "like", SYSTEM_ACCOUNT_EMAIL_PATTERN)
      hasUsers = (count ?? 0) > 0
    } catch {
      // Unreachable DB already surfaces via the database check.
    }

    // The instance encryption key is what makes pasted provider keys (and
    // social tokens) storable. Presence + provenance only — never the key.
    // `generated` = start.sh minted it on first boot and keeps it in the
    // app-data volume (community compose only); `env` = the operator set it.
    const keyVar = encryptionKeySource()
    const encryption = keyVar
      ? {
          ok: true,
          status: "ok",
          source: process.env.NODARO_ENCRYPTION_KEY_SOURCE === "generated" ? "generated" : "env",
          envVar: keyVar,
        }
      : {
          ok: false,
          status: "missing",
          hint: "No instance encryption key — provider keys pasted here and social connections cannot be stored. Set NODARO_ENCRYPTION_KEY (64-char hex, `openssl rand -hex 32`); the community compose stack generates one on first boot.",
        }

    reply.header("Cache-Control", "no-store")
    return reply.send({
      edition: config.EDITION,
      timestamp: new Date().toISOString(),
      hasUsers,
      checks: { database, redis, storage, providers, encryption },
    })
  })
}
