/**
 * RESULT-GATE TOTALITY (spec §11.1, D32).
 *
 * Two funnels, two guards. `markJobCompleted` is where the result gate lives
 * and `markJobFailed` is where every failure CAS lives, so a `status:"completed"`
 * or `status:"failed"` UPDATE on `jobs` written anywhere else is a lane the
 * seam cannot see: an output published ungated, or a job failed out from under
 * a review.
 *
 * The allowlists are the point, not an escape hatch. Each entry carries WHY —
 * either "this is not a media publication" (text/JSON producers and sinks have
 * nothing to moderate and no worker to route through) or "this workstream has
 * not landed yet". A stale TODO entry FAILS, so a migrated file cannot leave a
 * permanent hole behind it.
 *
 * The fourth assertion is the one that is not decoration: no
 * `finalizeJobWithMedia` caller may throw on `{ok:false}`. One added `throw`
 * turns EVERY hold into a retry loop against a `pending_review` row the pickup
 * CAS refuses — a job stuck at "awaiting review" that logs "not in a runnable
 * state" three times and then vanishes.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const SRC = join(__dirname, "..", "..")

/** The seam itself: the files that ARE the writers. */
const WRITERS = new Set([
  "workers/shared.ts",        // markJobCompletedDetailed — the completion CAS
  "lib/job-failure.ts",       // markJobFailed — the failure CAS
  "lib/job-policy-review.ts", // approve's own pending_review → completed CAS (D9)
])

/** Not a media publication, so nothing for the result gate to moderate and no
 *  worker to route through. Each of these writes its own terminal row in-route
 *  and always has. */
const NOT_A_MEDIA_PUBLICATION = [
  "routes/after-effects-ai.ts", "routes/ai-writer.ts", "routes/describe-to-picker.ts",
  "routes/image-critic.ts", "routes/image-to-text.ts", "routes/llm-chat.ts",
  "routes/llm-structured.ts", "routes/llm-suggest-description.ts", "routes/lottie-overlay-ai.ts",
  "routes/motion-graphics-ai.ts", "routes/prompt-helper.ts", "routes/qa-check.ts",
  "routes/reduce.ts", "routes/scene-graph-ai.ts", "routes/text-to-picker.ts",
  "routes/three-d-title-ai.ts", "routes/web-scrape.ts",
] as const

/** Sinks: they SEND somewhere, they do not produce an asset. */
const SINKS = [
  "routes/save-to-storage.ts", "routes/social-publish.ts", "routes/telegram-channel.ts",
  "routes/webhook-output.ts", "workers/social-publish-worker.ts",
  "services/workflow-engine/inline-executor.ts",
] as const

function reasons(files: readonly string[], why: string): Array<[string, string]> {
  return files.map((f) => [f, why] as [string, string])
}

const COMPLETED_ALLOWLIST: ReadonlyMap<string, string> = new Map([
  ...reasons(NOT_A_MEDIA_PUBLICATION, "text/JSON producer — no media output, no worker, nothing to moderate"),
  ...reasons(SINKS, "a sink, not a producer: it publishes elsewhere and creates no asset row"),
  ["routes/replicate-training-webhook.ts", "LoRA training completion — a model, not media"],
  ["lib/reconcile/replicate.ts", "the TRAINING branch (:137) completes a LoRA model; the media branch goes through finalizeJobWithMedia"],
  ["routes/voice-clones.ts", "voice-clone MODEL creation — no media output"],
  ["routes/suno.ts", "the direct-KIE voice-create lane settles in-route (no worker)"],
  ["ee/copilot/reconcile.ts", "copilot turns own their own lifecycle"],
  ["lib/meter-sync-llm.ts", "the LLM meter's own commit closure — a text lane"],
  ["routes/pipelines.ts", "pipeline bookkeeping rows, not a media completion"],
])

const FAILED_ALLOWLIST: ReadonlyMap<string, string> = new Map([
  ...reasons(NOT_A_MEDIA_PUBLICATION, "text/JSON producer — settles in-route, no worker, no reservation to strand"),
  ...reasons(SINKS.filter((f) => f !== "workers/social-publish-worker.ts" && f !== "services/workflow-engine/inline-executor.ts"),
    "a sink: the failure is its own contract with its route"),
  ["workers/social-publish-worker.ts", "writes the error into output_data as its own contract with routes/social-publish.ts:165"],
  ["routes/character-training.ts", "LoRA training: no queue, no worker, and its .eq(\"user_id\") scope IS its authorization"],
  ["routes/suno.ts", "the direct-KIE voice-create / polling lanes settle in-route"],
  ["routes/voice-clones.ts", "voice-clone model creation — no media, no worker"],
  ["ee/routes/copilot.ts", "copilot turn rows own their own lifecycle"],
  ["routes/pipelines.ts", "pipeline bookkeeping rows"],
])

/**
 * Files a LATER workstream in this same release migrates. When the owner lands,
 * the file stops matching and the "no stale entry" assertion fails until the
 * entry is deleted.
 */
const COMPLETED_TODO: ReadonlyMap<string, string> = new Map([])

const FAILED_TODO: ReadonlyMap<string, string> = new Map([
  ["services/workflow-engine/node-executor.ts", "(:1973) the component-wrapper timeout write — found by THIS guard, named in no blueprint. WS4 owns the file; until it migrates, the row is a wrapper with no worker and lib/reconcile/cron.ts's sweep is its backstop"],
])

function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "__tests__" || e.name === "node_modules" || e.name === "test") continue
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...tsFiles(p))
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) out.push(p)
  }
  return out
}

function blankComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ")
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + blank(m.slice(p1.length)))
}

interface Hit { file: string; line: number }

/** A `status: "<status>"` (or the ternary form) inside a `.from("jobs").update(`
 *  chain. The backward window is bounded so a `.from("jobs")` earlier in the
 *  file cannot be mistaken for this statement's table. */
function statusWrites(status: string): Hit[] {
  const LIT = new RegExp(`status:\\s*["']${status}["']|\\?\\s*["']${status}["']\\s*:`, "g")
  const hits: Hit[] = []
  for (const abs of tsFiles(SRC)) {
    const file = abs.slice(SRC.length + 1).split("\\").join("/")
    const src = blankComments(readFileSync(abs, "utf8"))
    for (const m of src.matchAll(LIT)) {
      const win = src.slice(Math.max(0, m.index - 600), m.index)
      const froms = [...win.matchAll(/\.from\(\s*["']([a-z_]+)["']/g)]
      const last = froms[froms.length - 1]
      if (!last || last[1] !== "jobs") continue
      if (!/\.update\s*\(/.test(win.slice(last.index! + last[0].length))) continue
      hits.push({ file, line: src.slice(0, m.index).split("\n").length })
    }
  }
  return hits
}

function check(status: "completed" | "failed", allow: ReadonlyMap<string, string>, todo: ReadonlyMap<string, string>) {
  const hits = statusWrites(status).filter((h) => !WRITERS.has(h.file))
  const violations = hits
    .filter((h) => !allow.has(h.file) && !todo.has(h.file))
    .map((h) => `  • ${h.file}:${h.line}`)
  const stale = [...todo.entries()]
    .filter(([f]) => !hits.some((h) => h.file === f))
    .map(([f, why]) => `  • ${f} — ${why}`)
  const staleAllow = [...allow.entries()]
    .filter(([f]) => !hits.some((h) => h.file === f))
    .map(([f]) => `  • ${f}`)
  return { hits, violations, stale, staleAllow }
}

describe("every jobs completion goes through markJobCompleted", () => {
  const { hits, violations, stale, staleAllow } = check("completed", COMPLETED_ALLOWLIST, COMPLETED_TODO)

  it("scans the real write population", () => {
    expect(hits.length).toBeGreaterThan(20)
  })

  it("no media publication writes status:\"completed\" outside the funnel", () => {
    expect(
      violations,
      `These write status:"completed" on jobs directly, so the result gate never sees their ` +
        `output — it is published ungated, uncounted and unmoderatable.\n\n` +
        `Route it through markJobCompleted(jobId, fields) (or markJobCompletedDetailed when you ` +
        `need to tell a block/hold from a lost race). If it genuinely is NOT a media publication ` +
        `— a text/JSON producer, a sink, a model — add it to COMPLETED_ALLOWLIST *with the ` +
        `reason*.\n\n${violations.join("\n")}`,
    ).toEqual([])
  })

  it("has no stale allowlist entry", () => {
    expect(stale, `Migrated files still on COMPLETED_TODO:\n${stale.join("\n")}`).toEqual([])
    expect(staleAllow, `Files on COMPLETED_ALLOWLIST that no longer write it:\n${staleAllow.join("\n")}`).toEqual([])
  })
})

describe("every jobs failure goes through markJobFailed", () => {
  const { hits, violations, stale, staleAllow } = check("failed", FAILED_ALLOWLIST, FAILED_TODO)

  it("scans the real write population", () => {
    expect(hits.length).toBeGreaterThan(30)
  })

  it("no worker or sweep writes status:\"failed\" outside markJobFailed", () => {
    expect(
      violations,
      `These write status:"failed" on jobs directly, so nothing guarantees the CAS excludes ` +
        `pending_review — a sweep can fail a job a human is reviewing, stranding its output and ` +
        `its reservation.\n\nUse markJobFailed(jobId, {...}) from lib/job-failure.js and refund ` +
        `only on the returned boolean.\n\n${violations.join("\n")}`,
    ).toEqual([])
  })

  it("has no stale allowlist entry", () => {
    expect(stale, `Migrated files still on FAILED_TODO:\n${stale.join("\n")}`).toEqual([])
    expect(staleAllow, `Files on FAILED_ALLOWLIST that no longer write it:\n${staleAllow.join("\n")}`).toEqual([])
  })
})

describe("anti-vacuity — the guards cannot pass by everyone stopping writing", () => {
  it("workers/shared.ts still hosts the result gate", () => {
    const src = readFileSync(join(SRC, "workers", "shared.ts"), "utf8")
    expect(src).toContain("applyResultGate")
    expect(src).toContain("hasJobPolicyFor")
  })

  it("lib/job-failure.ts still writes the failure literal", () => {
    expect(readFileSync(join(SRC, "lib", "job-failure.ts"), "utf8")).toContain('status: "failed"')
  })
})

describe("no finalizeJobWithMedia caller throws on { ok: false }", () => {
  /**
   * A `held` finalize is BENIGN at every call site today: the handler returns,
   * the BullMQ job completes normally, no retry, no failure write, no refund.
   * That property is what makes hold safe on this funnel — and it is one
   * `throw` away from being false.
   */
  it("every call site treats a non-ok finalize as a graceful skip", () => {
    const offenders: string[] = []
    let sites = 0
    for (const abs of tsFiles(SRC)) {
      const file = abs.slice(SRC.length + 1).split("\\").join("/")
      if (file === "lib/job-finalize.ts") continue
      const src = blankComments(readFileSync(abs, "utf8"))
      for (const m of src.matchAll(/finalizeJobWithMedia\s*\(/g)) {
        let depth = 0
        let i = m.index + m[0].length - 1
        for (; i < src.length; i++) {
          if (src[i] === "(") depth++
          else if (src[i] === ")") { depth--; if (depth === 0) break }
        }
        sites++
        const after = src.slice(i, i + 2000).split("\n").slice(0, 6).join("\n")
        if (/\bthrow\b/.test(after)) {
          offenders.push(`  • ${file}:${src.slice(0, m.index).split("\n").length}`)
        }
      }
    }
    expect(sites).toBeGreaterThan(20)
    expect(
      offenders,
      `These callers throw right after finalizeJobWithMedia. A { ok:false, reason:"held" } is ` +
        `NOT an error — the job is parked on a human — and throwing turns it into a BullMQ retry ` +
        `loop against a pending_review row the pickup CAS refuses.\n\n${offenders.join("\n")}`,
    ).toEqual([])
  })
})
