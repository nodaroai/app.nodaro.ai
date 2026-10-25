/**
 * What an app run's Retry costs (`appRunResumeCredits`): only the steps it runs. A UGC Clip whose
 * clips are fixed (UGC Clips completed in the failed run) is priced from those tickets, and the
 * clips the failed run finished are free only when the check against the runner's own jobs holds
 * them, under the run's chain root.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  rest: vi.fn(),
  estimate: vi.fn(),
  quote: vi.fn(),
  verify: vi.fn(),
}))
vi.mock("../../billing/credits.js", () => ({ estimateRunSetCreditsWithoutUgc: h.rest }))
vi.mock("../ugc-estimate.js", () => ({ estimateUgcRun: h.estimate, quoteUgcTickets: h.quote }))
vi.mock("../ugc-clip-reuse-check.js", () => ({ verifiedReusedClips: h.verify }))

import { ugcChains } from "@nodaro/render-rules"
import { appRunResumeCredits } from "../app-run-resume-price.js"

const T = (i: number) => JSON.stringify({ v: 1, index: i, durationSec: 8, video: { tool: "generate_video", args: {} } })
const TICKETS = [T(0), T(1), T(2)]
const PLAN = JSON.stringify({ v: 1, plan: {}, transcribeArgs: {} })
const nodes = [
  { id: "script", type: "ugc-script", data: { targetDurationSec: 20 } },
  { id: "creator", type: "ugc-creator", data: { source: "sampled" } },
  { id: "clips", type: "ugc-clips", data: {} },
  { id: "clip", type: "ugc-clip", data: { rerender: { "2": 1 } } },
  { id: "join", type: "combine-videos", data: {} },
]
const edges = [
  { source: "script", target: "clips", sourceHandle: "plan", targetHandle: "plan" },
  { source: "creator", target: "clips", sourceHandle: "creator", targetHandle: "creator" },
  { source: "clips", target: "clip", sourceHandle: "clips", targetHandle: "clip" },
  { source: "clip", target: "join", sourceHandle: "video-out", targetHandle: "videos", data: { outputMode: "bundle" } },
]
const PARTS = { script: 10, creator: 20, clip: 900, cards: 0, join: 7, overlay: 0, captions: 0 }
const HOLD = { ...PARTS, clip: 1800 }
/** The failed run: script, creator and clips completed; UGC Clip failed on clip 2, clips 1 and 3 finished. */
const sourceStates = {
  script: { status: "completed", output: {} },
  creator: { status: "completed", output: {} },
  clips: { status: "completed", output: { listResults: TICKETS, ugcOutputs: { "plan-out": PLAN } } },
  clip: { status: "failed", jobIds: ["job-c3", "job-c1"], jobRows: [2, 0] },
  join: { status: "skipped" },
}
const caller = { userId: "runner-1" }

beforeEach(() => {
  vi.clearAllMocks()
  h.rest.mockResolvedValue(50)
  h.estimate.mockResolvedValue({ parts: PARTS, holdParts: HOLD })
  h.quote.mockImplementation(async (_c: unknown, _t: unknown, _cards: boolean, _f: boolean, reused: Set<number>) => ({
    parts: { ...PARTS, clip: 300 * (3 - reused.size) },
    holdParts: { ...HOLD, clip: 600 * (3 - reused.size) },
  }))
})

describe("an app run's Retry is priced on what it runs", () => {
  it("the graph is one UGC video (its join feeds no cards here: an ordinary step, priced with the rest)", () => {
    expect(ugcChains(nodes, edges)[0]!.members.map((m) => [m.id, m.part])).toEqual([["script", "script"], ["creator", "creator"], ["clips", null], ["clip", "clip"]])
  })

  it("the clips are fixed: priced from the saved tickets, the finished clips free once checked under the run's root", async () => {
    h.verify.mockResolvedValue(new Set([1, 3]))
    const r = await appRunResumeCredits({ caller, nodes, edges, runNodeIds: new Set(["clip", "join"]), sourceStates, runKey: "exec-root" })
    // Each finished clip claimed at the Re-render count the Retry sends (only clip 2, the failed one, was pressed).
    expect(h.verify).toHaveBeenCalledWith("runner-1", TICKETS, [{ clip: 3, jobId: "job-c3", nonce: 0 }, { clip: 1, jobId: "job-c1", nonce: 0 }], "exec-root")
    expect(h.quote.mock.calls[0]![1]).toEqual(TICKETS.map((t) => JSON.parse(t)))
    expect(h.quote.mock.calls[0]![4]).toEqual(new Set([1, 3]))
    // The rest (the join) 50 + the one clip that renders 300; nothing for the script, creator or clips.
    expect(r).toEqual({ credits: 350, hold: 50 + 600, reusedClips: 2 })
  })

  it("a claim the check does not hold (another runner's take, a deleted job) is priced in full", async () => {
    h.verify.mockResolvedValue(new Set())
    const r = await appRunResumeCredits({ caller, nodes, edges, runNodeIds: new Set(["clip", "join"]), sourceStates, runKey: "exec-root" })
    expect(r).toMatchObject({ credits: 50 + 900, reusedClips: 0 })
  })

  it("a failed node that names no rows claims nothing: every clip of the saved tickets is priced", async () => {
    const r = await appRunResumeCredits({
      caller, nodes, edges, runNodeIds: new Set(["clip", "join"]),
      sourceStates: { ...sourceStates, clip: { status: "failed", jobIds: ["job-c3"] } }, runKey: "exec-root",
    })
    expect(h.verify).not.toHaveBeenCalled()
    expect(r.credits).toBe(50 + 900)
  })

  it("UGC Clips runs again (it did not complete): new tickets, so the estimate prices the clips", async () => {
    const r = await appRunResumeCredits({
      caller, nodes, edges, runNodeIds: new Set(["clips", "clip", "join"]),
      sourceStates: { ...sourceStates, clips: { status: "failed" } }, runKey: "exec-root",
    })
    expect(h.quote).not.toHaveBeenCalled()
    expect(r).toEqual({ credits: 50 + 900, hold: 50 + 1800, reusedClips: 0 })
  })

  it("a run with no UGC step left: the rest alone", async () => {
    const r = await appRunResumeCredits({ caller, nodes, edges, runNodeIds: new Set(), sourceStates, runKey: "exec-root" })
    expect(h.estimate).not.toHaveBeenCalled()
    expect(r).toEqual({ credits: 50, hold: 50, reusedClips: 0 })
  })
})

describe("a Retry reads each video's input as every run-set estimate does", () => {
  it("a script the Retry leaves out: its saved plan's length, never less than the setting", async () => {
    const saved = nodes.map((x) => (x.id === "script" ? { ...x, data: { targetDurationSec: 20, result: { plan: { v: 1, hook: "h", targetDurationSec: 40 } } } } : x))
    await appRunResumeCredits({ caller, nodes: saved, edges, runNodeIds: new Set(["clips", "clip", "join"]), sourceStates: { ...sourceStates, clips: { status: "failed" } }, runKey: "exec-root" })
    expect(h.estimate.mock.calls[0]![1]).toMatchObject({ targetDurationSec: 40 })
  })
})

describe("a Retry counts each UGC step's runs", () => {
  it("a List of three into the script: three scripts priced, three held", async () => {
    h.estimate.mockResolvedValue({ parts: PARTS, holdParts: { ...HOLD, script: 15 } })
    const listed = [...nodes, { id: "list", type: "list", data: { items: "a\nb\nc" } }]
    const wired = [...edges, { source: "list", target: "script", sourceHandle: "output", targetHandle: "site" }]
    const r = await appRunResumeCredits({ caller, nodes: listed, edges: wired, runNodeIds: new Set(["script"]), sourceStates, runKey: "exec-root" })
    expect(r).toEqual({ credits: 50 + 3 * PARTS.script, hold: 50 + 3 * 15, reusedClips: 0 })
  })
})
