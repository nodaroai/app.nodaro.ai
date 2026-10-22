// @reads-none holds an in-process readiness flag; its probe queries the database, never a repo file
/**
 * R33 — metered LLM pricing waits for its schema.
 *
 * Migrations reach the database only on the `main` deploy, so code on
 * dev/staging, and the first minutes of a release, can run before migration
 * 551 (`commit_credits_metered`), 552 (`jobs.llm_billing`) and 554 (`reserve_llm_side_hold`) exist. Metering
 * then could not settle (no metered commit) nor record its ledger. So
 * `llmMeteredPricing()` (lib/config.ts) also requires this gate: until BOTH
 * are confirmed present, every LLM path runs exactly as under the rollback
 * (tier pricing, byte-identical); once they are, metered.
 *
 * The gate imports nothing that touches the database (config.ts reads it and
 * the Supabase client imports config): the probe (`./llm-metered-schema-probe.ts`,
 * a leaf) is handed the service-role client, which `./supabase.ts` registers
 * here when it creates it ({@link registerLlmMeteredSchemaClient}) — so every
 * process that can reach the database can probe, and the import graph has no
 * loop. No client registered → not ready. Not ready → a probe
 * is started at most every {@link LLM_SCHEMA_REPROBE_MS} and its answer is
 * used from then on; a probe ERROR is "not ready" (the safe, earlier path).
 * Ready is final for the process — a schema does not un-migrate.
 *
 * Under Vitest no probe ever starts by itself (a fire-and-forget probe would
 * outlive the test environment — the `middleware/credit-guard.ts` lesson):
 * tests set the state with {@link setLlmMeteredSchemaReadyForTesting} or run
 * {@link probeLlmMeteredSchemaNow}.
 */

import { probeLlmMeteredSchema, type LlmMeteredSchemaProbeClient } from "./llm-metered-schema-probe.js"

/** How often a not-ready process re-asks the database. */
export const LLM_SCHEMA_REPROBE_MS = 3 * 60 * 1000

/**
 * How long one probe may take before it counts as "not ready". A hung probe
 * would otherwise hold the in-flight slot forever, so the gate never asked
 * again; on a timeout the next probe is due after {@link LLM_SCHEMA_REPROBE_MS}.
 */
export const LLM_SCHEMA_PROBE_TIMEOUT_MS = 10_000

/** `probe()`, or false once {@link LLM_SCHEMA_PROBE_TIMEOUT_MS} passes. */
function withProbeTimeout(probe: () => Promise<boolean>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[llm-billing] metered LLM schema probe timed out after ${LLM_SCHEMA_PROBE_TIMEOUT_MS} ms — staying on tier pricing`)
      resolve(false)
    }, LLM_SCHEMA_PROBE_TIMEOUT_MS)
    // Never keeps the process alive on its own.
    ;(timer as { unref?: () => void }).unref?.()
  })
  return Promise.race([probe(), timeout]).finally(() => clearTimeout(timer))
}

let ready = false
let lastProbeStartedAt = Number.NEGATIVE_INFINITY
let inflight: Promise<boolean> | null = null
let probeOverride: (() => Promise<boolean>) | null = null
let probeClient: LlmMeteredSchemaProbeClient | null = null

/** `./supabase.ts` hands the gate its service-role client when it creates it. */
export function registerLlmMeteredSchemaClient(client: LlmMeteredSchemaProbeClient): void {
  probeClient = client
}

/** Is the metered schema (551 + 552 + 554) confirmed present? Never blocks: a stale "not ready" starts a probe in the background. */
export function llmMeteredSchemaReady(): boolean {
  if (ready) return true
  if (!process.env.VITEST && !inflight && Date.now() - lastProbeStartedAt >= LLM_SCHEMA_REPROBE_MS) {
    void probeLlmMeteredSchemaNow()
  }
  return false
}

/**
 * Probe now (concurrent callers share one probe) and answer whether the
 * schema is ready. Never throws: a failed probe answers false.
 */
export function probeLlmMeteredSchemaNow(): Promise<boolean> {
  if (ready) return Promise.resolve(true)
  if (inflight) return inflight
  lastProbeStartedAt = Date.now()
  inflight = (async () => {
    try {
      const db = probeClient
      const probe = probeOverride ?? (db ? () => probeLlmMeteredSchema(db) : null)
      if (!probe) {
        console.warn("[llm-billing] metered LLM schema cannot be probed: no database client registered — staying on tier pricing")
        return false
      }
      const ok = await withProbeTimeout(probe)
      if (ok && !ready) {
        ready = true
        console.log("[llm-billing] metered LLM schema is ready (commit_credits_metered + jobs.llm_billing + reserve_llm_side_hold) — metered pricing is on")
      }
      return ok
    } catch (err) {
      console.warn("[llm-billing] metered LLM schema probe failed — staying on tier pricing:", err instanceof Error ? err.message : err)
      return false
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/**
 * Generators ONLY (gen:skills, its MCP tool-surface capture, docs:prices):
 * treat the schema as present without asking a database. What they write
 * describes the hosted deployment, where migrations 551, 552 and 554 are applied,
 * and must not depend on whether the machine running them can reach one (CI
 * and a developer's laptop cannot). Never call it from a serving process.
 */
export function assumeLlmMeteredSchemaReadyForDocs(): void {
  ready = true
}

/** Start the first probe at boot, so the first metered request rarely waits a tick. No-op under Vitest. */
export function warmLlmMeteredSchemaGate(): void {
  if (process.env.VITEST) return
  void probeLlmMeteredSchemaNow()
}

/**
 * Tests only: set the gate's state. `true`/`false` pins it; `undefined`
 * resets it to the never-probed default. `probe` replaces the database probe.
 */
export function setLlmMeteredSchemaReadyForTesting(state: boolean | undefined, probe?: () => Promise<boolean>): void {
  ready = state === true
  lastProbeStartedAt = state === undefined ? Number.NEGATIVE_INFINITY : Date.now()
  inflight = null
  probeOverride = probe ?? null
}
