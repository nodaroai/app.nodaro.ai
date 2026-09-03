/**
 * REQUEST-GATE TOTALITY (spec §11.1, D32).
 *
 * `no-direct-job-insert.test.ts` already owns half the funnel: nothing inserts
 * into `jobs` outside `lib/insert-job.ts`. This is the other half — the half a
 * gate needs and a provenance helper did not.
 *
 * A creator that calls an insert helper and DROPS the `error` cannot see a
 * block. The row is not created, the helper says so, and the caller sails on:
 *
 *   const { data: job } = await insertInternalJob("orchestrator", { … })
 *   //  ^ the block arrives here and is discarded
 *   await safeFetch(url, …)   // …and the webhook fires anyway
 *
 * That is not a hypothetical: BOTH offenders below exist today and are why this
 * guard is written before the gate is wired. `social-publish-worker.ts:60` is
 * the more expensive one — a null job id there means "publish anyway, unbilled"
 * (a pre-existing hole the gate forces closed, not one it introduces).
 *
 * The predicate is deliberately about CAPTURING the error, not about which
 * shape of response the caller writes. A caller that captures `error` and
 * reads it can be given a 422 later; a caller that never captures it cannot be
 * fixed by any amount of plumbing downstream.
 *
 * That split is a scoping decision, NOT a claim that the status half is
 * cosmetic (review F10): the routes that answered a hand-rolled 5xx on a block
 * told every SDK/CLI consumer "server bug — retry with backoff" for a verdict
 * that will never change, so a permanent block became a retry loop that
 * re-gated and re-audited on every attempt, and `JobBlockedError` never fired
 * (`throwFromResponse` maps only `422` + `job_blocked`). The six such lanes
 * — `routes/webhook-output.ts`, `routes/social-publish.ts`,
 * `routes/telegram-channel.ts`, `routes/pipelines.ts` (regenerate-scene),
 * `lib/meter-sync-llm.ts` and `routes/character-training.ts` — now answer 422,
 * each with its own test. What is left is genuinely error-shaped rather than
 * status-shaped, and this guard still does not see it: `routes/suno.ts:1184`
 * and `:1259` only `console.warn` a blocked best-effort ownership insert and
 * proceed, and `lib/cloud-llm-proxy.ts`'s mirror row logs and returns the
 * cloud's answer. Tightening HANDLED to require a reply shape would flag
 * exactly those three — worth doing when someone owns them.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const SRC = join(__dirname, "..", "..")

/**
 * Files that drop the insert error today and are fixed by a LATER workstream in
 * this same release (WS3). When the owner lands, the file stops matching and
 * the "no stale entry" assertion fails until the entry is deleted — a permanent
 * allowlist is how a guard dies.
 */
const TODO_ALLOWLIST: ReadonlyMap<string, string> = new Map([])

const CALL = /\b(insertJob|insertJobs|insertInternalJob|insertJobIdempotent)\s*(?:<[^>]*>)?\s*\(/g
/** The `const { … } = await` immediately before the call. */
const DESTRUCTURE = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:await\s+)?$/
const HANDLED = /sendInternalError|\bblocked\b|JobBlockedError/
/** How far after the call we look for the captured error being read. */
const WINDOW_LINES = 20

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

/** Blank comments while PRESERVING byte offsets, so reported line numbers match
 *  the real file (a stripping version reports the wrong line, which is worse
 *  than none in a guard whose whole output is a file:line list). */
function blankComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ")
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + blank(m.slice(p1.length)))
}

interface Offender { file: string; line: number; why: string }

function scan(): { offenders: Offender[]; calls: number } {
  const offenders: Offender[] = []
  let calls = 0
  for (const abs of tsFiles(SRC)) {
    const file = abs.slice(SRC.length + 1).split("\\").join("/")
    if (file === "lib/insert-job.ts") continue
    const src = blankComments(readFileSync(abs, "utf8"))
    for (const m of src.matchAll(CALL)) {
      // Walk to the call's matching close paren: the row literal spans many
      // lines, so "20 lines after the opening line" would be inside the object.
      let depth = 0
      let i = m.index + m[0].length - 1
      for (; i < src.length; i++) {
        if (src[i] === "(") depth++
        else if (src[i] === ")") { depth--; if (depth === 0) break }
      }
      calls++
      const line = src.slice(0, m.index).split("\n").length
      const before = src.slice(Math.max(0, m.index - 200), m.index)
      const d = before.match(DESTRUCTURE)
      // Not destructured = the throwing lane (insertJobIdempotent) or a result
      // object handled elsewhere; JobBlockedError propagates on its own.
      if (!d) continue
      const bindings = d[1]!
      const renamed = bindings.match(/\berror\s*:\s*(\w+)/)
      const errorId = renamed ? renamed[1]! : /\berror\b/.test(bindings) ? "error" : null
      const after = src.slice(i, i + 6000).split("\n").slice(0, WINDOW_LINES + 1).join("\n")
      if (!errorId) {
        offenders.push({ file, line, why: `drops the insert error entirely — { ${bindings.trim()} }` })
      } else if (!new RegExp(`\\b${errorId}\\b`).test(after) && !HANDLED.test(after)) {
        offenders.push({ file, line, why: `captures \`${errorId}\` but never reads it` })
      }
    }
  }
  return { offenders, calls }
}

describe("every job creator can see a request-gate block", () => {
  const { offenders, calls } = scan()

  it("scans the real creator population (the guard is wired to something)", () => {
    expect(calls).toBeGreaterThan(100)
  })

  it("no creator swallows the insert error", () => {
    const violations = offenders
      .filter((o) => !TODO_ALLOWLIST.has(o.file))
      .map((o) => `  • ${o.file}:${o.line} — ${o.why}`)

    expect(
      violations,
      `These job creators cannot see a request-gate block: the insert helper returns ` +
        `{ data: null, error: { message, blocked } } and the call site discards it, so a ` +
        `blocked request silently proceeds as if the job existed.\n\n` +
        `Routes: destructure \`error\` and \`return sendInternalError(reply, req, error, "…")\` — ` +
        `it maps a block to 422 job_blocked for free. Internal creators (workers, pipelines, ` +
        `the orchestrator): destructure \`error\` and \`if (error?.blocked) throw new ` +
        `JobBlockedError(error.blocked)\` so your own stage records the reason.\n\n` +
        `${violations.join("\n")}`,
    ).toEqual([])
  })

  it("has no stale TODO allowlist entry (delete yours when your workstream lands)", () => {
    const stillOffending = new Set(offenders.map((o) => o.file))
    const stale = [...TODO_ALLOWLIST.entries()]
      .filter(([file]) => !stillOffending.has(file))
      .map(([file, why]) => `  • ${file} — ${why}`)
    expect(stale, `Fixed files still on TODO_ALLOWLIST:\n${stale.join("\n")}`).toEqual([])
  })

  it("the funnel it guards actually runs the gate (anti-vacuity)", () => {
    const src = readFileSync(join(SRC, "lib", "insert-job.ts"), "utf8")
    expect(src).toContain("applyJobRequestPolicies(")
    expect(src).toContain("hasJobPolicyFor(\"request\")")
  })
})
