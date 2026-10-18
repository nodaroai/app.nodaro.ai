// @test-watches backend/src/**/*.ts
/**
 * Every raw `status: "cancelled"` writer in backend/src, and why it cannot
 * strand a use-case wrapper (decided 2026-10-13).
 *
 * A use-case wrapper owns a hidden run and a reserved fee. A bare flip to
 * `cancelled` refunds nothing (no worker settles a wrapper) and leaves the run
 * dispatching and billing. Only `cancelOwnedJob` (lib/cancel-job.ts) refunds
 * AND stops the run, so every writer a wrapper can reach hands use-case rows
 * to it. The finaliser also refunds a wrapper it finds `cancelled`
 * (idempotent) as a backstop for the fee — not for the run.
 *
 * File-keyed, like the job-policy result-totality guard: a NEW file that writes
 * the literal fails until it is listed here with its reason; a listed file that
 * no longer writes it fails as stale. It does not see a new write added inside
 * a file already listed.
 */
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"

const SRC = join(__dirname, "..", "..", "..")

/** Files that can reach a use-case wrapper row: each must hand it to cancelOwnedJob (or keep it off its flip). */
const DELEGATES_USE_CASE: ReadonlyMap<string, string> = new Map([
  ["lib/cancel-job.ts", "IS the single-job cancel: refunds, then stops the hidden run"],
  ["lib/mcp/tasks.ts", "fast CAS excludes provider use-case; those fall through to cancelOwnedJob"],
  ["lib/reconcile/cancel-inflight-jobs.ts", "an outer re-pick hands use-case rows to cancelOwnedJob"],
  ["routes/cancel-jobs.ts", "cancel-all delegates use-case rows with the held ones"],
  ["routes/workflow-execution.ts", "standalone fallback and the child-jobs branch delegate use-case rows"],
])

/** Files whose raw cancel can never meet a use-case wrapper. */
const CANNOT_REACH: ReadonlyMap<string, string> = new Map([
  ["lib/use-case/cancel-run.ts", "writes workflow_executions (the hidden run), not jobs"],
  ["workers/orchestrator-worker.ts", "writes workflow_executions"],
  ["services/workflow-engine/node-executor.ts", "cancelJobAndThrow: jobs a polled node made (a use-case node waits through its own executor and cancels via cancelOwnedJob); the other site writes workflow_executions"],
  ["lib/job-policy-gate.ts", "withdraws a parked (pending_review) row it owns"],
  ["lib/reconcile/replicate.ts", "character LoRA training jobs only"],
  ["routes/replicate-training-webhook.ts", "character LoRA training jobs only"],
  ["routes/characters.ts", "character LoRA training jobs only"],
  ["routes/character-training.ts", "character LoRA training jobs only"],
  ["routes/pipelines.ts", "pipeline rows and pipeline stage jobs"],
  ["routes/app-run-resume.ts", "writes workflow_executions: an app run's Retry it just inserted, cancelled when the run moved on before it started"],
  ["scripts/cleanup-stuck-pipelines.ts", "pipeline rows (one-off script)"],
])

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((ent) => {
    if (ent.name === "__tests__" || ent.name === "node_modules") return []
    const p = join(dir, ent.name)
    if (ent.isDirectory()) return tsFiles(p)
    return ent.name.endsWith(".ts") && !ent.name.endsWith(".d.ts") ? [p] : []
  })
}
const rel = (abs: string) => abs.slice(SRC.length + 1).split("\\").join("/")
const writers = tsFiles(SRC).filter((f) => /status:\s*"cancelled"/.test(readFileSync(f, "utf8"))).map(rel).sort()

describe("raw cancel writers vs use-case wrappers", () => {
  it("every file that writes status cancelled is listed with its reason", () => {
    const listed = new Set([...DELEGATES_USE_CASE.keys(), ...CANNOT_REACH.keys()])
    expect(writers.filter((f) => !listed.has(f))).toEqual([])
  })

  it("no listed file is stale", () => {
    const found = new Set(writers)
    expect([...DELEGATES_USE_CASE.keys(), ...CANNOT_REACH.keys()].filter((f) => !found.has(f))).toEqual([])
  })

  it("each writer that can reach a wrapper names the use-case provider", () => {
    for (const f of DELEGATES_USE_CASE.keys()) {
      expect(readFileSync(join(SRC, f), "utf8"), f).toMatch(/"use-case"|neq\.use-case/)
    }
  })
})
