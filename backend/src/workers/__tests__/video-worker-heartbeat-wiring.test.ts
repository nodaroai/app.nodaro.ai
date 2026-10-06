// The video worker stamps `provider_kind = "pre-task"` on every row at pickup,
// and the reconcile cron fails + refunds a row whose stamp is 30 minutes old.
// A handler that runs longer must keep beating the sentinel. The wrap used to
// cover ONLY the private-plugin map — so a core ffmpeg long-runner (apply-edl
// on an hour-long multicam cut) aged into the sweep with its worker still
// rendering. The worker now wraps the handler AT THE DISPATCH SITE: the one
// place a handler is looked up and run. That is what makes the coverage total
// by construction — no merge order, no later `Object.assign`, no second map
// can leave a job type out — and it is the only thing this test has to pin:
// the looked-up handler is wrapped before it is invoked, and nothing invokes
// the bare lookup.
//
// What this does NOT prove (a textual guard cannot): that the wrapper itself
// beats — `pre-task-heartbeat.test.ts` proves that — nor that the processor
// reaches the dispatch site for every job; `video-worker.test.ts`'s liveness
// cases run real jobs through the processor and count the beats.
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const src = readFileSync(resolve(__dirname, "../video-worker.ts"), "utf8")
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("video-worker pre-task heartbeat wiring", () => {
  const WRAP = "const handler = withPreTaskHeartbeat(found, {"
  // The wrap passes the handler's budget and the job's earlier ffmpeg-slot wait
  // (Track 0.13 — a re-pick adds to it).
  // The cap is the handler's own budget, else the registry's for the job
  // (`declaredJobBudgetMs`): a PLUGIN handler cannot carry `livenessBudgetMs`
  // (core-only), so without the fallback a long plugin render (Speaker View)
  // stopped beating at the 90-minute default and was swept mid-render.
  const WRAP_ARGS = /const handler = withPreTaskHeartbeat\(found, \{\s*maxMs: found\.livenessBudgetMs\?\.\(job\) \?\? declaredJobBudgetMs\(job\.name, job\.data\),\s*slotWaitBaseMs: [^\n]*pickedRows\[0\][^\n]*slot_wait_ms/

  it("wraps the looked-up handler at the dispatch site, before it is invoked", () => {
    // The lookup binds `found`; the invoked `handler` is the wrapped one.
    expect(code).toMatch(/const found = allHandlers\[job\.name\]/)
    const lookupAt = code.indexOf("const found = allHandlers[job.name]")
    const wrapAt = code.indexOf(WRAP)
    expect(wrapAt, "the dispatch site must wrap the looked-up handler").toBeGreaterThan(-1)
    expect(wrapAt).toBeGreaterThan(lookupAt)
    expect(code).toMatch(WRAP_ARGS)
  })

  it("never invokes the bare lookup — every call goes through the wrapped handler", () => {
    // `found` appears exactly where the dispatch site needs it: the lookup, the
    // unknown-type guard, the budget read and the wrap argument. Any other use
    // — `found(`, `found?.(`, `found.call(` — is a bare invocation.
    expect(code.match(/\bfound\b/g)?.length).toBe(4)
    expect(code).not.toMatch(/\bfound\s*(\?\.)?\s*\(/)
    expect(code).not.toMatch(/\bfound\.(call|apply|bind)\b/)
    // Exactly one lookup of the map by job name: a second dispatch path would
    // need its own wrap and its own guard.
    expect(code.match(/allHandlers\[job\.name\]/g)?.length).toBe(1)
  })

  it("wraps exactly once in the whole worker — no map wrap beside the dispatch site, no nested wrap (each would beat twice per interval)", () => {
    expect(code.match(/withPreTaskHeartbeat\(/g)?.length).toBe(1)
  })

  it("honours a handler's own liveness budget at the dispatch site (apply-edl declares its ffmpeg kill budget)", () => {
    expect(code).toMatch(WRAP_ARGS)
  })

  it("falls back to the job's registered budget when the handler declares none (a plugin handler — Speaker View)", () => {
    expect(code).toMatch(/import \{[^}]*\bdeclaredJobBudgetMs\b[^}]*\} from "\.\.\/lib\/job-budget\.js"/)
    expect(code).toMatch(WRAP_ARGS)
  })
})
