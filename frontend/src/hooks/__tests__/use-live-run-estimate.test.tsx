// The live run estimate GATES an app run (the runner refuses below it). The
// mobile shell used to gate on the store's seeded figure alone — the server's
// static, edge-less estimate, which prices a per-output-minute render as ONE
// minute and knows nothing about fan-out — while only the desktop runner
// computed the live figure. Both surfaces now price this one hook.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

vi.mock("@/components/editor/config-panels/helpers", () => ({
  getModelIdentifier: (n: { type?: string }) => n.type ?? "",
}))

import { useLiveRunEstimate, computeLiveRunEstimate, applyRunInputValues } from "../use-live-run-estimate"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

const n = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as WorkflowNode
const e = (source: string, target: string, targetHandle: string): WorkflowEdge =>
  ({ id: `${source}-${target}`, source, target, targetHandle }) as WorkflowEdge

/** Live per-unit prices (credits). apply-edl's is a per-MINUTE rate. */
const PRICES: Record<string, number> = { transcribe: 10, "edit-plan": 240, "apply-edl": 10 }

// The shipped "Tighten Episode" shape: a 45-minute master → transcribe →
// edit-plan → apply-edl. The render reserves 45 minutes × 10 = 450.
const master = n("m", "upload-audio", { metadata: { durationSeconds: 45 * 60 } })
const tr = n("tr", "transcribe")
const plan = n("ep", "edit-plan", { mode: "tighten" })
const ae = n("ae", "apply-edl")
const NODES = [master, tr, plan, ae]
const EDGES = [e("m", "tr", "audio"), e("m", "ep", "sources"), e("tr", "ep", "transcript"), e("ep", "ae", "edl")]
const TIGHTEN_TOTAL = 10 + 240 + 450

function deps(cache: Map<string, number>, prefetch = vi.fn(async (ids: string[]) => { for (const id of ids) cache.set(id, PRICES[id] ?? 0) })) {
  return { getCachedCredits: (id: string) => cache.get(id), prefetchModelCredits: prefetch }
}

describe("computeLiveRunEstimate", () => {
  it("prices the Tighten Episode render for the whole episode, not one minute", () => {
    const cache = new Map(Object.entries(PRICES))
    expect(computeLiveRunEstimate({ nodes: NODES, edges: EDGES }, (id) => cache.get(id)).total).toBe(TIGHTEN_TOTAL)
  })

  it("reports which model ids are not cached yet", () => {
    const cache = new Map([["transcribe", 10]])
    const out = computeLiveRunEstimate({ nodes: NODES, edges: EDGES }, (id) => cache.get(id))
    expect(out.uncachedModelIds.sort()).toEqual(["apply-edl", "edit-plan"])
  })

  it("merges run-time input values over the snapshot — and drops a swapped media's stale length", () => {
    // The publisher's master recorded 10 minutes; the runner supplies its own
    // (longer, unmeasured) audio. The saved length must not price this run.
    const publisherMaster = n("m", "reference-audio", {
      extractedAudioUrl: "https://cdn/publisher-10min.mp3",
      metadata: { durationSeconds: 600, mediaUrl: "https://cdn/publisher-10min.mp3" },
    })
    const nodes = [publisherMaster, tr, plan, ae]
    const cache = new Map(Object.entries(PRICES))
    const priced = computeLiveRunEstimate({ nodes, edges: EDGES }, (id) => cache.get(id)).total
    expect(priced).toBe(10 + 240 + 10 * 10) // 10-minute render
    const swapped = computeLiveRunEstimate(
      { nodes, edges: EDGES, inputValues: { m: { extractedAudioUrl: "https://cdn/caller-unknown-length.mp3" } } },
      (id) => cache.get(id),
    ).total
    expect(swapped).toBe(10 + 240 + 10 * 180) // unknown length → the ceiling, never the publisher's 10
    const merged = applyRunInputValues(nodes, { m: { extractedAudioUrl: "https://cdn/x.mp3" } })
    expect((merged[0]!.data as Record<string, unknown>).metadata).toBeUndefined()
  })

  it("a Video URL episode: the creator's saved length never prices the caller's file; the length read does", () => {
    const POST = "https://www.youtube.com/watch?v=abc123def45"
    const FILE = "https://cdn.nodaro.ai/downloads/ep.mp4"
    const episode = n("m", "youtube-video", {
      youtubeUrl: "https://www.youtube.com/watch?v=creator0001",
      downloadedVideoUrl: "https://cdn/sample.mp4",
      downloadedFromUrl: "https://www.youtube.com/watch?v=creator0001",
      videoDurationSec: 600,
    })
    const nodes = [episode, tr, plan, ae]
    const cache = new Map(Object.entries(PRICES))
    const mine = { m: { youtubeUrl: POST, downloadedVideoUrl: FILE, downloadedFromUrl: POST } }
    const read = computeLiveRunEstimate({ nodes, edges: EDGES, inputValues: mine, mediaLengths: new Map([[FILE, 45 * 60]]) }, (id) => cache.get(id)).total
    expect(read).toBe(TIGHTEN_TOTAL)
    const unread = computeLiveRunEstimate({ nodes, edges: EDGES, inputValues: mine, mediaLengths: new Map() }, (id) => cache.get(id)).total
    expect(unread).toBe(10 + 240 + 10 * 180)
  })
})

describe("useLiveRunEstimate", () => {
  beforeEach(() => vi.useRealTimers())

  it("computes immediately on mount when every price is cached", () => {
    const cache = new Map(Object.entries(PRICES))
    const { result } = renderHook(() => useLiveRunEstimate({ nodes: NODES, edges: EDGES, enabled: true }, deps(cache)))
    expect(result.current).toBe(TIGHTEN_TOTAL)
  })

  it("prefetches uncached prices, then settles on the exact figure", async () => {
    const cache = new Map<string, number>()
    const prefetch = vi.fn(async (ids: string[]) => { for (const id of ids) cache.set(id, PRICES[id] ?? 0) })
    const { result } = renderHook(() => useLiveRunEstimate({ nodes: NODES, edges: EDGES, enabled: true }, deps(cache, prefetch)))
    expect(prefetch).toHaveBeenCalledTimes(1)
    expect(prefetch.mock.calls[0]![0]!.sort()).toEqual(["apply-edl", "edit-plan", "transcribe"])
    await waitFor(() => expect(result.current).toBe(TIGHTEN_TOTAL))
  })

  it("returns 0 and computes nothing on an edition without credits", () => {
    const cache = new Map(Object.entries(PRICES))
    const prefetch = vi.fn(async () => {})
    const { result } = renderHook(() => useLiveRunEstimate({ nodes: NODES, edges: EDGES, enabled: false }, deps(cache, prefetch)))
    expect(result.current).toBe(0)
    expect(prefetch).not.toHaveBeenCalled()
  })

  it("debounces a change to the inputs, then recomputes", async () => {
    vi.useFakeTimers()
    const cache = new Map(Object.entries(PRICES))
    const publisherMaster = n("m", "reference-audio", {
      extractedAudioUrl: "https://cdn/p.mp3",
      metadata: { durationSeconds: 600, mediaUrl: "https://cdn/p.mp3" },
    })
    const nodes = [publisherMaster, tr, plan, ae]
    let inputValues: Record<string, Record<string, unknown>> | undefined
    const { result, rerender } = renderHook(() =>
      useLiveRunEstimate({ nodes, edges: EDGES, inputValues, enabled: true }, deps(cache)),
    )
    expect(result.current).toBe(10 + 240 + 100)
    inputValues = { m: { extractedAudioUrl: "https://cdn/other.mp3" } }
    rerender()
    expect(result.current).toBe(10 + 240 + 100) // not yet — debounced
    await act(async () => { vi.advanceTimersByTime(400) })
    expect(result.current).toBe(10 + 240 + 1800)
    vi.useRealTimers()
  })
})

// An invariant, not a convention: every app-runner surface prices THIS hook.
// A surface that reads only the store's seeded `estimatedCost` gates the run on
// the server's static figure again. A bare `useLiveRunEstimate(...)` statement,
// or a commented-out call, is a dead call — so the guard requires the result to
// be ASSIGNED and that binding to be USED again in the file.
describe("every runner surface prices the live estimate", () => {
  const SRC = resolve(__dirname, "../..")
  const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  for (const rel of ["components/presentation/presentation-view.tsx", "components/app-runner/mobile-app-shell.tsx"]) {
    it(`${rel} assigns useLiveRunEstimate's result and consumes it`, () => {
      const text = stripComments(readFileSync(resolve(SRC, rel), "utf8"))
      const m = text.match(/const\s+(\w+)\s*=\s*useLiveRunEstimate\(/)
      expect(m, "the hook's result must be assigned").not.toBeNull()
      const uses = text.match(new RegExp(`\\b${m![1]}\\b`, "g")) ?? []
      expect(uses.length, `${m![1]} is assigned but never read`).toBeGreaterThanOrEqual(2)
    })
  }
})
