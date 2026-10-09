// Temporary provider uploads (decided 2026-10-09): a job's scratch folder
// (`lib/job-scratch.ts`) is emptied when the job ends, on success or failure,
// including a cancel. Every handler that writes one runs in THIS worker, and
// every handler is dispatched at the one site the heartbeat wiring test pins
// (`allHandlers[job.name]`). So the discard sits in a `finally` around that
// dispatch: it runs after the first run, after the inline safety re-run, after
// the failure path has marked the row, and after a cancel unwinds the handler.
// `discardJobScratch` itself reads the row and keeps the folder while the job
// is still in flight (a BullMQ retry, a drain hand-back, a provider task left
// for the reconcile cron), so the `finally` may run on every exit.
//
// What this does NOT prove (a textual guard cannot): that the discard deletes
// — `lib/__tests__/job-scratch.test.ts` proves that.
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const src = readFileSync(resolve(__dirname, "../video-worker.ts"), "utf8")
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("video-worker job-scratch wiring", () => {
  it("discards the job's scratch folder after a stall re-pick's inline recovery (the attempt that died may have left some)", () => {
    expect(code.match(/discardJobScratch\(/g)?.length).toBe(2)
    const recoverAt = code.indexOf("await tryInlineReconcile(")
    expect(recoverAt).toBeGreaterThan(-1)
    const after = code.slice(recoverAt)
    const returnAt = after.search(/\n\s*return\n/)
    expect(after.slice(0, returnAt)).toContain("await discardJobScratch(jobId)")
  })

  it("discards the job's scratch folder in a finally after every run of the handler", () => {
    const discardAt = code.lastIndexOf("await discardJobScratch(jobId)")
    expect(discardAt, "the dispatch must await discardJobScratch(jobId)").toBeGreaterThan(-1)

    // The finally that holds it closes the try whose catch marks the row failed.
    const finallyAt = code.lastIndexOf("} finally {", discardAt)
    expect(finallyAt).toBeGreaterThan(-1)
    const lastRun = code.lastIndexOf("runWithJobCancellation(jobId, jobUserId, () => handler(job, ctx))")
    expect(lastRun).toBeGreaterThan(-1)
    expect(finallyAt).toBeGreaterThan(lastRun)
    expect(finallyAt).toBeGreaterThan(code.lastIndexOf("await markJobFailed(jobId"))
    // Nothing between the finally and the discard but whitespace.
    expect(code.slice(finallyAt + "} finally {".length, discardAt).trim()).toBe("")
  })
})
