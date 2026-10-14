/**
 * A Dubbing is charged per started minute of its span. On a recording the
 * app's user or a template's cloner replaces, that length is not known when the
 * listing is priced, so the listing follows the platform's length rules: the
 * episode recording per minute of the episode, never below what a run of a
 * recording that long is charged (the 30-minute cap included); a recording the
 * user cannot replace at its own length; and a Start/End window caps each, as it
 * caps the run. Compared at `STATIC_CREDIT_COSTS`' base prices, the dubbing
 * route's own formula (row × started minutes).
 */
import { describe, it, expect } from "vitest"
import { CreditsService, STATIC_CREDIT_COSTS } from "../credits.js"

type N = { id: string; type: string; data?: Record<string, unknown> }
type E = { source: string; target: string; targetHandle?: string | null }

const upload = (duration?: number): N => ({ id: "rec", type: "upload-video", data: { url: "https://cdn/sample.mp4", ...(duration ? { duration } : {}) } })
const dub = (data: Record<string, unknown> = {}): N => ({ id: "op", type: "dubbing", data: { targetLanguage: "es", ...data } })
const fromRec: E[] = [{ source: "rec", target: "op", targetHandle: "video" }]
const listingOf = (nodes: N[], edges: E[], replaced: boolean) =>
  CreditsService.estimateWorkflowBaseListing(nodes, edges, "app", { replaceableMediaNodeIds: new Set(replaced ? ["rec"] : []) })
const at = (l: { preview: number; previewPerMinute: number }, minutes: number) => l.preview + l.previewPerMinute * minutes
/** The route's base for a span: the per-minute row × its started minutes, at most 30. */
const charged = (sec: number, rate = "elevenlabs-dubbing") => STATIC_CREDIT_COSTS[rate]! * Math.min(30, Math.max(1, Math.ceil(sec / 60)))

describe("a Dubbing in a listing", () => {
  it("on the replaced episode recording: per minute, never below the charge", () => {
    const l = listingOf([upload(8), dub()], fromRec, true)
    expect(l.previewPerMinute).toBeGreaterThan(0)
    for (const m of [1, 2, 3, 7, 29, 30, 31, 45, 180]) {
      for (const sec of [m * 60, m * 60 - 59]) expect(at(l, m), `${m} min (${sec}s)`).toBeGreaterThanOrEqual(charged(sec))
    }
  })

  it("the sample's length is not the user's: an hour-long sample lists like an 8-second one", () => {
    expect(listingOf([upload(3600), dub()], fromRec, true)).toEqual(listingOf([upload(8), dub()], fromRec, true))
  })

  it("on a recording the user cannot replace: its own length, fixed", () => {
    const l = listingOf([upload(290), dub()], fromRec, false)
    expect(l.previewPerMinute).toBe(0)
    expect(l.preview).toBe(charged(290))
  })

  it("a Start/End window caps the span on any recording", () => {
    const l = listingOf([upload(8), dub({ startTime: 0, endTime: 130 })], fromRec, true)
    expect(at(l, 180)).toBe(charged(130))
  })

  it("on a second recording the user replaces beside the episode (an intro card): the 30-minute price, fixed — the most a dub is charged", () => {
    const nodes: N[] = [
      { id: "rec", type: "upload-video", data: {} },
      { id: "card", type: "upload-video", data: { duration: 8 } },
      { id: "stt", type: "transcribe", data: { provider: "elevenlabs-stt" } },
      dub(),
    ]
    const edges: E[] = [
      { source: "rec", target: "stt", targetHandle: "audio" },
      { source: "card", target: "op", targetHandle: "video" },
    ]
    const l = CreditsService.estimateWorkflowBaseListing(nodes, edges, "template")
    const withoutOp = CreditsService.estimateWorkflowBaseListing(nodes.slice(0, 3), edges.slice(0, 1), "template")
    expect(l.preview - withoutOp.preview).toBe(charged(30 * 60))
    expect(l.previewPerMinute).toBe(withoutOp.previewPerMinute)
  })

  it("Hebrew on the project API's row", () => {
    const l = listingOf([upload(290), dub({ targetLanguage: "he" })], fromRec, false)
    expect(l.preview).toBe(charged(290, "elevenlabs-dubbing-v2"))
  })
})
