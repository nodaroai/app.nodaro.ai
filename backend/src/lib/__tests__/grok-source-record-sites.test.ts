// @test-watches backend/src/**/*.ts
import { describe, it, expect } from "vitest"
import ts from "typescript"
import { eachSourceFile, lineOf, SCAN_TIMEOUT_MS, walk } from "./source-scan.js"

/**
 * What a completed Grok Imagine video job (`grok` / `grok-i2v`) records for a
 * Grok Extend after it — its task and `recordedResolution` — has ONE writer,
 * `grokSourceOutputFields` (lib/grok-source-record.ts), read in the one
 * completion funnel, `finalizeJobWithMedia`. It reads the task off the row
 * itself, so a lane that finalizes such a job records it without passing
 * anything (the behaviour: job-finalize-recorded-resolution.test.ts).
 *
 * What would skip it is a lane that completes such a job WITHOUT the funnel,
 * or that writes the field itself. So:
 *  - the helper is called once, in the funnel;
 *  - no other shipped file writes a `recordedResolution` key;
 *  - the two files that run and recover these jobs — the video worker
 *    (`text-to-video` / `image-to-video`) and the KIE recovery — complete
 *    nothing else directly: each has exactly the direct completion listed
 *    here, for a result that is not a video. A new one fails until it is
 *    routed through the funnel or listed with why it is not such a job.
 *
 * Not caught: a NEW file that completes such a job directly. Grok Imagine
 * video runs only on KIE, through these two files today.
 */

const HELPER = "grokSourceOutputFields"
const FUNNEL = "lib/job-finalize.ts"
const WRITER = "lib/grok-source-record.ts"

/** Direct `markJobCompleted` / `markJobCompletedDetailed` calls in the files that run and recover Grok Imagine video jobs. */
const DIRECT_COMPLETIONS: Readonly<Record<string, { count: number; why: string }>> = {
  "workers/handlers/video-ai.ts": { count: 1, why: "generate-mask: an {imageUrl, maskUrl} pair, not a video" },
  "lib/reconcile/kie.ts": { count: 1, why: "a recovered transcription: text, not a video" },
}

const nameOf = (e: ts.Expression): string | undefined =>
  ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : undefined

describe("Grok source record sites", () => {
  it("the helper is called once, in the completion funnel", () => {
    const sites: string[] = []
    eachSourceFile([HELPER], (sf, rel) => {
      walk(sf, (n) => {
        if (ts.isCallExpression(n) && nameOf(n.expression) === HELPER) sites.push(`${rel}:${lineOf(sf, n)}`)
      })
    })
    expect(sites.map((s) => s.split(":")[0])).toStrictEqual([FUNNEL])
  }, SCAN_TIMEOUT_MS)

  it("no other shipped file writes a recordedResolution key", () => {
    const writes: string[] = []
    eachSourceFile(["recordedResolution"], (sf, rel) => {
      walk(sf, (n) => {
        const key = ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n) ? n.name : undefined
        const named = key !== undefined && (ts.isIdentifier(key) || ts.isStringLiteral(key)) ? key.text : undefined
        if (named === "recordedResolution" && rel !== WRITER) writes.push(`${rel}:${lineOf(sf, n)}`)
      })
    })
    expect(writes).toStrictEqual([])
  }, SCAN_TIMEOUT_MS)

  it("the files that run and recover these jobs complete nothing else directly", () => {
    const counts: Record<string, number> = {}
    eachSourceFile(["markJobCompleted"], (sf, rel) => {
      if (!(rel in DIRECT_COMPLETIONS)) return
      walk(sf, (n) => {
        const name = ts.isCallExpression(n) ? nameOf(n.expression) : undefined
        if (name === "markJobCompleted" || name === "markJobCompletedDetailed") counts[rel] = (counts[rel] ?? 0) + 1
      })
    })
    const expected = Object.fromEntries(Object.entries(DIRECT_COMPLETIONS).map(([f, { count }]) => [f, count]))
    expect(counts).toStrictEqual(expected)
  }, SCAN_TIMEOUT_MS)
})
