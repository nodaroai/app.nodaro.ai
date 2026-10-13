import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, cleanup } from "@testing-library/react"

/**
 * A canvas run of a UGC node writes its outputs onto the node as run state, as
 * every other node's job poll does: the run is never a step of Undo (the lane
 * that paints a server run lands the same patch outside Undo too). The
 * person's own acts — the pick, an edit of the script's lines — stay one step
 * each, and an Undo never leaves a node "running" on a job that has ended.
 *
 * The real store and undo hooks; the routes and the job poll are stubbed.
 */

vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
const h = vi.hoisted(() => ({ polled: {} as Record<string, Record<string, unknown>> }))
vi.mock("../poll-job", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../poll-job")>()),
  pollScrapeJobOutput: vi.fn(async (jobId: string) => h.polled[jobId] ?? {}),
  pollJobOutputWithEnd: vi.fn(async (jobId: string) => ({ output: h.polled[jobId] ?? {} })),
}))
const api = vi.hoisted(() => ({
  ugcCreatorApi: vi.fn(), ugcCategoriesApi: vi.fn(), ugcScriptApi: vi.fn(), ugcClipsApi: vi.fn(),
  ugcQuoteApi: vi.fn(), ugcClipApi: vi.fn(), ugcCardsApi: vi.fn(), startUgcChildJob: vi.fn(),
}))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } }) }))
vi.mock("@/lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api")>()), ...api }))

import { ugcScriptOutputs } from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { flushPendingUndoSnapshot, useUndoRedoActions, useUndoRedoSubscription } from "@/hooks/use-undo-redo"
import { useUndoRedoStore } from "@/hooks/use-undo-redo-store"
import { pickUgcCreator } from "@/lib/ugc-creator-run"
import type { WorkflowNode } from "@/types/nodes"
import { executeUgcClip, executeUgcClips, executeUgcCreator, executeUgcScript } from "../ugc-execute"

const ctx = { userId: "user-1" } as never
const st = () => useWorkflowStore.getState()
const nodeOf = (id: string) => st().nodes.find((n) => n.id === id)!
const dataOf = (id: string) => nodeOf(id).data as Record<string, unknown>
const steps = () => {
  flushPendingUndoSnapshot()
  return useUndoRedoStore.getState().past.length
}
const node = (id: string, type: string, data: Record<string, unknown>) =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode

const img = (m: string) => ({ tool: "generate_image", args: { prompt: "p", model: m, aspect_ratio: "3:4" } })
const CHECK = { tool: "image_to_text", args: { custom_prompt: "q" }, passToken: "PASS", refusal: "R" }
/** A builder answer with two options, primary first (placeholders). */
const TWO = {
  kind: "sampled", seed: 7, gender: "woman", traits: { t: 1 }, identityImages: [], promptsVersion: "1.0.0", productCategory: "saas",
  image: { ...img("image-model-a"), fallback: img("image-model-c") },
  candidates: [{ model: "image-model-a", ...img("image-model-a") }, { model: "image-model-b", ...img("image-model-b") }],
  fallback: img("image-model-c"), pick: { how: "user" }, realismPass: null, secondFrame: null, photoCheck: null, genderCheck: CHECK,
}
const ticket = (i: number) => ({ v: 1, index: i, durationSec: 12, video: { tool: "t", args: {} } })

let undo: () => void

beforeEach(() => {
  vi.clearAllMocks()
  h.polled = {}
  useUndoRedoStore.getState().clear()
  useWorkflowStore.setState({ isReadOnly: false, readOnlyReason: null, saveRefusedFor: null })
  renderHook(() => useUndoRedoSubscription())
  const { result } = renderHook(() => useUndoRedoActions())
  undo = () => act(() => result.current.undo())
})

afterEach(() => {
  cleanup()
})

describe("a canvas UGC run is never a step of Undo", () => {
  it("UGC Script: the run adds no step, and an Undo after it is never a running node", async () => {
    st().loadWorkflow("wf-1", "W", [node("script", "ugc-script", { targetDurationSec: 15, keepResult: false })], [])
    act(() => st().updateNodeData("script", { targetDurationSec: 20 }))
    expect(steps()).toBe(1)

    api.ugcScriptApi.mockResolvedValue({ jobId: "job-s" })
    h.polled["job-s"] = { plan: { hook: "h" }, productCategory: "saas", warnings: [], notes: [], rounds: 1 }
    await executeUgcScript(nodeOf("script"), { ugc: { site: "Acme" } } as never, ctx, {})
    expect(dataOf("script").executionStatus).toBe("completed")
    expect(steps()).toBe(1)

    undo()
    expect(dataOf("script").targetDurationSec).toBe(15)
    expect(dataOf("script").executionStatus).not.toBe("running")
    expect(dataOf("script").currentJobId).toBeUndefined()
  })

  it("UGC Creator: a draw adds no step; after the pick, Undo brings the options back, then the edit before", async () => {
    st().loadWorkflow("wf-1", "W", [node("creator", "ugc-creator", { source: "sampled", gender: "woman", keepResult: false })], [])
    act(() => st().updateNodeData("creator", { gender: "man" }))
    act(() => st().updateNodeData("creator", { gender: "woman" }))
    expect(steps()).toBe(1)

    api.ugcCreatorApi.mockResolvedValueOnce(TWO)
    api.startUgcChildJob.mockResolvedValueOnce({ jobId: "img-a" }).mockResolvedValueOnce({ jobId: "img-b" })
      .mockResolvedValueOnce({ jobId: "read-a", generatedText: "PASS" }).mockResolvedValueOnce({ jobId: "read-b", generatedText: "PASS" })
    h.polled = { "img-a": { imageUrl: "https://cdn.example/a.png" }, "img-b": { imageUrl: "https://cdn.example/b.png" } }
    await executeUgcCreator(nodeOf("creator"), { ugc: { category: "saas" } } as never, ctx, {})
    expect((dataOf("creator").candidates as unknown[]).length).toBe(2)
    expect(steps()).toBe(1)

    act(() => {
      expect(pickUgcCreator("creator", 1)).toBe(true)
    })
    expect(steps()).toBe(2)
    expect(dataOf("creator").candidates).toBeUndefined()

    undo()
    expect((dataOf("creator").candidates as unknown[]).length).toBe(2)
    expect(dataOf("creator").executionStatus).toBe("completed")
    undo()
    expect(dataOf("creator").candidates).toBeUndefined()
    expect(dataOf("creator").executionStatus).not.toBe("running")
  })

  it("UGC Clips and UGC Clip: the tickets, the quote, the warnings, the length and a fan-out's notes row add no step", async () => {
    st().loadWorkflow("wf-1", "W", [node("clips", "ugc-clips", {}), node("clip", "ugc-clip", { rerender: {} })], [])
    api.ugcClipsApi.mockResolvedValue({ errors: [], tickets: [ticket(0)], sizedPlan: {}, transcript: "a", hasCards: false })
    api.ugcQuoteApi.mockResolvedValue({ lines: [{ label: "Clip 1 (12 s)", credits: 1 }], expected: 1, ceiling: 2 })
    await executeUgcClips(nodeOf("clips"), { ugc: { plan: JSON.stringify({ v: 1, hook: "h" }), creator: JSON.stringify({ v: 1, gender: "woman", identityImages: ["https://cdn.example/c.png"], traits: null }) } } as never, ctx, {})
    api.ugcClipApi.mockResolvedValue({ jobId: "job-c" })
    h.polled["job-c"] = { videoUrl: "https://cdn.example/c.mp4", durationSec: 13, clipWarnings: ["w"] }
    await executeUgcClip(nodeOf("clip"), {} as never, ctx, { listIterationIndex: 0, overrideInput: JSON.stringify(ticket(0)) })
    expect(dataOf("clip").durationSec).toBe(13)
    expect(steps()).toBe(0)
  })

  it("an edit of the script's lines is one step of its own", () => {
    const result = { plan: { hook: "h", beats: [{ line: "a" }], closer: { line: "c" } }, rounds: 1 }
    st().loadWorkflow("wf-1", "W", [node("script", "ugc-script", { result, keepResult: false, executionStatus: "completed" })], [])
    const next = { ...result, plan: { ...result.plan, hook: "edited" } }
    act(() => st().updateNodeData("script", { result: next, ugcOutputs: ugcScriptOutputs(next), keepResult: true }))
    expect(steps()).toBe(1)
    undo()
    expect((dataOf("script").result as { plan: { hook: string } }).plan.hook).toBe("h")
    expect(dataOf("script").keepResult).toBe(false)
  })
})
