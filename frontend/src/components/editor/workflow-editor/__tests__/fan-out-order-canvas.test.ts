import { describe, expect, it } from "vitest"
import { resolveNodeInputs } from "../node-input-resolver"

const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as never
const edge = (source: string, target: string, sourceHandle: string, targetHandle: string) =>
  ({ id: `${source}->${target}:${targetHandle}`, source, target, sourceHandle, targetHandle, data: { outputMode: "all" } }) as never
const join = node("join", "combine-videos", { transition: "cut" })
const cards = node("cards", "ugc-cards")
const fanned = node("clip", "ugc-clip", {
  rerender: {},
  __listResults: ["https://cdn.example/1.mp4", "https://cdn.example/2.mp4"],
  __listResultMeta: [{ warnings: [], durationSec: 12 }, { warnings: ["clip_lengthened:16"], durationSec: 16 }],
})

describe("UGC Clip's fan-in on the canvas (spec §6.4.1, §6.4.3)", () => {
  it("an all edge into combine-videos routes the clips in list order", () => {
    const r = resolveNodeInputs(join, [fanned, join, cards], [edge("clip", "join", "video-out", "in")])
    expect(r.videoUrls).toEqual(["https://cdn.example/1.mp4", "https://cdn.example/2.mp4"])
  })
  it("an all edge into ugc-cards.notes routes the notes, never the URLs", () => {
    const r = resolveNodeInputs(cards, [fanned, join, cards], [edge("clip", "cards", "video-out", "notes")])
    expect(r.clipNotes).toEqual([{ clip: 1, warnings: [], durationSec: 12 }, { clip: 2, warnings: ["clip_lengthened:16"], durationSec: 16 }])
    expect(r.videoUrls).toBeUndefined()
  })
  it("a single run's data yields one notes row", () => {
    const single = node("clip", "ugc-clip", { rerender: {}, generatedVideoUrl: "https://cdn.example/1.mp4", clipWarnings: ["frame_check_failed"], durationSec: 9 })
    const r = resolveNodeInputs(cards, [single, cards], [edge("clip", "cards", "video-out", "notes")])
    expect(r.clipNotes).toEqual([{ clip: 1, warnings: ["frame_check_failed"], durationSec: 9 }])
  })
})
