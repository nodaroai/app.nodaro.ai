import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  VIDEO_MASK_LIMITS,
  resolveVideoMaskProvider,
  videoMaskBilledSeconds,
  videoMaskCreditId,
  videoMaskCreditIds,
} from "../video-mask.js"

/** The priced length a run uses: billed seconds rounded up (lib/video-mask-length.ts). */
const rowFor = (sec: number, fps?: number) => videoMaskCreditId(Math.ceil(videoMaskBilledSeconds(sec, fps)))

describe("Video Mask pricing", () => {
  // Repeated verbatim in docs/nodes/ai-video/video-mask.md → Worked examples.
  it.each([
    [4, 30, "sam-3-video:5s"],
    [12, 24, "sam-3-video:15s"],
    [10, 60, "sam-3-video:30s"],
    [45, 30, "sam-3-video:60s"],
  ])("%s s at %s fps → %s", (sec, fps, row) => {
    expect(rowFor(sec, fps)).toBe(row)
  })

  it("prices a clip at or under 30 fps at its own length, a faster one proportionally longer", () => {
    expect(videoMaskBilledSeconds(10, 24)).toBe(10)
    expect(videoMaskBilledSeconds(10, 30)).toBe(10)
    expect(videoMaskBilledSeconds(10, 60)).toBe(20)
    expect(videoMaskBilledSeconds(10, undefined)).toBe(10)
  })

  it("quotes an unknown length at the longest row and clamps past the cap", () => {
    expect(videoMaskCreditId(undefined)).toBe("sam-3-video:60s")
    expect(videoMaskCreditId(0)).toBe("sam-3-video:60s")
    expect(videoMaskCreditId(500)).toBe("sam-3-video:60s")
    expect(videoMaskCreditId(5)).toBe("sam-3-video:5s")
    expect(videoMaskCreditId(5.01)).toBe("sam-3-video:10s")
  })

  it("the last row covers exactly the longest clip a run accepts", () => {
    const ids = videoMaskCreditIds()
    expect(ids.at(-1)).toBe(`sam-3-video:${VIDEO_MASK_LIMITS.MAX_BILLED_SEC}s`)
  })

  it("the doc's price table names every row", () => {
    const doc = readFileSync(resolve(__dirname, "../../../../docs/nodes/ai-video/video-mask.md"), "utf8")
    for (const id of videoMaskCreditIds()) expect(doc).toContain(`\`${id}\``)
  })

  it("narrows unknown providers to the default", () => {
    expect(resolveVideoMaskProvider("sam-3")).toBe("sam-3")
    expect(resolveVideoMaskProvider("sam-9")).toBe("sam-3")
    expect(resolveVideoMaskProvider(undefined)).toBe("sam-3")
  })
})
