import { describe, expect, it } from "vitest"
import { VIDEO_PRODUCER_TYPES } from "@nodaro/shared"
import { resolveNodeInputs } from "../input-resolver.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"

const node = (id: string, type: string, data: Record<string, unknown> = {}): SimpleNode => ({ id, type, data: { label: id, ...data } })
const edge = (source: string, target: string, sourceHandle: string, targetHandle: string, data?: Record<string, unknown>): SimpleEdge =>
  ({ id: `${source}->${target}:${targetHandle}`, source, target, sourceHandle, targetHandle, ...(data ? { data } : {}) })
const clip = node("clip", "ugc-clip", { rerender: {} })
// `ugc-clip` joins VIDEO_PRODUCER_TYPES when the UGC nodes register (Task C1); until then
// the resolver routes an unregistered source's list through the text path, which is not the
// order this proves. A registered video producer stands in, and the test switches itself.
const ORDER_SOURCE = VIDEO_PRODUCER_TYPES.has("ugc-clip") ? "ugc-clip" : "generate-video"
const join = node("join", "combine-videos", { transition: "cut" })
const cards = node("cards", "ugc-cards")
const ALL = [clip, join, cards]
const ORDER_ALL = [node("clip", ORDER_SOURCE, { rerender: {} }), join, cards]
const FANNED: Record<string, NodeExecutionState> = {
  clip: {
    status: "completed",
    output: {
      listResults: ["https://cdn.example/1.mp4", "https://cdn.example/2.mp4"],
      listResultMeta: [{ warnings: [], durationSec: 12 }, { warnings: ["clip_lengthened:16"], durationSec: 16 }],
    },
  },
}

describe("UGC Clip's fan-in (spec §6.4.1, §6.4.3)", () => {
  it("an all edge into combine-videos routes the clips in list (index) order", () => {
    const r = resolveNodeInputs(join, [edge("clip", "join", "video-out", "in", { outputMode: "all" })], FANNED, ORDER_ALL)
    expect(r.videoUrls).toEqual(["https://cdn.example/1.mp4", "https://cdn.example/2.mp4"])
  })
  it("an all edge into ugc-cards.notes routes the notes, never the URLs", () => {
    const r = resolveNodeInputs(cards, [edge("clip", "cards", "video-out", "notes", { outputMode: "all" })], FANNED, ALL)
    expect(r.clipNotes).toEqual([{ clip: 1, warnings: [], durationSec: 12 }, { clip: 2, warnings: ["clip_lengthened:16"], durationSec: 16 }])
    expect(r.videoUrls).toBeUndefined()
    expect(r.videoUrl).toBeUndefined()
  })
  it("a single (non-fan-out) ugc-clip output yields one notes row", () => {
    const single: Record<string, NodeExecutionState> = {
      clip: { status: "completed", output: { videoUrl: "https://cdn.example/1.mp4", clipWarnings: ["frame_check_failed"], durationSec: 9 } },
    }
    const r = resolveNodeInputs(cards, [edge("clip", "cards", "video-out", "notes", { outputMode: "all" })], single, ALL)
    expect(r.clipNotes).toEqual([{ clip: 1, warnings: ["frame_check_failed"], durationSec: 9 }])
  })
})
