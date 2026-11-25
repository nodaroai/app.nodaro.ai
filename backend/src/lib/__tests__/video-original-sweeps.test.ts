// @test-reads-none pure walks over output shapes
/**
 * A kept video original (`originalVideoUrl`, lib/video-result-store.ts,
 * decided 2026-11-22) is in its job's key family and in `output_data` at the
 * completion write, so every job-keyed walk finds it with nothing more to do:
 * the result gate's withhold / delete set, the retention sweep and the app
 * expunge (both `ownedJobOutputKeys`), and library delete's lookup from the
 * preview's key.
 */
import { describe, expect, it, vi } from "vitest"

vi.mock("../config.js", () => ({ config: { R2_PUBLIC_URL: "https://cdn.test" } }))
vi.mock("../storage.js", () => ({
  r2KeyFromOurUrl: (url: string) => (url.startsWith("https://cdn.test/") ? url.slice("https://cdn.test/".length) : null),
}))

import { ownedJobOutputKeys } from "../job-output-keys.js"
import { allOwnedObjects } from "../job-policy-outputs.js"
import { keptOriginalKeysOf, originalVideoObjectId } from "../video-original-keys.js"

const JOB = "00000000-0000-4000-8000-0000000000aa"
const OUTPUT = {
  videoUrl: `https://cdn.test/videos/${JOB}.mp4`,
  originalVideoUrl: `https://cdn.test/videos/${JOB}-master.mov`,
  thumbnailUrl: `https://cdn.test/thumbnails/${JOB}.png`,
}

describe("a kept original is found by every job-keyed walk", () => {
  it("is in the job's own key family", () => {
    expect(originalVideoObjectId(JOB)).toBe(`${JOB}-master`)
  })

  it("the retention sweep and the app expunge list it", () => {
    expect(ownedJobOutputKeys(JOB, OUTPUT)).toEqual(expect.arrayContaining([`videos/${JOB}.mp4`, `videos/${JOB}-master.mov`]))
  })

  it("the result gate withholds and deletes it with the preview", () => {
    const held = allOwnedObjects(JOB, OUTPUT)
    expect(held.map((h) => h.key)).toEqual(expect.arrayContaining([`videos/${JOB}.mp4`, `videos/${JOB}-master.mov`]))
    expect(held.find((h) => h.key === `videos/${JOB}-master.mov`)?.kind).toBe("video")
  })

  it("library delete finds it from the preview's key, in every container it may be stored as", () => {
    expect(keptOriginalKeysOf(`videos/${JOB}.mp4`)).toEqual(["mp4", "mov", "webm", "mkv"].map((ext) => `videos/${JOB}-master.${ext}`))
    // An original is no preview, and an image has none.
    expect(keptOriginalKeysOf(`videos/${JOB}-master.mp4`)).toEqual([])
    expect(keptOriginalKeysOf(`images/${JOB}.png`)).toEqual([])
  })

  it("a watermarked Extend's raw clip, named only in jobs.server_output, is found by the walks that read that column", () => {
    const raw = `https://cdn.test/videos/${JOB}-raw-11111111-2222-4333-8444-555555555555.mov`
    // The retention sweep and the app expunge walk { output, server } (cleanup-service.ts, collect-app-r2-keys.ts).
    expect(ownedJobOutputKeys(JOB, { output: OUTPUT, server: { rawExtensionUrl: raw } })).toContain(`videos/${JOB}-raw-11111111-2222-4333-8444-555555555555.mov`)
    expect(ownedJobOutputKeys(JOB, OUTPUT)).not.toContain(`videos/${JOB}-raw-11111111-2222-4333-8444-555555555555.mov`)
  })

})
