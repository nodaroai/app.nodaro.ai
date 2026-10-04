/**
 * The canvas Transition picker clears Duration and Intensity on a switch into an all-cut pick by writing the two keys
 * as `undefined` through the merging `updateNodeData` (the only door the panel's `onUpdate` offers). This pins what
 * that leaves behind, on the REAL path from the click to the wire:
 *
 * - the real panel, wired to the real workflow store exactly as `config-panel.tsx` wires it
 *   (`onUpdate` -> `updateNodeData(selectedNodeId, data)`), then the real persistence hook's `save()`; only the
 *   Supabase client (it records the payload) and the tile grid (it sends the value a click would send) are stand-ins.
 *   The saved node carries NO `duration` / `intensity` key, so a reload holds exactly what a fresh pick holds.
 * - for the stretch before the next load, while the in-memory node still holds the two keys as `undefined`: every
 *   reader of the node (`getParameterPromptHint`, the server-side run path's reader; `composeTransitionHintForNode`;
 *   the panel's lever rows) reads an `undefined` key exactly like an absent one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react"
import { getParameterPromptHint } from "@nodaro/prompts"
import type { WorkflowNode } from "@/types/nodes"

const mockSupabaseFrom = vi.fn()
const mockGetUser = vi.fn()

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock("@/ee/hooks/queries/use-credits-queries", () => ({
  prefetchModelCredits: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getBatchJobStatus: vi.fn().mockResolvedValue([]),
  syncWorkflowTriggers: vi.fn().mockResolvedValue({ data: { synced: true, created: 0, updated: 0, removed: 0 } }),
}))
vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase")>()),
  createClient: () => ({
    from: (...args: unknown[]) => mockSupabaseFrom(...args),
    rpc: vi.fn(),
    auth: { getUser: () => mockGetUser() },
  }),
}))
vi.mock("../locale-header", () => ({ LocaleHeader: () => null }))

// The tile grid sends the new pick through `onValueChange`: one button per value a click could produce.
const NEXT: ReadonlyArray<string | string[]> = ["seamless-match", ["seamless-match"], "whip-pan"]
vi.mock("@/lib/picker-ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/picker-ui")>()),
  TransitionPicker: ({ onValueChange }: { onValueChange: (v: string | string[]) => void }) => (
    <div>
      {NEXT.map((v) => (
        <button key={JSON.stringify(v)} type="button" onClick={() => onValueChange(v)}>
          {`pick ${JSON.stringify(v)}`}
        </button>
      ))}
    </div>
  ),
  CharacterFxPicker: () => null,
  CharacterMotionPicker: () => null,
}))

import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useWorkflowPersistence } from "@/hooks/use-workflow-persistence"
import { composeTransitionHintForNode } from "@/lib/cinematography-hints"
import { TransitionConfig } from "../parameter-configs"
import { ParameterPreviewContext } from "../parameter-preview-context"
import { transitionLeverValue, transitionLevers, transitionPickKind } from "../transition-levers"

const NODE_ID = "transition-1"

function seed(data: Record<string, unknown>) {
  const node = { id: NODE_ID, type: "transition", position: { x: 0, y: 0 }, data } as unknown as WorkflowNode
  useWorkflowStore.setState({
    workflowId: "wf-1",
    workflowName: "Flow",
    nodes: [node],
    edges: [],
    isDirty: false,
    isReadOnly: false,
    isWorkflowLoading: false,
    loadedVersion: 3,
    loadedUpdatedAt: "2026-01-01T00:00:00Z",
    lastSavedSnapshot: null,
  })
}

/** The panel on the store, wired the way `config-panel.tsx` wires it: `onUpdate` is `updateNodeData(selectedNodeId, data)`. */
function PanelOnTheStore() {
  const node = useWorkflowStore((s) => s.nodes.find((n) => n.id === NODE_ID)!)
  const update = (data: Record<string, unknown>) => useWorkflowStore.getState().updateNodeData(NODE_ID, data)
  return (
    <ParameterPreviewContext.Provider value={{ node, nodes: [node], edges: [] }}>
      <TransitionConfig data={node.data as never} onUpdate={update} sources={[]} fieldMappings={{}} onMapField={() => {}} nodes={[node]} />
    </ParameterPreviewContext.Provider>
  )
}

/** Run the real `save()` and return the node data of the payload that reached the (recording) Supabase client. */
async function saveAndReadPayload(): Promise<Record<string, unknown>> {
  const maybeSingle = vi.fn().mockResolvedValue({ data: { updated_at: "2026-01-02T00:00:00Z", version: 4 }, error: null })
  const select = vi.fn().mockReturnValue({ maybeSingle })
  const abortSignal = vi.fn().mockReturnValue({ select })
  const eqUpdatedAt = vi.fn().mockReturnValue({ select, abortSignal })
  const eqId = vi.fn().mockReturnValue({ select, eq: eqUpdatedAt, abortSignal })
  const update = vi.fn().mockReturnValue({ eq: eqId })
  mockSupabaseFrom.mockReturnValue({ update })

  const { result } = renderHook(() => useWorkflowPersistence("proj-1"))
  let saved: { success: boolean; error?: string } | undefined
  await act(async () => {
    saved = await result.current.save()
  })
  expect(saved, "the save went through").toEqual({ success: true })
  expect(update).toHaveBeenCalledTimes(1)
  const payload = update.mock.calls[0]![0] as { nodes: Array<{ id: string; data: Record<string, unknown> }> }
  const node = payload.nodes.find((n) => n.id === NODE_ID)
  expect(node, "the transition node is in the payload").toBeDefined()
  return node!.data
}

const pick = (v: string | string[]) => fireEvent.click(screen.getByText(`pick ${JSON.stringify(v)}`))

describe("a switch into an all-cut pick, saved: no duration / intensity key reaches the wire", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-123" } } })
  })
  afterEach(() => {
    // Unmount first: the panel reads its node off the store, and the store is about to lose it.
    cleanup()
    useWorkflowStore.setState({ nodes: [], edges: [], workflowId: null, isDirty: false })
  })

  it.each([
    ["cross-dissolve", "seamless-match"],
    [["cross-dissolve", "seamless-match"], ["seamless-match"]],
  ] as const)("%j -> %j: the saved node holds what a fresh pick holds", async (before, after) => {
    seed({ transition: before, position: "middle", duration: "short", intensity: "natural" })
    render(<PanelOnTheStore />)

    pick(after as string | string[])

    const memory = useWorkflowStore.getState().nodes[0]!.data as Record<string, unknown>
    expect(memory.transition).toEqual(after)
    expect(memory.duration).toBeUndefined()
    expect(memory.intensity).toBeUndefined()
    expect(useWorkflowStore.getState().isDirty, "the switch marks the canvas dirty").toBe(true)

    const saved = await saveAndReadPayload()
    // Strict equality (and the key list) so an own key holding `undefined` could not hide: the wire has no such key.
    expect(saved).toStrictEqual({ transition: after, position: "middle" })
    expect(Object.keys(saved)).not.toContain("duration")
    expect(Object.keys(saved)).not.toContain("intensity")
  })

  it("control: a switch that keeps the levers saves them (the test can see a key that is there)", async () => {
    seed({ transition: "cross-dissolve", position: "middle", duration: "short", intensity: "natural" })
    render(<PanelOnTheStore />)

    pick("whip-pan")

    const saved = await saveAndReadPayload()
    expect(saved).toStrictEqual({ transition: "whip-pan", position: "middle", duration: "short", intensity: "natural" })
  })
})

describe("an undefined duration / intensity key reads exactly like an absent one", () => {
  const ABSENT = { transition: "seamless-match", position: "middle" }
  const UNDEFINED_KEYS = { transition: "seamless-match", position: "middle", duration: undefined, intensity: undefined }
  const node = (data: Record<string, unknown>) => ({ id: NODE_ID, type: "transition", data })

  it("serializes to the same JSON", () => {
    expect(JSON.stringify(UNDEFINED_KEYS)).toBe(JSON.stringify(ABSENT))
  })

  it.each([undefined, "full", "compact"] as const)("getParameterPromptHint (hintMode %s): same string, with and without the graph context", (hintMode) => {
    const extra = hintMode ? { hintMode } : {}
    const ctx = { nodes: [], edges: [] }
    expect(getParameterPromptHint(node({ ...UNDEFINED_KEYS, ...extra }))).toBe(getParameterPromptHint(node({ ...ABSENT, ...extra })))
    expect(getParameterPromptHint(node({ ...UNDEFINED_KEYS, ...extra }), ctx)).toBe(getParameterPromptHint(node({ ...ABSENT, ...extra }), ctx))
  })

  it("composeTransitionHintForNode: same string, and it is the hard cut (the cleared Short does not blend)", () => {
    const cleared = composeTransitionHintForNode(UNDEFINED_KEYS as never)
    expect(cleared).toBe(composeTransitionHintForNode(ABSENT as never))
    expect(cleared).not.toContain("blend into each other")
    // The same node with the Short kept is the one that blends: clearing is what keeps the cut a cut.
    expect(composeTransitionHintForNode({ ...ABSENT, duration: "short" } as never)).toContain("blend into each other")
  })

  it("the panel's lever rows: same shown value on every lever, whichever way the keys are stored", () => {
    const kind = transitionPickKind(ABSENT.transition)
    expect(kind).toBe("blendable-cut")
    for (const lever of transitionLevers(kind)) {
      const key = lever.field as "position" | "duration" | "intensity"
      expect(transitionLeverValue(kind, lever, UNDEFINED_KEYS[key as keyof typeof UNDEFINED_KEYS])).toBe(
        transitionLeverValue(kind, lever, (ABSENT as Record<string, unknown>)[key]),
      )
    }
    const duration = transitionLevers(kind).find((l) => l.field === "duration")!
    expect(transitionLeverValue(kind, duration, UNDEFINED_KEYS.duration)).toBe("auto")
  })
})
