import { UGC_PICK_GONE_MESSAGE } from "@nodaro/shared"
import { beforeEach, describe, expect, it, vi } from "vitest"

const t = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast: { success: t.success, error: t.error, info: vi.fn() } }))
vi.mock("@/lib/i18n", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/i18n")>()), tx: (k: string) => k }))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))

import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { pickUgcCreator, rerollUgcCreator, ugcCreditStopOf } from "../ugc-creator-run"

const rec = (u: string) => ({ v: 1, kind: "sampled", gender: "woman", identityImages: [u], traits: { t: 1 } })
const PAIR = [{ imageUrl: "https://cdn.example/a.png", record: rec("https://cdn.example/a.png") }, { imageUrl: "https://cdn.example/b.png", record: rec("https://cdn.example/b.png") }]
const seed = (readOnly = false, extra: Record<string, unknown> = {}) => useWorkflowStore.setState({ isReadOnly: readOnly, nodes: [{ id: "c", type: "ugc-creator", position: { x: 0, y: 0 }, data: { label: "c", source: "sampled", gender: "woman", keepResult: false, candidates: PAIR, ...extra } }] as never, edges: [] })
const data = () => useWorkflowStore.getState().nodes[0]!.data as Record<string, unknown>

beforeEach(() => vi.clearAllMocks())

describe("the pick", () => {
  it("Use this one keeps the picked creator, clears the options and the note", () => {
    seed(false, { optionFailed: true })
    expect(pickUgcCreator("c", 1)).toBe(true)
    expect(data()).toMatchObject({ result: PAIR[1]!.record, keepResult: true, executionStatus: "completed", generatedImageUrl: "https://cdn.example/b.png", ugcOutputs: { creator: JSON.stringify(PAIR[1]!.record), image: "https://cdn.example/b.png" } })
    expect(data().candidates).toBeUndefined()
    expect(data().optionFailed).toBeUndefined()
    expect(t.success).toHaveBeenCalledWith("ugc.creator.keptNext")
  })
  it("after a credits stop, the one option kept can be picked; the failure goes", () => {
    seed(false, { candidates: PAIR.slice(0, 1), executionStatus: "failed", errorMessage: "Not enough credits." })
    expect(pickUgcCreator("c", 0)).toBe(true)
    expect(data()).toMatchObject({ executionStatus: "completed", keepResult: true })
    expect(data().errorMessage).toBeUndefined()
  })
  it("a stale pick says so and writes nothing", () => {
    seed()
    expect(pickUgcCreator("c", 2)).toBe(false)
    expect(t.error).toHaveBeenCalledWith(UGC_PICK_GONE_MESSAGE)
    expect(data().candidates).toEqual(PAIR)
  })
  it("a read-only canvas never picks", () => {
    seed(true)
    expect(pickUgcCreator("c", 0)).toBe(false)
    expect(data().keepResult).toBe(false)
  })
  it("Show new options turns Keep off and runs the creator alone, as its re-draw", () => {
    const runSingleNode = vi.fn()
    seed()
    useWorkflowStore.setState({ runSingleNode })
    useWorkflowStore.getState().updateNodeData("c", { keepResult: true })
    rerollUgcCreator("c")
    expect(data().keepResult).toBe(false)
    expect(runSingleNode).toHaveBeenCalledWith("c", { redrawCreator: true })
  })
})

describe("the pick and the re-draw: the remaining rules", () => {
  it.each(["pending", "running"])("no pick and no re-draw while the node is %s: a run is starting, or running", (status) => {
    const runSingleNode = vi.fn()
    seed(false, { executionStatus: status })
    useWorkflowStore.setState({ runSingleNode })
    expect(pickUgcCreator("c", 0)).toBe(false)
    expect(data().candidates).toEqual(PAIR)
    expect(data().keepResult).toBe(false)
    rerollUgcCreator("c")
    expect(runSingleNode).not.toHaveBeenCalled()
  })

  it("another node type is never picked, and a missing node neither", () => {
    useWorkflowStore.setState({ isReadOnly: false, nodes: [{ id: "g", type: "generate-image", position: { x: 0, y: 0 }, data: { label: "g", candidates: PAIR } }] as never, edges: [] })
    expect(pickUgcCreator("g", 0)).toBe(false)
    expect(pickUgcCreator("nope", 0)).toBe(false)
  })
  it("a read-only canvas never re-draws", () => {
    const runSingleNode = vi.fn()
    seed(true)
    useWorkflowStore.setState({ runSingleNode })
    rerollUgcCreator("c")
    expect(runSingleNode).not.toHaveBeenCalled()
  })
  it("a server run's credits stop names its creator and the route's numbers; another failure, another node or a stop with no numbers does not", () => {
    expect(ugcCreditStopOf({ a: { status: "failed", nodeType: "ugc-creator", output: { ugcShortfall: { required: 18, balance: 5 } } } })).toEqual({ nodeId: "a", required: 18, balance: 5 })
    expect(ugcCreditStopOf({ a: { status: "failed", nodeType: "ugc-creator", output: { ugcCandidates: [] } } })).toBeNull()
    expect(ugcCreditStopOf({ a: { status: "failed", nodeType: "ugc-script", output: { ugcShortfall: { required: 18, balance: 5 } } } })).toBeNull()
    expect(ugcCreditStopOf({ a: { status: "completed", nodeType: "ugc-creator", output: { ugcShortfall: { required: 18, balance: 5 } } } })).toBeNull()
    expect(ugcCreditStopOf({})).toBeNull()
  })
})
