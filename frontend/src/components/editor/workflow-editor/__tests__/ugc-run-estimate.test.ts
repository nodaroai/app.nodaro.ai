/**
 * The UGC part of a run's price: one cached server answer per UGC video for
 * every surface that prices a run set (the confirmation, the Run's balance
 * check, the run buttons and the Execute badge), covering exactly the UGC parts
 * the run executes, each times the runs of the node that executes it; the price
 * and the hold; and what the figure says when it is not the server's checked one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { QueryObserver, hashKey } from "@tanstack/react-query"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import type { UgcRunEstimate } from "@/lib/api"

const h = vi.hoisted(() => ({ estimate: vi.fn(), tickets: vi.fn(), runs: {} as Record<string, number> }))
vi.mock("@/lib/api", () => ({ ugcEstimateApi: (...a: unknown[]) => h.estimate(...a), ugcTicketQuoteApi: (...a: unknown[]) => h.tickets(...a) }))

/** The editor's own figure, per node type: a stand-in for the price table, so each figure here is a sum by hand. */
const PRICE: Readonly<Record<string, number>> = {
  "ugc-script": 20, "ugc-clip": 1, "combine-videos": 10, "video-overlay": 20, "add-captions": 50, "generate-image": 45,
}
vi.mock("../estimate-run-credits", async () => {
  // Like the real estimate, it prices only what the run executes: a Preview render holds back what follows it.
  // `h.runs` stands in for a node's fan-out (a List wired in): its line runs that many times.
  const { previewRunnable } = await import("../preview-gate")
  type N = WorkflowNode
  const lines = (executable: N[], all: N[], edges: WorkflowEdge[]) =>
    previewRunnable(executable, all, edges).map((n) => {
      const fanOut = h.runs[n.id] ?? 1
      return { nodeId: n.id, label: n.id, quantity: { fanOut, units: 1 }, credits: (PRICE[n.type ?? ""] ?? 0) * fanOut }
    })
  const sum = (ls: Array<{ credits: number }>) => ls.reduce((a, l) => a + l.credits, 0)
  return {
    estimateRunCreditLines: lines,
    sumRunCreditLines: sum,
    estimateRunCredits: (executable: N[], all: N[], edges: WorkflowEdge[]) => sum(lines(executable, all, edges)),
  }
})

type Mod = typeof import("../ugc-run-estimate")
let mod: Mod
let queryClient: (typeof import("@/lib/query-client"))["queryClient"]
const cost = () => undefined

beforeEach(async () => {
  // A fresh module per test: its remembered failures, and the one cache, start empty.
  vi.resetModules()
  h.estimate.mockReset()
  h.tickets.mockReset()
  h.runs = {}
  mod = await import("../ugc-run-estimate")
  ;({ queryClient } = await import("@/lib/query-client"))
  queryClient.clear()
})
afterEach(() => {
  vi.useRealTimers()
})

const n = (id: string, type: string, data: Record<string, unknown> = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const e = (source: string, target: string, targetHandle: string, sourceHandle?: string) =>
  ({ id: `${source}->${target}:${targetHandle}`, source, target, targetHandle, ...(sourceHandle ? { sourceHandle } : {}) }) as unknown as WorkflowEdge

/** The template's UGC video (a join, an overlay and a captions node below UGC Clip); `p` prefixes every id (a second video). */
function video(p = "", length = 20) {
  const id = (x: string) => `${p}${x}`
  const nodes = [
    n(id("site"), "text-prompt", { text: "Acme" }),
    n(id("shot1"), "upload-image", { url: "https://cdn.example/1.png" }), n(id("shot2"), "upload-image", { url: "https://cdn.example/2.png" }), n(id("shot3"), "upload-image"),
    n(id("script"), "ugc-script", { targetDurationSec: length }),
    n(id("creator"), "ugc-creator", { source: "sampled", gender: "woman" }),
    n(id("clips"), "ugc-clips"), n(id("clip"), "ugc-clip", { rerender: {} }), n(id("cards"), "ugc-cards"),
    n(id("join"), "combine-videos", { transition: "cut" }), n(id("overlay"), "video-overlay"), n(id("captions"), "add-captions"),
  ]
  const edges = [
    e(id("site"), id("script"), "site"),
    e(id("shot1"), id("script"), "screenshot"), e(id("shot2"), id("script"), "screenshot2"), e(id("shot3"), id("script"), "screenshot3"),
    e(id("script"), id("creator"), "category"),
    e(id("script"), id("clips"), "plan"), e(id("creator"), id("clips"), "creator"), e(id("clips"), id("clip"), "clip"),
    e(id("clip"), id("join"), "in"), e(id("clip"), id("cards"), "notes"), e(id("join"), id("cards"), "video"), e(id("join"), id("overlay"), "video"),
    e(id("cards"), id("overlay"), "layerPlan"), e(id("cards"), id("captions"), "captionPlan", "captionPlan"), e(id("overlay"), id("captions"), "in"),
  ]
  return { nodes, edges }
}
// The template's video, and an image beside it.
const V = video()
const NODES = [...V.nodes, n("img", "generate-image", { provider: "p" })]
const EDGES = [...V.edges, e("site", "img", "prompt")]
const TOOLBAR = NODES.filter((x) => x.type !== "text-prompt" && x.type !== "upload-image")
const pick = (...ids: string[]) => NODES.filter((x) => ids.includes(x.id))
/** The graph's input, as a run reads it: two of the three screenshot slots hold an image. */
const INPUT = { targetDurationSec: 20, screenshotCount: 2, source: "sampled" } as const
const PARTS = { script: 22, creator: 41, clip: 1503, cards: 57, join: 11, overlay: 22, captions: 55 }
/** What each part holds: each clip twice, at the longest length. */
const HOLD = { ...PARTS, clip: 2 * 1803 }
const ANSWER: UgcRunEstimate = { lines: [], expected: 1711, ceiling: 3214, range: [1400, 2000], worstCase: 3800, parts: PARTS, holdParts: HOLD }
const ALL_PARTS = Object.values(PARTS).reduce((a, b) => a + b, 0)
const ALL_HOLD = Object.values(HOLD).reduce((a, b) => a + b, 0)
/** The editor's own figure for the whole toolbar Run: every node's price above. */
const CLIENT_TOOLBAR = 20 + 1 + 10 + 20 + 50 + 45
const always = (answer: UgcRunEstimate | undefined) => () => answer

/** What the button and the badge show: the figure over whatever answer the one cache holds. */
const cachedFigure = (executable: WorkflowNode[]) =>
  mod.ugcRunCredits(executable, NODES, EDGES, cost, (input) => queryClient.getQueryData(mod.ugcRunEstimateQuery(input).queryKey))

describe("ugcRunCredits: a run set's one figure", () => {
  it("no UGC part: the editor's own figure, unmarked", () => {
    expect(mod.ugcRunCredits(pick("img"), NODES, EDGES, cost, always(ANSWER))).toMatchObject({ credits: 45, hold: 45, estimate: "none" })
  })
  it("the answers: the editor's figure for the nodes the estimate does not cover, plus the server's for every part the run executes; the hold holds each clip twice", () => {
    const figure = mod.ugcRunCredits(TOOLBAR, NODES, EDGES, cost, always(ANSWER))
    expect(figure).toMatchObject({ credits: 45 + ALL_PARTS, hold: 45 + ALL_HOLD, estimate: "server", rendersClips: true, mayReuseClips: false, lengthUnread: false })
    // Each covered node at its share, UGC Clips at nothing: with the image's own 45 they make the figure.
    expect(Object.fromEntries(figure.nodeCredits!)).toEqual({
      script: PARTS.script, creator: PARTS.creator, clips: 0, clip: PARTS.clip, cards: PARTS.cards, join: PARTS.join, overlay: PARTS.overlay, captions: PARTS.captions,
    })
  })
  it("`≈` exactly when the server's figure is one: a covered node's part the answer marks an estimate (`estimateParts`)", () => {
    // No part marked: a fixed figure, no `≈`.
    expect(mod.ugcRunCredits(TOOLBAR, NODES, EDGES, cost, always(ANSWER)).approx).toBe(false)
    // The creator check is metered (fixed-mode plugin): the run's figure is an estimate.
    const creatorMetered = { ...ANSWER, estimateParts: ["creator"] } as UgcRunEstimate
    expect(mod.ugcRunCredits(TOOLBAR, NODES, EDGES, cost, always(creatorMetered)).approx).toBe(true)
    // A run that does not execute the marked part is not an estimate (the script's ▶ alone).
    expect(mod.ugcRunCredits(pick("script"), NODES, EDGES, cost, always(creatorMetered)).approx).toBe(false)
    // A metered clip reading marks the clip part: Run from a node above it is `≈` too.
    const clipMetered = { ...ANSWER, estimateParts: ["clip"] } as UgcRunEstimate
    expect(mod.ugcRunCredits(pick("clip", "join"), NODES, EDGES, cost, always(clipMetered)).approx).toBe(true)
  })
  it("no answer yet: the editor's own figure for the whole set, marked as an estimate", () => {
    expect(mod.ugcRunCredits(TOOLBAR, NODES, EDGES, cost, always(undefined))).toMatchObject({ credits: CLIENT_TOOLBAR, hold: CLIENT_TOOLBAR, estimate: "client" })
  })
  it("a ▶ on UGC Script is the script's price alone, and renders no clip", () => {
    expect(mod.ugcRunCredits(pick("script"), NODES, EDGES, cost, always(ANSWER))).toMatchObject({ credits: PARTS.script, hold: PARTS.script, estimate: "server", rendersClips: false })
  })
  it("Run from here on a kept creator is what follows it", () => {
    const kept = NODES.map((x) => (x.id === "creator" ? n("creator", "ugc-creator", { keepResult: true, result: { v: 1, identityImages: ["https://cdn.example/c.png"] } }) : x))
    const fromCreator = kept.filter((x) => ["creator", "clips", "clip", "cards", "join", "overlay", "captions"].includes(x.id))
    expect(mod.ugcRunCredits(fromCreator, kept, EDGES, cost, always(ANSWER)).credits).toBe(PARTS.clip + PARTS.cards + PARTS.join + PARTS.overlay + PARTS.captions)
  })
  it("a node a Preview render holds back never adds its part", () => {
    window.__NODARO_RUNTIME__ = { previewStopRule: true }
    try {
      // A render set to Preview feeds the join: the join, and everything below it, waits for Render final.
      const nodes = [...NODES, n("cut", "apply-edl", { quality: "proxy" })]
      const edges = [...EDGES, e("cut", "join", "in")]
      const run = [...TOOLBAR, nodes[nodes.length - 1]!]
      // The join is no longer the video's (one of its inputs is not the video's clip): the render runs (0 here),
      // the join, the cards, the overlay and the captions wait.
      expect(mod.ugcRunCredits(run, nodes, edges, cost, always(ANSWER)).credits).toBe(45 + PARTS.script + PARTS.creator + PARTS.clip)
    } finally {
      delete window.__NODARO_RUNTIME__
    }
  })
  it("a part runs as many times as the node that executes it: a List of three into the script is three scripts", () => {
    h.runs = { script: 3 }
    expect(mod.ugcRunCredits(pick("script"), NODES, EDGES, cost, always(ANSWER))).toMatchObject({ credits: 3 * PARTS.script, hold: 3 * PARTS.script })
  })
  it("the clips run as many times as UGC Clips does, never UGC Clip's own per-clip runs; once when UGC Clips is not in the run", () => {
    h.runs = { clips: 2, clip: 7 }
    expect(mod.ugcRunCredits(pick("clips", "clip"), NODES, EDGES, cost, always(ANSWER))).toMatchObject({ credits: 2 * PARTS.clip, hold: 2 * HOLD.clip })
    expect(mod.ugcRunCredits(pick("clip"), NODES, EDGES, cost, always(ANSWER))).toMatchObject({ credits: PARTS.clip, hold: HOLD.clip })
  })
  it("two videos: each priced from its own answer, and a run of both is their sum", () => {
    const b = video("b-", 30)
    const nodes = [...NODES, ...b.nodes]
    const edges = [...EDGES, ...b.edges]
    const run = nodes.filter((x) => x.type !== "text-prompt" && x.type !== "upload-image")
    const B_PARTS = { ...PARTS, clip: 2400 }
    const answerOf = (input: { targetDurationSec: number }) => (input.targetDurationSec === 30 ? { ...ANSWER, parts: B_PARTS, holdParts: { ...HOLD, clip: 5000 } } : ANSWER)
    expect(mod.ugcRunCredits(run, nodes, edges, cost, answerOf)).toMatchObject({
      credits: 45 + ALL_PARTS + Object.values(B_PARTS).reduce((a, x) => a + x, 0),
      hold: 45 + ALL_HOLD + ALL_HOLD - HOLD.clip + 5000,
      estimate: "server",
    })
    // One of the two answers missing: the editor's own figure for the whole set.
    expect(mod.ugcRunCredits(run, nodes, edges, cost, (input) => (input.targetDurationSec === 30 ? undefined : ANSWER)).estimate).toBe("client")
  })
  it("a UGC Clip that has rendered before: its clips may be reused", () => {
    const rendered = NODES.map((x) => (x.id === "clip" ? n("clip", "ugc-clip", { rerender: {}, __listResults: ["https://cdn.example/c1.mp4"] }) : x))
    expect(mod.ugcRunCredits(pick("clip"), rendered, EDGES, cost, always(ANSWER)).mayReuseClips).toBe(true)
  })
  it("a kept script whose saved plan carries no length: the server's figure, flagged", () => {
    const kept = NODES.map((x) => (x.id === "script" ? n("script", "ugc-script", { targetDurationSec: 20, keepResult: true, result: { plan: { v: 1, hook: "h" } } }) : x))
    expect(mod.ugcRunCredits(TOOLBAR, kept, EDGES, cost, always(ANSWER))).toMatchObject({ estimate: "server", lengthUnread: true })
  })
  it("a kept script whose saved plan's beats cannot be read: the server's figure on the wires' cards, flagged", () => {
    const kept = NODES.map((x) => (x.id === "script" ? n("script", "ugc-script", { targetDurationSec: 20, keepResult: true, result: { plan: { v: 1, hook: "h", targetDurationSec: 20 } } }) : x))
    expect(mod.ugcRunCredits(TOOLBAR, kept, EDGES, cost, always(ANSWER))).toMatchObject({ estimate: "server", lengthUnread: false, screenshotsUnread: true })
  })
})

describe("runCreditsWithUgc: the confirmation's and the balance check's figure", () => {
  const CHECKED = { credits: 45 + ALL_PARTS, hold: 45 + ALL_HOLD, rendersClips: true, mayReuseClips: false, nodeCredits: expect.any(Map) }

  it("asks once, with every creator option and the graph's input; the next ask for the same graph reads the cache", async () => {
    h.estimate.mockResolvedValue(ANSWER)
    expect(await mod.runCreditsWithUgc(TOOLBAR, NODES, EDGES, cost)).toEqual(CHECKED)
    expect(h.estimate).toHaveBeenCalledTimes(1)
    expect(h.estimate.mock.calls[0]![0]).toEqual({ ...INPUT, rendersEveryCandidate: true })
    expect(h.estimate.mock.calls[0]![1]).toEqual({ signal: expect.any(AbortSignal) })
    expect(await mod.runCreditsWithUgc(pick("script"), NODES, EDGES, cost)).toMatchObject({ credits: PARTS.script, hold: PARTS.script, rendersClips: false, mayReuseClips: false })
    expect(h.estimate).toHaveBeenCalledTimes(1)
  })

  it("two videos: one ask each, within the one wait, and their sum", async () => {
    const b = video("b-", 30)
    const nodes = [...NODES, ...b.nodes]
    const edges = [...EDGES, ...b.edges]
    const run = nodes.filter((x) => x.type !== "text-prompt" && x.type !== "upload-image")
    h.estimate.mockResolvedValue(ANSWER)
    expect(await mod.runCreditsWithUgc(run, nodes, edges, cost)).toMatchObject({ credits: 45 + 2 * ALL_PARTS, hold: 45 + 2 * ALL_HOLD })
    expect(h.estimate.mock.calls.map((c) => (c[0] as { targetDurationSec: number }).targetDurationSec).sort()).toEqual([20, 30])
  })

  it("the server refusing: the editor's own figure, unchecked; asked again only after 60 s", async () => {
    vi.useFakeTimers()
    h.estimate.mockRejectedValue(new Error("503"))
    const editorOwn = { credits: CLIENT_TOOLBAR, hold: CLIENT_TOOLBAR, unchecked: "editor", rendersClips: true, mayReuseClips: false }
    expect(await mod.runCreditsWithUgc(TOOLBAR, NODES, EDGES, cost)).toEqual(editorOwn)
    vi.advanceTimersByTime(mod.UGC_UNCHECKED_FOR_MS - 1000)
    // The balance check, right after the confirmation: answered at once, without asking.
    expect(await mod.runCreditsWithUgc(TOOLBAR, NODES, EDGES, cost)).toEqual(editorOwn)
    expect(h.estimate).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2000)
    h.estimate.mockResolvedValue(ANSWER)
    expect(await mod.runCreditsWithUgc(TOOLBAR, NODES, EDGES, cost)).toEqual(CHECKED)
    expect(h.estimate).toHaveBeenCalledTimes(2)
  })

  it("no answer within 5 s, the ask still on its way: the editor's own figure, flagged as still being checked, never as failed", async () => {
    vi.useFakeTimers()
    h.estimate.mockReturnValue(new Promise(() => {}))
    const priced = mod.runCreditsWithUgc(TOOLBAR, NODES, EDGES, cost)
    await vi.advanceTimersByTimeAsync(mod.UGC_ESTIMATE_TIMEOUT_MS)
    expect(await priced).toMatchObject({ credits: CLIENT_TOOLBAR, unchecked: "checking" })
  })

  it("an older answer whose re-check is still on its way when the wait ends: the server's last answer, flagged as still being checked, never as failed", async () => {
    vi.useFakeTimers()
    h.estimate.mockResolvedValueOnce(ANSWER)
    const badge = new QueryObserver(queryClient, mod.ugcRunEstimateQuery(INPUT)).subscribe(() => undefined)
    expect(await mod.runCreditsWithUgc(TOOLBAR, NODES, EDGES, cost)).toEqual(CHECKED)
    // Fifteen minutes on, the answer is no longer current; the re-check answers, but only after 5.8 s.
    vi.advanceTimersByTime(15 * 60_000)
    h.estimate.mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve(ANSWER), 5835)))
    const confirm = mod.runCreditsWithUgc(TOOLBAR, NODES, EDGES, cost)
    await vi.advanceTimersByTimeAsync(mod.UGC_ESTIMATE_TIMEOUT_MS)
    const priced = await confirm
    expect(priced.unchecked).not.toBe("held")
    expect(priced).toEqual({ ...CHECKED, unchecked: "checkingHeld" })
    // The re-check lands: the next ask (the balance check) is the server's checked figure, without asking again.
    await vi.advanceTimersByTimeAsync(1000)
    expect(await mod.runCreditsWithUgc(TOOLBAR, NODES, EDGES, cost)).toEqual(CHECKED)
    expect(h.estimate).toHaveBeenCalledTimes(2)
    badge()
  })

  it("an older answer whose re-check fails still prices the run, flagged as not checked again", async () => {
    vi.useFakeTimers()
    h.estimate.mockResolvedValueOnce(ANSWER)
    // The badge's query holds the answer for as long as the editor is open.
    const badge = new QueryObserver(queryClient, mod.ugcRunEstimateQuery(INPUT)).subscribe(() => undefined)
    expect(await mod.runCreditsWithUgc(TOOLBAR, NODES, EDGES, cost)).toEqual(CHECKED)
    // Six minutes on, the answer is no longer current; the re-check fails.
    vi.advanceTimersByTime(6 * 60_000)
    h.estimate.mockRejectedValueOnce(new Error("503"))
    expect(await mod.runCreditsWithUgc(TOOLBAR, NODES, EDGES, cost)).toEqual({ ...CHECKED, unchecked: "held" })
    expect(h.estimate).toHaveBeenCalledTimes(2)
    // Asked right after: the failure is remembered, and the figure is still flagged.
    expect(await mod.runCreditsWithUgc(TOOLBAR, NODES, EDGES, cost)).toEqual({ ...CHECKED, unchecked: "held" })
    // A re-check that answers clears the flag.
    vi.advanceTimersByTime(mod.UGC_UNCHECKED_FOR_MS)
    h.estimate.mockResolvedValueOnce(ANSWER)
    expect(await mod.runCreditsWithUgc(TOOLBAR, NODES, EDGES, cost)).toEqual(CHECKED)
    badge()
  })

  it("a kept script whose saved plan carries no length: the server's figure, flagged as a length it could not read", async () => {
    const kept = NODES.map((x) => (x.id === "script" ? n("script", "ugc-script", { targetDurationSec: 20, keepResult: true, result: { plan: { v: 1, hook: "h" } } }) : x))
    h.estimate.mockResolvedValue(ANSWER)
    expect(await mod.runCreditsWithUgc(TOOLBAR, kept, EDGES, cost)).toMatchObject({ unchecked: "length" })
  })

  it("a kept script whose saved plan's beats cannot be read: the server's figure, flagged as not checked", async () => {
    const kept = NODES.map((x) => (x.id === "script" ? n("script", "ugc-script", { targetDurationSec: 20, keepResult: true, result: { plan: { v: 1, hook: "h", targetDurationSec: 20 } } }) : x))
    h.estimate.mockResolvedValue(ANSWER)
    expect(await mod.runCreditsWithUgc(TOOLBAR, kept, EDGES, cost)).toMatchObject({ unchecked: "editor" })
    // Read without asking (the Copilot's card): the same.
    expect(mod.ugcRunFigureNow(TOOLBAR, kept, EDGES, cost).unchecked).toBe("editor")
  })

  it("an answer that lands after the wait ends the memory: the balance check, the button and the badge then show the server's figure with the confirmation's next ask", async () => {
    vi.useFakeTimers()
    let land!: (v: unknown) => void
    h.estimate.mockReturnValue(new Promise((resolve) => { land = resolve }))
    // The confirmation stops waiting after 5 s and says the price is still being checked.
    const confirm = mod.runCreditsWithUgc(TOOLBAR, NODES, EDGES, cost)
    await vi.advanceTimersByTimeAsync(mod.UGC_ESTIMATE_TIMEOUT_MS)
    expect(await confirm).toMatchObject({ credits: CLIENT_TOOLBAR, unchecked: "checking" })
    expect(cachedFigure(TOOLBAR)).toMatchObject({ credits: CLIENT_TOOLBAR, estimate: "client" })
    // The answer lands two seconds later, well inside the 60 s memory.
    await vi.advanceTimersByTimeAsync(2000)
    land(ANSWER)
    await vi.advanceTimersByTimeAsync(0)
    // All four surfaces agree: the balance check (and a second confirmation) and what the button and the badge read.
    const gate = await mod.runCreditsWithUgc(TOOLBAR, NODES, EDGES, cost)
    expect(gate).toEqual(CHECKED)
    expect(cachedFigure(TOOLBAR)).toMatchObject({ credits: gate.credits, hold: gate.hold, estimate: "server" })
    expect(await mod.runCreditsWithUgc(TOOLBAR, NODES, EDGES, cost)).toEqual(gate)
    expect(h.estimate).toHaveBeenCalledTimes(1)
  })

  it("the late answer itself ends the remembered failure: with the cache emptied, the next ask waits for the server again", async () => {
    vi.useFakeTimers()
    let land!: (v: unknown) => void
    h.estimate.mockReturnValueOnce(new Promise((resolve) => { land = resolve }))
    const confirm = mod.runCreditsWithUgc(pick("script"), NODES, EDGES, cost)
    await vi.advanceTimersByTimeAsync(mod.UGC_ESTIMATE_TIMEOUT_MS)
    expect((await confirm).unchecked).toBe("checking")
    land(ANSWER)
    await vi.advanceTimersByTimeAsync(0)
    // Well inside the 60 s, and with no answer left to read: had the failure still been remembered, this would not ask.
    queryClient.removeQueries({ queryKey: mod.ugcRunEstimateQuery(INPUT).queryKey })
    h.estimate.mockResolvedValueOnce({ ...ANSWER, parts: { ...PARTS, script: 30 }, holdParts: { ...HOLD, script: 30 } })
    expect(await mod.runCreditsWithUgc(pick("script"), NODES, EDGES, cost)).toMatchObject({ credits: 30 })
    expect(h.estimate).toHaveBeenCalledTimes(2)
  })

  it("a fetch cancelled under it (a button's query that went away) is asked again within the wait", async () => {
    let first = true
    h.estimate.mockImplementation((_req: unknown, opts: { signal: AbortSignal }) => {
      if (!first) return Promise.resolve(ANSWER)
      first = false
      return new Promise((_resolve, reject) => opts.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))
    })
    const priced = mod.runCreditsWithUgc(TOOLBAR, NODES, EDGES, cost)
    await vi.waitFor(() => expect(h.estimate).toHaveBeenCalledTimes(1))
    await queryClient.cancelQueries({ queryKey: mod.ugcRunEstimateQuery(INPUT).queryKey })
    expect(await priced).toEqual(CHECKED)
    expect(h.estimate).toHaveBeenCalledTimes(2)
  })

  it("an answer without its parts, or without its holds, is no answer: the editor's own figure, unchecked", async () => {
    h.estimate.mockResolvedValue({ ...ANSWER, parts: { script: 22 } })
    expect(await mod.runCreditsWithUgc(TOOLBAR, NODES, EDGES, cost)).toMatchObject({ credits: CLIENT_TOOLBAR, unchecked: "editor" })
    expect(queryClient.getQueryData(mod.ugcRunEstimateQuery(INPUT).queryKey)).toBeUndefined()
    const { holdParts: _dropped, ...withoutHolds } = ANSWER
    vi.resetModules()
    mod = await import("../ugc-run-estimate")
    ;({ queryClient } = await import("@/lib/query-client"))
    queryClient.clear()
    h.estimate.mockResolvedValue(withoutHolds)
    expect(await mod.runCreditsWithUgc(TOOLBAR, NODES, EDGES, cost)).toMatchObject({ unchecked: "editor" })
  })

  it("a run with no UGC part never asks", async () => {
    expect(await mod.runCreditsWithUgc(pick("img"), NODES, EDGES, cost)).toEqual({ credits: 45, hold: 45, rendersClips: false, mayReuseClips: false })
    expect(h.estimate).not.toHaveBeenCalled()
  })
})

describe("one query per video: keyed over exactly what the estimate reads", () => {
  it("its key is the very request the estimate is asked", async () => {
    h.estimate.mockResolvedValue(ANSWER)
    const query = mod.ugcRunEstimateQuery(INPUT)
    await queryClient.fetchQuery(query)
    expect(query.queryKey.at(-1)).toEqual(h.estimate.mock.calls[0]![0])
    expect(query.queryKey.at(-1)).toEqual({ ...INPUT, rendersEveryCandidate: true })
  })

  it("every input the estimate reads changes the key; nothing about the person asking is in it", async () => {
    const [input] = mod.ugcRunInputs(TOOLBAR, NODES, EDGES)
    expect(input).toEqual(INPUT)
    const keyOf = (i: typeof INPUT | NonNullable<typeof input>) => hashKey(mod.ugcRunEstimateQuery(i).queryKey)
    const changed = {
      targetDurationSec: { ...input!, targetDurationSec: 30 },
      screenshotCount: { ...input!, screenshotCount: 3 },
      source: { ...input!, source: "photo" as const },
    }
    for (const [field, other] of Object.entries(changed)) expect(keyOf(other), field).not.toBe(keyOf(input!))
    // The request is the input and the every-option flag, nothing else: the price markup is global, and the payer
    // only decides whether a run is refused, never what this estimate says.
    const request = mod.ugcRunEstimateQuery(input!).queryKey.at(-1) as Record<string, unknown>
    expect(Object.keys(request).sort()).toEqual([...Object.keys(input!), "rendersEveryCandidate"].sort())
    expect(request.rendersEveryCandidate).toBe(true)
  })

  it("two videos with one input share one answer; two inputs are two", () => {
    const same = video("b-")
    const other = video("c-", 30)
    expect(mod.ugcRunInputs([...TOOLBAR, ...same.nodes], [...NODES, ...same.nodes], [...EDGES, ...same.edges])).toHaveLength(1)
    expect(mod.ugcRunInputs([...TOOLBAR, ...other.nodes], [...NODES, ...other.nodes], [...EDGES, ...other.edges])).toHaveLength(2)
  })

  it("is never retried on its own, and stays current for five minutes", () => {
    const query = mod.ugcRunEstimateQuery(INPUT)
    expect(query.retry).toBe(false)
    expect(query.staleTime).toBe(5 * 60_000)
  })
})

describe("a run of UGC Clip whose clips are fixed (its UGC Clips does not run): priced from the saved clips", () => {
  const T = (i: number) => JSON.stringify({ v: 1, index: i, durationSec: 8, video: { tool: "generate_video", args: {} } })
  const TICKETS = [T(0), T(1), T(2)]
  const JOB0 = "00000000-0000-4000-8000-000000000000"
  const JOB2 = "00000000-0000-4000-8000-000000000002"
  /** The takes the editor's run landed: each names its job and the Re-render count it was made at. */
  const TAKES = [
    { url: "https://cdn/c0.mp4", jobId: JOB0, timestamp: "t", ugcClipNonce: 0 },
    { url: "https://cdn/c2.mp4", jobId: JOB2, timestamp: "t", ugcClipNonce: 0 },
  ]
  const CLAIMS = [{ clip: 1, jobId: JOB0, nonce: 0 }, { clip: 3, jobId: JOB2, nonce: 0 }]
  const BATCH = { __listInputs: TICKETS, __listResults: ["https://cdn/c0.mp4", "", "https://cdn/c2.mp4"], generatedResults: TAKES }
  /** The video after a run whose clip 2 failed: UGC Clips' saved clips, and UGC Clip's last batch. */
  const saved = (clip: Record<string, unknown> = { rerender: {}, ...BATCH }) =>
    NODES.map((x) =>
      x.id === "clips" ? n("clips", "ugc-clips", { __listResults: TICKETS, ugcOutputs: { "plan-out": JSON.stringify({ v: 1, plan: {} }) } })
      : x.id === "clip" ? n("clip", "ugc-clip", clip)
      : x,
    )
  /** The ticket form's answer for the one clip that renders (603 here), held at twice that. */
  const TICKET_ANSWER = { lines: [], expected: 603, ceiling: 1206, parts: { ...PARTS, clip: 603 }, holdParts: { ...HOLD, clip: 1206 } }
  const clipOnly = (nodes: WorkflowNode[]) => nodes.filter((x) => x.id === "clip")

  it("the clips it hands back are free: the figure is the quote's clip part for the one that renders", () => {
    const nodes = saved()
    const asked: unknown[] = []
    const figure = mod.ugcRunCredits(clipOnly(nodes), nodes, EDGES, cost, always(ANSWER), (quote) => {
      asked.push(quote)
      return TICKET_ANSWER
    })
    expect(asked[0]).toEqual({ tickets: TICKETS, reusedClips: CLAIMS, finishes: false, reuseKnown: true })
    expect(figure).toMatchObject({ credits: 603, hold: 1206, estimate: "server", rendersClips: true, mayReuseClips: false })
  })

  it("no quote yet, or one that cannot be had: every clip at the estimate's full price, and the run may cost less", () => {
    const nodes = saved()
    expect(mod.ugcRunCredits(clipOnly(nodes), nodes, EDGES, cost, always(ANSWER))).toMatchObject({ credits: PARTS.clip, hold: HOLD.clip, mayReuseClips: true })
  })

  it("a run that runs UGC Clips makes new clips: the estimate prices them, never the saved ones", () => {
    const nodes = saved()
    const ticketAnswerOf = vi.fn(() => TICKET_ANSWER)
    const run = nodes.filter((x) => x.id === "clips" || x.id === "clip")
    expect(mod.ugcRunCredits(run, nodes, EDGES, cost, always(ANSWER), ticketAnswerOf)).toMatchObject({ credits: PARTS.clip, hold: HOLD.clip })
    expect(ticketAnswerOf).not.toHaveBeenCalled()
  })

  it("the balance check asks the quote with the clips it hands back, and holds what renders", async () => {
    h.estimate.mockResolvedValue(ANSWER)
    h.tickets.mockResolvedValue(TICKET_ANSWER)
    const nodes = saved()
    expect(await mod.runCreditsWithUgc(clipOnly(nodes), nodes, EDGES, cost)).toMatchObject({ credits: 603, hold: 1206, mayReuseClips: false })
    expect(h.tickets).toHaveBeenCalledTimes(1)
    // Each claim names its take's job and the count the run sends: the server checks them against the caller's own jobs.
    expect(h.tickets.mock.calls[0]![0]).toEqual({ tickets: TICKETS, hasCards: false, finishes: false, reusedClips: CLAIMS })
  })

  it("a quote that fails: the balance check holds every clip at full price, and says the run may cost less", async () => {
    h.estimate.mockResolvedValue(ANSWER)
    h.tickets.mockRejectedValue(new Error("down"))
    const nodes = saved()
    expect(await mod.runCreditsWithUgc(clipOnly(nodes), nodes, EDGES, cost)).toMatchObject({ credits: PARTS.clip, hold: HOLD.clip, mayReuseClips: true })
  })

  it("a clip pressed for Re-render is priced: it renders", () => {
    const nodes = saved({ rerender: { "1": 1 }, rerenderPending: { "1": true }, ...BATCH })
    const asked: Array<{ reusedClips: readonly { clip: number }[] }> = []
    mod.ugcRunCredits(clipOnly(nodes), nodes, EDGES, cost, always(ANSWER), (quote) => {
      asked.push(quote)
      return undefined
    })
    expect(asked[0]!.reusedClips.map((c) => c.clip)).toEqual([3])
  })

  it("a take made at another Re-render count than the run sends is not claimed, and the run may cost less", () => {
    // Clip 1 now sends count 1 with no mark (an undo/redo, or a press a server run landed over).
    const nodes = saved({ rerender: { "1": 1 }, ...BATCH })
    const asked: Array<{ reusedClips: readonly { clip: number }[]; reuseKnown: boolean }> = []
    const figure = mod.ugcRunCredits(clipOnly(nodes), nodes, EDGES, cost, always(ANSWER), (quote) => {
      asked.push(quote)
      return TICKET_ANSWER
    })
    expect(asked[0]!.reusedClips.map((c) => c.clip)).toEqual([3])
    expect(asked[0]!.reuseKnown).toBe(false)
    expect(figure.mayReuseClips).toBe(true)
  })
})
