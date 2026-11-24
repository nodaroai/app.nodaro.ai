// @test-always scans every backend source file for the completion lanes of a video job
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

/**
 * The promise and the completion agree: /v1/generate-video answers
 * `settlementDeferred: true` only for an `image-to-video` job (never a voiced
 * one), and every lane that completes such a job goes through
 * `finalizeJobWithMedia`, the one completion that writes the deferral record
 * and keeps the reservation held (lib/job-finalize.ts). A source file that
 * names the job type and completes a job directly (`markJobCompleted`) must be
 * listed here with why that completion is never an image-to-video job's.
 */

const SRC = join(__dirname, "..", "..")

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : sources(path)
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : []
  })
}

/** Files that name the job type AND complete a job directly, with the one completion each may hold. */
const REVIEWED: Record<string, { calls: number; inside: string; why: string }> = {
  "workers/handlers/video-ai.ts": {
    calls: 1,
    inside: "handleGenerateMask",
    why: "the image-to-video handlers all complete through finalizeJobWithMedia; the one direct completion is the mask job's",
  },
}

const DIRECT = /\bmarkJobCompleted(?:Detailed)?\(/g

describe("every completion lane of an image-to-video job writes the deferral record", () => {
  const files = sources(SRC)
  const naming = files.filter((f) => /["']image-to-video["']/.test(readFileSync(f, "utf8")))

  it("the files that name the job type and complete a job directly are the reviewed ones", () => {
    const direct = naming
      .map((f) => relative(SRC, f))
      .filter((rel) => rel !== "lib/job-finalize.ts" && rel !== "workers/shared.ts")
      .filter((rel) => DIRECT.test(readFileSync(join(SRC, rel), "utf8")) && ((DIRECT.lastIndex = 0), true))
    expect(direct.sort()).toEqual(Object.keys(REVIEWED).sort())
  })

  for (const [rel, review] of Object.entries(REVIEWED)) {
    it(`${rel}: only ${review.calls} direct completion, inside ${review.inside}`, () => {
      const text = readFileSync(join(SRC, rel), "utf8")
      const calls = [...text.matchAll(DIRECT)]
      expect(calls).toHaveLength(review.calls)
      for (const call of calls) {
        const before = text.slice(0, call.index)
        const last = [...before.matchAll(/const\s+(\w+)\s*:\s*HandlerFn|async function\s+(\w+)/g)].pop()
        const lastHandler = last?.[1] ?? last?.[2]
        expect(lastHandler, review.why).toBe(review.inside)
      }
    })
  }

  it("finalizeJobWithMedia writes the record and holds the reservation", () => {
    const text = readFileSync(join(SRC, "lib/job-finalize.ts"), "utf8")
    expect(text).toMatch(/isDeferredSettlementJob\(job\)/)
    expect(text).toMatch(/\.\.\.deferredFields/)
    expect(text).toMatch(/if \(!deferred\) \{\s*await settleFinalizedJobCredits/)
  })

  it("the route never defers a voiced video", () => {
    const text = readFileSync(join(SRC, "routes/generate-video.ts"), "utf8")
    expect(text).toMatch(/deferSettlementRequested && !dispatchesVoicedVideo\(parsed\.data\)/)
  })
})

/**
 * The same promise for /v1/video-upscale (the "delivered" rule): it answers
 * `settlementDeferred: true` only for "topaz" and "topaz-rhea", and every lane
 * that completes a `video-upscale` job — its worker's Topaz and Rhea paths, the
 * Replicate and fal reconciles — goes through `finalizeJobWithMedia`. A file
 * that names the job type and completes a job directly is listed with why that
 * completion is never a video upscale's.
 */
const UPSCALE_REVIEWED: Record<string, { calls: number; inside: string; why: string }> = {
  "workers/handlers/video-ai.ts": {
    calls: 1,
    inside: "handleGenerateMask",
    why: "handleVideoUpscale and runRheaUpscale complete through finalizeJobWithMedia; the one direct completion is the mask job's",
  },
  "lib/reconcile/replicate.ts": {
    calls: 1,
    inside: "reconcileReplicateJob",
    why: "the one direct completion is the transcribe branch's (`row.job_type === \"transcribe\"`); a Topaz upscale recovers through finalizeJobWithMedia",
  },
  "lib/reconcile/kie.ts": {
    calls: 1,
    inside: "reconcileKieTranscribeJob",
    why: "the one direct completion is the transcribe recovery's; an upscale on KIE (a draft finalize, VEO) recovers through finalizeJobWithMedia",
  },
}

describe("every completion lane of a video upscale writes the deferral record", () => {
  const files = sources(SRC)
  const naming = files.filter((f) => /["']video-upscale["']/.test(readFileSync(f, "utf8")))

  it("the files that name the job type and complete a job directly are the reviewed ones", () => {
    const direct = naming
      .map((f) => relative(SRC, f))
      .filter((rel) => rel !== "lib/job-finalize.ts" && rel !== "workers/shared.ts")
      .filter((rel) => DIRECT.test(readFileSync(join(SRC, rel), "utf8")) && ((DIRECT.lastIndex = 0), true))
    expect(direct.sort()).toEqual(Object.keys(UPSCALE_REVIEWED).sort())
  })

  for (const [rel, review] of Object.entries(UPSCALE_REVIEWED)) {
    it(`${rel}: only ${review.calls} direct completion, inside ${review.inside}`, () => {
      const text = readFileSync(join(SRC, rel), "utf8")
      const calls = [...text.matchAll(DIRECT)]
      expect(calls).toHaveLength(review.calls)
      for (const call of calls) {
        const before = text.slice(0, call.index)
        const last = [...before.matchAll(/const\s+(\w+)\s*:\s*HandlerFn|async function\s+(\w+)/g)].pop()
        expect(last?.[1] ?? last?.[2], review.why).toBe(review.inside)
      }
    })
  }

  it("the fal reconcile (Topaz Rhea) completes only through finalizeJobWithMedia", () => {
    const text = readFileSync(join(SRC, "lib/reconcile/fal.ts"), "utf8")
    expect(text).not.toMatch(DIRECT)
    expect(text).toMatch(/finalizeJobWithMedia\(/)
  })

  it("the route defers only the deferrable providers, through the trusted-parent check", () => {
    const text = readFileSync(join(SRC, "routes/video-upscale.ts"), "utf8")
    expect(text).toMatch(/deferSettlementRequested && DEFERRABLE_UPSCALE_PROVIDERS\.has\(provider\) && await deferSettlementHonoured\(req\)/)
    expect(text).toMatch(/delete parsed\.data\.deferSettlement/)
  })

  it("finalize copies the request's rule into the record", () => {
    const text = readFileSync(join(SRC, "lib/job-finalize.ts"), "utf8")
    expect(text).toMatch(/rule: storedDeferRule\(job\.input_data\)/)
  })
})
