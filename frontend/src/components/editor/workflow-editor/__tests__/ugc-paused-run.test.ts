/**
 * Pause → pick → Run from here, end to end, the editor's half: a toolbar Run's
 * states painted (UGC Script done, UGC Creator stopped with its options, the
 * rest skipped by the pause), then the pick — and the graph Run from here
 * starts from is pinned in `ugc-paused-run-picked.json`. The backend half
 * (`ugc-paused-run-continue.test.ts`) runs Run from here's input resolution
 * over that same graph: UGC Clips must receive both the script's plan and the
 * picked creator.
 */
import { describe, expect, it, vi } from "vitest"
import { act } from "@testing-library/react"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))

import { ugcRunWaitsForPick } from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { pickUgcCreator } from "@/lib/ugc-creator-run"
import { paintRunStates } from "../run-handlers"
import { nodeHasRunOutput } from "../run-up-to-here-set"
import outputs from "../../../../../../backend/src/services/workflow-engine/__tests__/fixtures/ugc-run-outputs.json"
import pinned from "../../../../../../backend/src/services/workflow-engine/__tests__/fixtures/ugc-paused-run-picked.json"

type Data = Record<string, unknown>
const O = outputs as Record<string, Data>
/** A node that ran in the run, at fixed times (the pinned graph is stable). */
const ran = (output: Data): Data => ({ status: "completed", startedAt: "2026-10-05T10:00:00.000Z", completedAt: "2026-10-05T10:00:20.000Z", jobId: "c0ffee00-0000-4000-8000-0000000000aa", output })
const nodeOf = (id: string, data: Data, type: string) => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } })
const edge = (source: string, target: string, sourceHandle: string, targetHandle: string) => ({ id: `${source}-${sourceHandle}-${target}-${targetHandle}`, source, target, sourceHandle, targetHandle })

const GRAPH = {
  nodes: [nodeOf("site", { text: "Acme" }, "text-prompt"), nodeOf("script", { targetDurationSec: 15, keepResult: false }, "ugc-script"),
    // The creator handed an older creator on in an earlier run: the options must clear it, the pick replace it.
    nodeOf("creator", { source: "sampled", gender: "woman", keepResult: false, generatedImageUrl: "https://cdn.example/old.png", ugcOutputs: { creator: "{\"v\":1}", image: "https://cdn.example/old.png" } }, "ugc-creator"),
    nodeOf("clips", {}, "ugc-clips"), nodeOf("clip", { rerender: {} }, "ugc-clip"), nodeOf("cards", {}, "ugc-cards")],
  edges: [edge("site", "script", "prompt", "site"), edge("script", "creator", "category", "category"), edge("script", "clips", "plan", "plan"), edge("creator", "clips", "creator", "creator"), edge("clips", "clip", "clips", "clip"), edge("clips", "cards", "plan-out", "plan")],
}

describe("pause, pick, Run from here", () => {
  it("a toolbar Run's states painted, the pick made: the graph Run from here starts from", () => {
    act(() => useWorkflowStore.setState({ nodes: GRAPH.nodes as never, edges: GRAPH.edges as never }))
    act(() => paintRunStates({
      script: ran(O["ugc-script"]!), creator: ran(O["ugc-creator:pair"]!),
      clips: { status: "skipped" }, clip: { status: "skipped" }, cards: { status: "skipped" },
    } as never, { runId: "exec-1" }))
    expect(ugcRunWaitsForPick(useWorkflowStore.getState().nodes)).toBe(true)        // a toolbar Run now is refused
    const waiting = useWorkflowStore.getState().nodes.find((n) => n.id === "creator")!
    expect((waiting.data as Data).ugcOutputs).toBeUndefined()                       // nothing handed on while options wait
    expect((waiting.data as Data).generatedImageUrl).toBeUndefined()
    expect(nodeHasRunOutput(waiting)).toBe(false)                                   // Run up to here below it runs it
    expect(nodeHasRunOutput(useWorkflowStore.getState().nodes.find((n) => n.id === "script")!)).toBe(true) // …and never buys the script again
    act(() => { expect(pickUgcCreator("creator", 0)).toBe(true) })
    const { nodes, edges } = useWorkflowStore.getState()
    expect(ugcRunWaitsForPick(nodes)).toBe(false)
    expect({ nodes: nodes.map(({ id, type, data }) => ({ id, type, data })), edges }, "update fixtures/ugc-paused-run-picked.json, then run the backend's ugc-paused-run-continue test").toEqual(pinned)
  })
})
