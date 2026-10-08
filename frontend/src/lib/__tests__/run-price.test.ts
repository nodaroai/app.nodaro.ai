/**
 * The app runner's Run button price (decided 2026-10-07): before the app's
 * recording is chosen it shows the listing, fixed + per minute ("82 + 14/min");
 * once one is chosen and its length is known, the exact figure for that
 * length. The gate keeps the live estimate either way.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/components/editor/config-panels/helpers", () => ({
  getModelIdentifier: (n: { type?: string }) => n.type ?? "",
}))

import { appRunListedPrice, chosenRecordingUrl, recordingLengthPending, runCostLabel } from "../run-price"
import { applyRunInputValues, computeLiveRunEstimate } from "@/hooks/use-live-run-estimate"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { extractVideoDurationFromNode } from "@nodaro/shared"

const n = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as WorkflowNode
const e = (source: string, target: string, targetHandle: string): WorkflowEdge =>
  ({ id: `${source}-${target}`, source, target, targetHandle }) as WorkflowEdge

const plus = (k: number) => `+ ${k}/min`
const LISTING = { fixed: 82, perMinute: 14 }

describe("runCostLabel", () => {
  it("before a recording is chosen: the listing, fixed + per minute", () => {
    expect(runCostLabel({ exact: 2602, listing: LISTING, pending: true, plusPerMinute: plus })).toBe(" (82 CR + 14/min)")
  })
  it("once a recording with a known length is chosen: the exact figure", () => {
    expect(runCostLabel({ exact: 712, listing: LISTING, pending: false, plusPerMinute: plus })).toBe(" (712 CR)")
  })
  it("a listing with no per-minute part: the exact figure, as before", () => {
    expect(runCostLabel({ exact: 40, listing: { fixed: 40, perMinute: 0 }, pending: true, plusPerMinute: plus })).toBe(" (40 CR)")
    expect(runCostLabel({ exact: 40, listing: null, pending: true, plusPerMinute: plus })).toBe(" (40 CR)")
  })
  it("nothing to show: no label", () => {
    expect(runCostLabel({ exact: 0, listing: null, pending: false, plusPerMinute: plus })).toBe("")
  })
})

describe("appRunListedPrice — the Run button lists the app run alone (review round F4)", () => {
  // A Proxy app: the run 38 + 8/min (with the fee), its Render final 40 + 10/min.
  const app = { estimatedCredits: 78, perMinuteCredits: 18, runEstimatedCredits: 38, runPerMinuteCredits: 8 }
  it("leaves the Render final part out, which is run and charged separately", () => {
    expect(appRunListedPrice(app)).toEqual({ fixed: 38, perMinute: 8, perItem: 0 })
    expect(runCostLabel({ exact: 400, listing: appRunListedPrice(app), pending: true, plusPerMinute: plus })).toBe(" (38 CR + 8/min)")
  })
  it("a server that sends no run pair yet: the full listing (never under-quotes)", () => {
    expect(appRunListedPrice({ estimatedCredits: 78, perMinuteCredits: 18 })).toEqual({ fixed: 78, perMinute: 18, perItem: 0 })
    expect(appRunListedPrice({ estimatedCredits: undefined, perMinuteCredits: undefined })).toEqual({ fixed: 0, perMinute: 0, perItem: 0 })
  })
})

// A List the app's user fills (decided 2026-10-07): the listing adds a figure
// per item beyond the saved count. While the label shows the listing it shows
// that too; once the exact figure shows, the live estimate counts the items.
describe("the per-item part", () => {
  const perItem = (k: number) => `+ ${k}/item`
  it("the run's own per-item part, else the listed one", () => {
    expect(appRunListedPrice({ estimatedCredits: 78, perMinuteCredits: 18, perItemCredits: 49, runEstimatedCredits: 38, runPerMinuteCredits: 8, runPerItemCredits: 45 })).toEqual({ fixed: 38, perMinute: 8, perItem: 45 })
    expect(appRunListedPrice({ estimatedCredits: 78, perItemCredits: 49 })).toEqual({ fixed: 78, perMinute: 0, perItem: 49 })
  })
  it("the listing label shows it after the per-minute part", () => {
    expect(runCostLabel({ exact: 400, listing: { fixed: 38, perMinute: 8, perItem: 45 }, pending: true, plusPerMinute: plus, plusPerItem: perItem })).toBe(" (38 CR + 8/min + 45/item)")
  })
  it("the exact figure needs none", () => {
    expect(runCostLabel({ exact: 400, listing: { fixed: 38, perMinute: 8, perItem: 45 }, pending: false, plusPerMinute: plus, plusPerItem: perItem })).toBe(" (400 CR)")
  })
})

describe("recordingLengthPending", () => {
  const video = n("v", "upload-video", { url: "https://cdn/sample.mp4", duration: 600 })
  const text = n("t", "text-prompt")
  it("no recording chosen yet (the creator's sample is not the user's)", () => {
    expect(recordingLengthPending([video, text], {}, new Map())).toBe(true)
  })
  it("chosen, length not known yet", () => {
    expect(recordingLengthPending([video], { v: { url: "https://cdn/mine.mp4" } }, new Map())).toBe(true)
  })
  it("chosen, length known", () => {
    expect(recordingLengthPending([video], { v: { url: "https://cdn/mine.mp4" } }, new Map([["https://cdn/mine.mp4", 2700]]))).toBe(false)
  })
  it("an app with no recording input", () => {
    expect(recordingLengthPending([text], {}, new Map())).toBe(false)
  })
})

describe("the live estimate prices a chosen recording at its own length", () => {
  const PRICES: Record<string, number> = { transcribe: 10, "edit-plan": 240, "apply-edl": 10 }
  const master = n("m", "upload-audio", { url: "https://cdn/sample.mp3", metadata: { durationSeconds: 600, mediaUrl: "https://cdn/sample.mp3" } })
  const nodes = [master, n("tr", "transcribe"), n("ep", "edit-plan", { mode: "tighten" }), n("ae", "apply-edl")]
  const edges = [e("m", "tr", "audio"), e("m", "ep", "sources"), e("tr", "ep", "transcript"), e("ep", "ae", "edl")]
  const price = (id: string) => PRICES[id]

  it("a chosen recording whose length was read: the render for that length", () => {
    const total = computeLiveRunEstimate(
      { nodes, edges, inputValues: { m: { url: "https://cdn/mine.mp3" } }, mediaLengths: new Map([["https://cdn/mine.mp3", 45 * 60]]) },
      price,
    ).total
    expect(total).toBe(10 + 240 + 10 * 45)
  })
  it("the length read for another file never prices this one (it is priced at the longest recording)", () => {
    const merged = applyRunInputValues(nodes, { m: { url: "https://cdn/mine.mp3" } }, new Map([["https://cdn/other.mp3", 60]]))
    expect((merged[0]!.data as Record<string, unknown>).metadata).toEqual({ durationSeconds: 180 * 60, mediaUrl: "https://cdn/mine.mp3" })
  })
  it("a creator's saved length on the node is dropped with the swap", () => {
    const video = n("m", "upload-video", { url: "https://cdn/sample.mp4", duration: 600, generatedResults: [{ url: "https://cdn/sample.mp4", duration: 600 }] })
    const total = computeLiveRunEstimate({ nodes: [video, ...nodes.slice(1)], edges, inputValues: { m: { url: "https://cdn/mine.mp4" } } }, price).total
    expect(total).toBe(10 + 240 + 10 * 180)
  })
  it("every length reader sees the length read for the chosen file (a Trim or Combine after it too)", () => {
    const video = n("v", "upload-video", { url: "https://cdn/sample.mp4", duration: 600 })
    const [merged] = applyRunInputValues([video], { v: { url: "https://cdn/mine.mp4" } }, new Map([["https://cdn/mine.mp4", 95]]))
    expect(extractVideoDurationFromNode(merged!.data as Record<string, unknown>)).toBe(95)
  })
})

// Review round F2 (decided 2026-10-07): a chosen recording whose length is not
// known (unreadable in the browser, or the read still pending) is priced at the
// longest recording (decision #3) by EVERY length-priced node, not only Edit
// Plan and Apply EDL. A Trim, Loop or Combine used to fall to the 8-second
// fallback, so the gate let a run start that the server then refused mid-run,
// after Transcribe and Edit Plan were charged.
describe("an unknown chosen length is the longest recording for every length reader", () => {
  const MAX_SEC = 180 * 60
  const video = n("v", "upload-video", { url: "https://cdn/sample.mp4", duration: 600 })
  const trim = n("t", "trim-video", { trimMode: "seconds", trimStartSeconds: 0, trimEndSeconds: 0 })
  const edges = [e("v", "t", "video")]
  const PRICE: Record<string, number> = { "trim-video": 10 }
  const price = (id: string) => PRICE[id]
  const chosen = { v: { url: "https://cdn/mine.mkv" } }

  it("a Trim on the recording is priced at 180 minutes, not 8 seconds", () => {
    const unknown = computeLiveRunEstimate({ nodes: [video, trim], edges, inputValues: chosen, mediaLengths: new Map() }, price).total
    const atMax = computeLiveRunEstimate({ nodes: [video, trim], edges, inputValues: chosen, mediaLengths: new Map([["https://cdn/mine.mkv", MAX_SEC]]) }, price).total
    expect(unknown).toBe(atMax)
    expect(unknown).toBe(10 * Math.ceil(MAX_SEC / 5))
  })

  it("both length fields read the maximum, bound to the chosen url", () => {
    const [merged] = applyRunInputValues([video], chosen)
    const data = merged!.data as Record<string, unknown>
    expect(extractVideoDurationFromNode(data)).toBe(MAX_SEC)
    expect(data.metadata).toEqual({ durationSeconds: MAX_SEC, mediaUrl: "https://cdn/mine.mkv" })
  })

  it("a length read later replaces it", () => {
    const [merged] = applyRunInputValues([video], chosen, new Map([["https://cdn/mine.mkv", 95]]))
    expect(extractVideoDurationFromNode(merged!.data as Record<string, unknown>)).toBe(95)
  })
})

// Review round (decided 2026-10-07): a Video URL node the app exposes is the
// replaced recording, exactly as an upload is. Its file (or a direct link) is
// what is measured; a post link with no file yet has no length to read.
describe("a Video URL input is a recording input", () => {
  const MAX_SEC = 180 * 60
  const FILE = "https://cdn.nodaro.ai/downloads/ep.mp4"
  const POST = "https://www.youtube.com/watch?v=abc123def45"
  const sample = n("y", "youtube-video", { youtubeUrl: "https://www.youtube.com/watch?v=creator0001", downloadedVideoUrl: "https://cdn/sample.mp4", downloadedFromUrl: "https://www.youtube.com/watch?v=creator0001", videoDurationSec: 600 })

  describe("chosenRecordingUrl", () => {
    it("a post link with its downloaded file: the file", () => {
      expect(chosenRecordingUrl(sample, { y: { youtubeUrl: POST, downloadedVideoUrl: FILE, downloadedFromUrl: POST } })).toBe(FILE)
    })
    it("a file that belongs to another link is not this link's", () => {
      expect(chosenRecordingUrl(sample, { y: { youtubeUrl: POST, downloadedVideoUrl: FILE, downloadedFromUrl: "https://youtu.be/other000000" } })).toBeUndefined()
    })
    it("a direct file link: the link itself, trimmed", () => {
      expect(chosenRecordingUrl(sample, { y: { youtubeUrl: ` ${FILE} ` } })).toBe(FILE)
    })
    it("a post link with no file yet, an empty or an invalid link: nothing yet", () => {
      expect(chosenRecordingUrl(sample, { y: { youtubeUrl: POST } })).toBeUndefined()
      expect(chosenRecordingUrl(sample, { y: { youtubeUrl: "" } })).toBeUndefined()
      expect(chosenRecordingUrl(sample, { y: { youtubeUrl: "not a link" } })).toBeUndefined()
      expect(chosenRecordingUrl(sample, {})).toBeUndefined()
    })
  })

  describe("recordingLengthPending", () => {
    it("holds the listing until a file exists and its length is read", () => {
      expect(recordingLengthPending([sample], {}, new Map())).toBe(true)
      expect(recordingLengthPending([sample], { y: { youtubeUrl: POST } }, new Map())).toBe(true)
      expect(recordingLengthPending([sample], { y: { youtubeUrl: POST, downloadedVideoUrl: FILE, downloadedFromUrl: POST } }, new Map())).toBe(true)
    })
    it("releases it once the file's length is known", () => {
      expect(recordingLengthPending([sample], { y: { youtubeUrl: POST, downloadedVideoUrl: FILE, downloadedFromUrl: POST } }, new Map([[FILE, 2700]]))).toBe(false)
      expect(recordingLengthPending([sample], { y: { youtubeUrl: FILE } }, new Map([[FILE, 2700]]))).toBe(false)
    })
  })

  describe("the live estimate", () => {
    const PRICES: Record<string, number> = { transcribe: 10, "edit-plan": 240, "apply-edl": 10 }
    const nodes = [sample, n("tr", "transcribe"), n("ep", "edit-plan", { mode: "tighten" }), n("ae", "apply-edl")]
    const edges = [e("y", "tr", "audio"), e("y", "ep", "sources"), e("tr", "ep", "transcript"), e("ep", "ae", "edl")]
    const price = (id: string) => PRICES[id]
    const mine = { y: { youtubeUrl: POST, downloadedVideoUrl: FILE, downloadedFromUrl: POST } }

    it("prices the episode at the length read for its file", () => {
      const total = computeLiveRunEstimate({ nodes, edges, inputValues: mine, mediaLengths: new Map([[FILE, 45 * 60]]) }, price).total
      expect(total).toBe(10 + 240 + 10 * 45)
    })
    it("a length not read yet is the longest recording, never the creator's sample length", () => {
      const [merged] = applyRunInputValues(nodes, mine)
      const data = merged!.data as Record<string, unknown>
      expect(extractVideoDurationFromNode(data)).toBe(MAX_SEC)
      expect(data.videoDurationSec).toBeUndefined()
      expect(data.metadata).toEqual({ durationSeconds: MAX_SEC, mediaUrl: FILE })
    })
    it("a Trim after the episode is priced at the longest recording, not 8 seconds", () => {
      const trim = n("t", "trim-video", { trimMode: "seconds", trimStartSeconds: 0, trimEndSeconds: 0 })
      const total = computeLiveRunEstimate({ nodes: [sample, trim], edges: [e("y", "t", "video")], inputValues: mine, mediaLengths: new Map() }, (id) => (id === "trim-video" ? 10 : undefined)).total
      expect(total).toBe(10 * Math.ceil(MAX_SEC / 5))
    })
    it("a direct file link is measured by the link itself", () => {
      const [merged] = applyRunInputValues(nodes, { y: { youtubeUrl: FILE } }, new Map([[FILE, 95]]))
      expect(extractVideoDurationFromNode(merged!.data as Record<string, unknown>)).toBe(95)
    })
    it("the creator's own link and file leave their saved length alone", () => {
      const [merged] = applyRunInputValues(nodes, { y: { youtubeUrl: "https://www.youtube.com/watch?v=creator0001" } })
      expect((merged!.data as Record<string, unknown>).videoDurationSec).toBe(600)
    })
  })
})
