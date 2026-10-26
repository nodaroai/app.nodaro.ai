import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { config } from "../../lib/config.js"
import { requireAdmin } from "../middleware/require-admin.js"

/**
 * Hosted deployments — the billing status of the dedicated deployments Nodaro
 * runs for customers (each with its own database and its own deployment
 * payer), read-only, for this instance's admins.
 *
 * Each deployment is reached over its OWN billing API, `GET
 * /v1/deployment-billing/balance`, with a billing integration key its billing
 * account minted. ONLY a read-only key (`ndr_bill_ro_…`) is accepted here: a
 * full key could change the customer's allowances, and this environment is not
 * where that power belongs. An entry with any other key is refused at parse
 * time and shown as misconfigured — never called.
 *
 * The key never leaves the server: the route answers the deployment's name,
 * its host and what its balance route answered, nothing else.
 */

const READ_ONLY_KEY_PREFIX = "ndr_bill_ro_"
const FETCH_TIMEOUT_MS = 10_000
const CACHE_TTL_MS = 60_000

const EntrySchema = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.string().url(),
  key: z.string().min(1),
})

export interface HostedDeploymentConfig {
  name: string
  /** Bare origin, no trailing slash. */
  origin: string
  key: string
}

export type ParsedHostedDeployments = {
  deployments: HostedDeploymentConfig[]
  /** Entries refused at parse time — by position and, when readable, name. */
  invalid: Array<{ index: number; name: string | null; reason: "invalid_entry" | "key_not_read_only" | "url_not_https" }>
}

/** Parse `HOSTED_DEPLOYMENTS`. Malformed JSON answers no deployments (logged). */
export function parseHostedDeployments(raw: string | undefined): ParsedHostedDeployments {
  const out: ParsedHostedDeployments = { deployments: [], invalid: [] }
  if (!raw || raw.trim() === "") return out
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.error("[hosted-deployments] HOSTED_DEPLOYMENTS is not valid JSON — no deployments listed")
    return out
  }
  if (!Array.isArray(parsed)) {
    console.error("[hosted-deployments] HOSTED_DEPLOYMENTS must be a JSON array — no deployments listed")
    return out
  }
  parsed.forEach((item, index) => {
    const r = EntrySchema.safeParse(item)
    const name = r.success ? r.data.name : typeof (item as { name?: unknown })?.name === "string" ? (item as { name: string }).name : null
    if (!r.success) {
      out.invalid.push({ index, name, reason: "invalid_entry" })
      return
    }
    if (!r.data.key.startsWith(READ_ONLY_KEY_PREFIX)) {
      out.invalid.push({ index, name, reason: "key_not_read_only" })
      return
    }
    const u = new URL(r.data.url)
    if (u.protocol !== "https:") {
      out.invalid.push({ index, name, reason: "url_not_https" })
      return
    }
    out.deployments.push({ name: r.data.name, origin: u.origin, key: r.data.key })
  })
  return out
}

export interface HostedDeploymentStatus {
  name: string
  host: string
  ok: boolean
  /** The deployment's own `GET /v1/deployment-billing/balance` data, verbatim. */
  balance?: unknown
  /** HTTP status when the deployment answered with an error. */
  status?: number
  error?: "unreachable" | "rejected" | "bad_response"
}

async function fetchStatus(d: HostedDeploymentConfig): Promise<HostedDeploymentStatus> {
  const host = new URL(d.origin).host
  try {
    const res = await fetch(`${d.origin}/v1/deployment-billing/balance`, {
      headers: { Authorization: `Bearer ${d.key}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return { name: d.name, host, ok: false, status: res.status, error: "rejected" }
    const body = (await res.json()) as { data?: unknown }
    if (!body || typeof body !== "object" || body.data === undefined) {
      return { name: d.name, host, ok: false, error: "bad_response" }
    }
    return { name: d.name, host, ok: true, balance: body.data }
  } catch (err) {
    // The message only — never the request, which carries the key.
    console.error(`[hosted-deployments] ${d.name} (${host}) unreachable:`, (err as Error).message)
    return { name: d.name, host, ok: false, error: "unreachable" }
  }
}

let cache: { at: number; data: HostedDeploymentStatus[] } | null = null

/** @internal tests */
export function __resetHostedDeploymentsCacheForTests(): void {
  cache = null
}

export async function adminHostedDeploymentsRoutes(app: FastifyInstance) {
  /**
   * GET /v1/admin/hosted-deployments
   * Each configured deployment's billing status (cached 60 s; `?refresh=1`
   * bypasses it), plus the entries refused at parse time.
   */
  app.get("/v1/admin/hosted-deployments", { preHandler: requireAdmin }, async (request) => {
    const { deployments, invalid } = parseHostedDeployments(config.HOSTED_DEPLOYMENTS)
    const refresh = (request.query as Record<string, string | undefined>).refresh === "1"
    if (refresh || !cache || Date.now() - cache.at > CACHE_TTL_MS) {
      cache = { at: Date.now(), data: await Promise.all(deployments.map(fetchStatus)) }
    }
    return {
      data: cache.data,
      invalid,
      checkedAt: new Date(cache.at).toISOString(),
    }
  })
}
