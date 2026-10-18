/**
 * What a run of UGC Clip renders when its UGC Clips does not run (`@nodaro/render-rules`
 * ugc-clip-reuse): the saved clips, each CLAIMED as handed back only where the node's own record of
 * its last batch shows a take of exactly that clip, made at the Re-render count the run sends, by a
 * job it names, with no Re-render pressed since — everything else renders, at full price. (The
 * quote checks each claim against the caller's own jobs: ugc-clip-reuse-check.test.ts.) And where
 * the run's parts carry it (`ugcEstimateRunParts`).
 */
import { describe, expect, it } from "vitest"
import { ugcClipTicketQuote, ugcEstimateRunParts, ugcReusedClips } from "@nodaro/render-rules"

const T = (index: number, line = `line ${index}`) => JSON.stringify({ v: 1, index, durationSec: 8, line, video: { tool: "generate_video", args: {} } })
const TICKETS = [T(0), T(1), T(2)]
const PLAN = JSON.stringify({ v: 1, plan: {}, transcribeArgs: {} })
const LANE_PLAN = JSON.stringify({ v: 1, plan: {}, transcribeArgs: {}, finish: { segments: [] } })
const clipsData = (over: Record<string, unknown> = {}) => ({ __listResults: TICKETS, ugcOutputs: { "plan-out": PLAN }, ...over })
/** A take's job (a uuid, as the clip route makes them), by its url. */
const jobOf = (url: string) => `00000000-0000-4000-8000-${url.replace(/\D/g, "").padStart(12, "0")}`
/** The node's last batch: the tickets it ran on and the take each made ("" for a row that failed), each take naming its job and count. */
const batch = (inputs: string[], takes: string[], over: Record<string, unknown> = {}, nonce = 0) => ({
  rerender: {},
  __listInputs: inputs,
  __listResults: takes,
  generatedResults: takes.filter(Boolean).map((url) => ({ url, jobId: jobOf(url), timestamp: "t", ugcClipNonce: nonce })),
  ...over,
})
const claim = (clip: number, url: string, nonce = 0) => ({ clip, jobId: jobOf(url), nonce })

describe("the clips a run of UGC Clip hands back", () => {
  it("a take of exactly that clip, no Re-render since: handed back; a row that failed renders", () => {
    const r = ugcReusedClips(TICKETS, batch(TICKETS, ["https://cdn/c0.mp4", "", "https://cdn/c2.mp4"]))
    expect(r).toEqual({ reusedClips: [claim(1, "https://cdn/c0.mp4"), claim(3, "https://cdn/c2.mp4")], reuseKnown: true })
  })

  it("claimed only at the Re-render count the run sends: a take made at another count (an undo, a press a server run landed over) is not", () => {
    const takes = ["https://cdn/c0.mp4", "https://cdn/c1.mp4", "https://cdn/c2.mp4"]
    // The takes were made at count 0; clip 2 now sends 1, with no mark left on it.
    const moved = ugcReusedClips(TICKETS, batch(TICKETS, takes, { rerender: { "2": 1 } }))
    expect(moved.reusedClips.map((c) => c.clip)).toEqual([1, 3])
    // The run may still get clip 2 back (an older take at count 1): not accounted for.
    expect(moved.reuseKnown).toBe(false)
    // Made at count 2 and sending 2: claimed with that count.
    const at2 = ugcReusedClips(TICKETS, batch(TICKETS, takes, { rerender: { "1": 2, "2": 2, "3": 2 } }, 2))
    expect(at2.reusedClips).toEqual([claim(1, takes[0]!, 2), claim(2, takes[1]!, 2), claim(3, takes[2]!, 2)])
  })

  it("a take that names no job or count (a reload lane's, a server run's, an older editor's) is not claimed", () => {
    const takes = ["https://cdn/c0.mp4", "", ""]
    const noCount = batch(TICKETS, takes, { generatedResults: [{ url: takes[0], jobId: jobOf(takes[0]!), timestamp: "t" }] })
    expect(ugcReusedClips(TICKETS, noCount)).toEqual({ reusedClips: [], reuseKnown: false })
    const syntheticId = batch(TICKETS, takes, { generatedResults: [{ url: takes[0], jobId: "iter-run-0", timestamp: "t", ugcClipNonce: 0 }] })
    expect(ugcReusedClips(TICKETS, syntheticId).reusedClips).toEqual([])
  })

  it("a clip pressed for Re-render renders, whatever take it holds", () => {
    const r = ugcReusedClips(TICKETS, batch(TICKETS, ["https://cdn/c0.mp4", "https://cdn/c1.mp4", "https://cdn/c2.mp4"], { rerender: { "2": 1 }, rerenderPending: { "2": true } }))
    expect(r.reusedClips.map((c) => c.clip)).toEqual([1, 3])
    expect(r.reuseKnown).toBe(true)
  })

  it("a ticket that changed renders: its line, or a new script's clips", () => {
    const changed = [T(0), T(1, "a new line"), T(2)]
    expect(ugcReusedClips(changed, batch(TICKETS, ["https://cdn/c0.mp4", "https://cdn/c1.mp4", "https://cdn/c2.mp4"])).reusedClips.map((c) => c.clip)).toEqual([1, 3])
    // A take whose ticket is no clip the run renders is a take it does not account for.
    expect(ugcReusedClips(changed, batch(TICKETS, ["https://cdn/c0.mp4", "https://cdn/c1.mp4", "https://cdn/c2.mp4"])).reuseKnown).toBe(false)
  })

  it("matched by the ticket itself, never by place: a reordered batch still hands its takes back", () => {
    const r = ugcReusedClips(TICKETS, batch([T(2), T(0), T(1)], ["https://cdn/c2.mp4", "https://cdn/c0.mp4", ""]))
    expect(r).toEqual({ reusedClips: [claim(1, "https://cdn/c0.mp4"), claim(3, "https://cdn/c2.mp4")], reuseKnown: true })
  })

  it("no record of the batch (a single run, a server run's takes, a record cleared at a run's start): nothing handed back, and a take held is not accounted for", () => {
    expect(ugcReusedClips(TICKETS, { rerender: {}, __listResults: ["https://cdn/c0.mp4"] })).toEqual({ reusedClips: [], reuseKnown: false })
    expect(ugcReusedClips(TICKETS, { rerender: {}, generatedVideoUrl: "https://cdn/c0.mp4" })).toEqual({ reusedClips: [], reuseKnown: false })
    expect(ugcReusedClips(TICKETS, batch(TICKETS, ["https://cdn/c0.mp4"]))).toEqual({ reusedClips: [], reuseKnown: false })
    // A node that never rendered: nothing to hand back, and nothing unaccounted for.
    expect(ugcReusedClips(TICKETS, { rerender: {} })).toEqual({ reusedClips: [], reuseKnown: true })
  })
})

describe("the ticket quote a run of UGC Clip is priced by", () => {
  it("the saved tickets, the clips handed back and the finish call of the saved plan", () => {
    const clip = batch(TICKETS, ["https://cdn/c0.mp4", "", ""])
    expect(ugcClipTicketQuote(clipsData(), clip)).toEqual({ tickets: TICKETS, reusedClips: [claim(1, "https://cdn/c0.mp4")], finishes: false, reuseKnown: true })
    expect(ugcClipTicketQuote(clipsData({ ugcOutputs: { "plan-out": LANE_PLAN } }), clip)?.finishes).toBe(true)
  })

  it("saved clips it cannot read: none (the run is priced as one that renders every clip)", () => {
    const clip = batch(TICKETS, ["", "", ""])
    for (const bad of [{}, { __listResults: [] }, { __listResults: ["not json"] }, { __listResults: Array.from({ length: 12 }, (_, i) => T(i)) }]) {
      expect(ugcClipTicketQuote({ ...bad, ugcOutputs: { "plan-out": PLAN } }, clip)).toBeNull()
    }
    // A plan it cannot read: whether the clips go through the finish is unknown.
    expect(ugcClipTicketQuote(clipsData({ ugcOutputs: {} }), clip)).toBeNull()
    expect(ugcClipTicketQuote(clipsData({ ugcOutputs: { "plan-out": "{" } }), clip)).toBeNull()
  })
})

describe("a run's parts carry it only where the clips are fixed", () => {
  type N = { id: string; type: string; data: Record<string, unknown> }
  const nodes: N[] = [
    { id: "script", type: "ugc-script", data: { targetDurationSec: 20 } },
    { id: "creator", type: "ugc-creator", data: { source: "sampled" } },
    { id: "clips", type: "ugc-clips", data: clipsData() },
    { id: "clip", type: "ugc-clip", data: batch(TICKETS, ["https://cdn/c0.mp4", "", ""]) },
  ]
  const edges = [
    { source: "script", target: "clips", targetHandle: "plan", sourceHandle: "plan" },
    { source: "creator", target: "clips", targetHandle: "creator", sourceHandle: "creator" },
    { source: "clips", target: "clip", targetHandle: "clip", sourceHandle: "clips" },
  ]
  const clipNode = (run: string[]) => ugcEstimateRunParts(nodes.filter((x) => run.includes(x.id)), nodes, edges)?.chains[0]?.nodes.find((m) => m.id === "clip")

  it("a run of UGC Clip alone (its UGC Clips does not run): priced from the saved clips", () => {
    expect(clipNode(["clip"])?.ticketQuote).toEqual({ tickets: TICKETS, reusedClips: [claim(1, "https://cdn/c0.mp4")], finishes: false, reuseKnown: true })
  })

  it("a run that runs UGC Clips makes new clips: priced from the estimate, as before", () => {
    expect(clipNode(["clips", "clip"])).toBeDefined()
    expect(clipNode(["clips", "clip"])).not.toHaveProperty("ticketQuote")
    expect(clipNode(["script", "creator", "clips", "clip"])).not.toHaveProperty("ticketQuote")
  })
})
