/**
 * A Video URL node a published app exposes is the recording its user replaces
 * with their own episode (decided 2026-10-07): the listing prices the steps
 * that follow it per minute of the episode, like an exposed upload, and never
 * on the creator's sample link.
 */
import { describe, it, expect } from "vitest"
import { CreditsService } from "../credits.js"

type N = { id: string; type: string; data?: Record<string, unknown> }
type E = { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }

const link = (data: Record<string, unknown> = {}): N => ({ id: "rec", type: "youtube-video", data: { youtubeUrl: "https://youtu.be/AAAAAAAAAAA", ...data } })
const upload = (data: Record<string, unknown> = {}): N => ({ id: "rec", type: "upload-video", data: { url: "https://cdn/sample.mp4", ...data } })
const trim: N = { id: "op", type: "trim-video", data: { trimMode: "smart-loop-cut" } }
const edges: E[] = [{ source: "rec", target: "op", targetHandle: "video" }]
const listingOf = (nodes: N[], replaced: boolean) =>
  CreditsService.estimateWorkflowBaseListing(nodes, edges, "app", { replaceableMediaNodeIds: new Set(replaced ? ["rec"] : []) })

describe("a Video URL node the app's user replaces", () => {
  it("lists a length-priced step after it per minute, exactly as an exposed upload does", () => {
    const asLink = listingOf([link({ videoDurationSec: 8 }), trim], true)
    expect(asLink.previewPerMinute).toBeGreaterThan(0)
    expect(asLink).toEqual(listingOf([upload({ duration: 8 }), trim], true))
  })

  it("the creator's sample length is not the user's: an hour-long sample lists like an 8-second one", () => {
    expect(listingOf([link({ videoDurationSec: 3600 }), trim], true)).toEqual(listingOf([link({ videoDurationSec: 8 }), trim], true))
  })

  it("a Video URL the user cannot replace keeps its own known length, fixed", () => {
    const known = listingOf([link({ videoDurationSec: 600 }), trim], false)
    expect(known.previewPerMinute).toBe(0)
    expect(known).toEqual(listingOf([upload({ duration: 600 }), trim], false))
  })
})
