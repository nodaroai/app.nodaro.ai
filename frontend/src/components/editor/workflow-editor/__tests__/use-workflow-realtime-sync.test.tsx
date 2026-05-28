import { describe, it, expect, beforeEach, vi } from "vitest"
import { render } from "@testing-library/react"
import type { Node, Edge } from "@xyflow/react"
import { useWorkflowRealtimeSync } from "../use-workflow-realtime-sync"

// ---------------------------------------------------------------------------
// Supabase mock — capture the latest postgres_changes handler the hook
// registers so tests can fire UPDATE events synchronously, and record the
// channel name / filter / removeChannel calls for assertions.
// ---------------------------------------------------------------------------

interface SubscribeRecord {
  channelName: string
  event: string
  schema: string
  table: string
  filter: string
  handler: (payload: { new: unknown }) => void
}

const subscribeLog: SubscribeRecord[] = []
const removeChannelMock = vi.fn()
let nextChannelId = 0

function makeChannel(channelName: string) {
  const id = ++nextChannelId
  const channel = {
    __id: id,
    __channelName: channelName,
    on: vi.fn(
      (
        _event: string,
        cfg: {
          event: string
          schema: string
          table: string
          filter: string
        },
        handler: (payload: { new: unknown }) => void,
      ) => {
        subscribeLog.push({
          channelName,
          event: cfg.event,
          schema: cfg.schema,
          table: cfg.table,
          filter: cfg.filter,
          handler,
        })
        return channel
      },
    ),
    subscribe: vi.fn(() => channel),
  }
  return channel
}

const channelFactory = vi.fn((name: string) => makeChannel(name))

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    channel: (name: string) => channelFactory(name),
    removeChannel: (channel: unknown) => removeChannelMock(channel),
  }),
}))

// ---------------------------------------------------------------------------
// Test harness — drives the hook with controllable params + exposes the
// captured event handler so each test can fire a synthetic UPDATE payload
// and inspect the resulting callback invocations.
// ---------------------------------------------------------------------------

interface HarnessParams {
  workflowId: string | null | undefined
  currentNodes: readonly Node[]
  currentEdges: readonly Edge[]
  isDirty: boolean
  loadedUpdatedAt: string | null
  onReconcile: (args: {
    nodes: Node[]
    edges: Edge[]
    updatedAt: string
    settings: Record<string, unknown> | null
  }) => void
  onAppendNodes: (newNodes: Node[]) => void
  onAppendEdges: (newEdges: Edge[]) => void
  onRemoteUpdatedAt: (updatedAt: string) => void
}

function Harness(props: HarnessParams) {
  useWorkflowRealtimeSync({
    workflowId: props.workflowId,
    getCurrentNodes: () => props.currentNodes,
    getCurrentEdges: () => props.currentEdges,
    getIsDirty: () => props.isDirty,
    getLoadedUpdatedAt: () => props.loadedUpdatedAt,
    onReconcile: props.onReconcile,
    onAppendNodes: props.onAppendNodes,
    onAppendEdges: props.onAppendEdges,
    onRemoteUpdatedAt: props.onRemoteUpdatedAt,
  })
  return null
}

function makeNode(id: string): Node {
  return {
    id,
    type: "test-node",
    position: { x: 0, y: 0 },
    data: {},
  } as Node
}

function makeEdge(id: string, source: string, target: string): Edge {
  return { id, source, target } as Edge
}

function lastSubscription(): SubscribeRecord {
  if (subscribeLog.length === 0) {
    throw new Error("No subscription captured")
  }
  return subscribeLog[subscribeLog.length - 1]
}

function defaultProps(overrides: Partial<HarnessParams> = {}): HarnessParams {
  return {
    workflowId: "wf-1",
    currentNodes: [],
    currentEdges: [],
    isDirty: false,
    loadedUpdatedAt: null,
    onReconcile: vi.fn(),
    onAppendNodes: vi.fn(),
    onAppendEdges: vi.fn(),
    onRemoteUpdatedAt: vi.fn(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useWorkflowRealtimeSync", () => {
  beforeEach(() => {
    subscribeLog.length = 0
    removeChannelMock.mockClear()
    channelFactory.mockClear()
    nextChannelId = 0
  })

  it("subscribes on mount with the workflow:<id> channel name and id-filtered postgres_changes config", () => {
    render(<Harness {...defaultProps({ workflowId: "abc-123" })} />)

    expect(channelFactory).toHaveBeenCalledTimes(1)
    expect(channelFactory).toHaveBeenCalledWith("workflow:abc-123")

    const sub = lastSubscription()
    expect(sub.event).toBe("UPDATE")
    expect(sub.schema).toBe("public")
    expect(sub.table).toBe("workflows")
    expect(sub.filter).toBe("id=eq.abc-123")
  })

  it("does NOT subscribe when workflowId is null/undefined (hook is a no-op)", () => {
    const { rerender } = render(<Harness {...defaultProps({ workflowId: null })} />)
    expect(channelFactory).not.toHaveBeenCalled()

    rerender(<Harness {...defaultProps({ workflowId: undefined })} />)
    expect(channelFactory).not.toHaveBeenCalled()
  })

  it("unsubscribes on unmount", () => {
    const { unmount } = render(<Harness {...defaultProps()} />)
    expect(removeChannelMock).not.toHaveBeenCalled()
    unmount()
    expect(removeChannelMock).toHaveBeenCalledTimes(1)
  })

  it("tears down old subscription and opens a fresh one when workflowId changes", () => {
    const { rerender } = render(<Harness {...defaultProps({ workflowId: "wf-A" })} />)
    expect(channelFactory).toHaveBeenCalledTimes(1)
    expect(channelFactory).toHaveBeenLastCalledWith("workflow:wf-A")

    rerender(<Harness {...defaultProps({ workflowId: "wf-B" })} />)
    expect(removeChannelMock).toHaveBeenCalledTimes(1)
    expect(channelFactory).toHaveBeenCalledTimes(2)
    expect(channelFactory).toHaveBeenLastCalledWith("workflow:wf-B")
  })

  // -------------------------------------------------------------------------
  // Reconcile path (local clean)
  // -------------------------------------------------------------------------

  it("full reconciles when local state is clean (replaces nodes/edges with broadcast)", () => {
    const onReconcile = vi.fn()
    const onAppendNodes = vi.fn()
    const onAppendEdges = vi.fn()
    const local = [makeNode("n1"), makeNode("removed-node")]
    render(
      <Harness
        {...defaultProps({
          currentNodes: local,
          isDirty: false,
          loadedUpdatedAt: "2026-01-01T00:00:00Z",
          onReconcile,
          onAppendNodes,
          onAppendEdges,
        })}
      />,
    )

    const incomingNodes = [makeNode("n1"), makeNode("n2")] // "removed-node" gone
    const incomingEdges = [makeEdge("e1", "n1", "n2")]
    lastSubscription().handler({
      new: {
        id: "wf-1",
        nodes: incomingNodes,
        edges: incomingEdges,
        updated_at: "2026-01-02T00:00:00Z",
        settings: { characterDefinitions: [], flowPromptTemplates: {} },
      },
    })

    expect(onReconcile).toHaveBeenCalledTimes(1)
    const arg = onReconcile.mock.calls[0][0] as {
      nodes: Node[]
      edges: Edge[]
      updatedAt: string
      settings: Record<string, unknown> | null
    }
    expect(arg.nodes.map((n) => n.id)).toEqual(["n1", "n2"])
    expect(arg.edges.map((e) => e.id)).toEqual(["e1"])
    expect(arg.updatedAt).toBe("2026-01-02T00:00:00Z")
    expect(arg.settings).toEqual({ characterDefinitions: [], flowPromptTemplates: {} })
    expect(onAppendNodes).not.toHaveBeenCalled()
    expect(onAppendEdges).not.toHaveBeenCalled()
  })

  it("forwards null settings to the reconcile callback when the payload omits the column", () => {
    const onReconcile = vi.fn()
    render(
      <Harness
        {...defaultProps({
          isDirty: false,
          loadedUpdatedAt: "T0",
          onReconcile,
        })}
      />,
    )

    lastSubscription().handler({
      new: {
        id: "wf-1",
        nodes: [makeNode("n1")],
        edges: [],
        updated_at: "T1",
        // settings intentionally omitted (legacy/sparse row)
      },
    })

    expect(onReconcile).toHaveBeenCalledTimes(1)
    expect(
      (onReconcile.mock.calls[0][0] as { settings: unknown }).settings,
    ).toBeNull()
  })

  // -------------------------------------------------------------------------
  // Append-only path (local dirty)
  // -------------------------------------------------------------------------

  it("falls back to append-only when local state is dirty (preserves local edits)", () => {
    const onReconcile = vi.fn()
    const onAppendNodes = vi.fn()
    const onAppendEdges = vi.fn()
    const local = [makeNode("n1"), makeNode("locally-added")]
    render(
      <Harness
        {...defaultProps({
          currentNodes: local,
          isDirty: true,
          loadedUpdatedAt: "2026-01-01T00:00:00Z",
          onReconcile,
          onAppendNodes,
          onAppendEdges,
        })}
      />,
    )

    // Broadcast missing "locally-added" (because it isn't saved yet)
    // and bringing a new node "n2". Append-only contract must NOT
    // remove "locally-added" — only appends "n2".
    const incomingNodes = [makeNode("n1"), makeNode("n2")]
    lastSubscription().handler({
      new: {
        id: "wf-1",
        nodes: incomingNodes,
        edges: [],
        updated_at: "2026-01-02T00:00:00Z",
      },
    })

    expect(onReconcile).not.toHaveBeenCalled()
    expect(onAppendNodes).toHaveBeenCalledTimes(1)
    expect((onAppendNodes.mock.calls[0][0] as Node[]).map((n) => n.id)).toEqual(["n2"])
  })

  it("dirty + edges arrive: appends only new edge ids", () => {
    const onAppendEdges = vi.fn()
    const local = [makeEdge("e1", "a", "b")]
    render(
      <Harness
        {...defaultProps({
          currentEdges: local,
          isDirty: true,
          loadedUpdatedAt: "T0",
          onAppendEdges,
        })}
      />,
    )

    lastSubscription().handler({
      new: {
        id: "wf-1",
        nodes: [],
        edges: [makeEdge("e1", "a", "b"), makeEdge("e2", "b", "c")],
        updated_at: "T1",
      },
    })

    expect(onAppendEdges).toHaveBeenCalledTimes(1)
    expect((onAppendEdges.mock.calls[0][0] as Edge[]).map((e) => e.id)).toEqual(["e2"])
  })

  // -------------------------------------------------------------------------
  // Own-broadcast suppression
  // -------------------------------------------------------------------------

  it("skips broadcasts whose updated_at matches loadedUpdatedAt (own-save echo)", () => {
    const onReconcile = vi.fn()
    const onAppendNodes = vi.fn()
    const onRemoteUpdatedAt = vi.fn()
    render(
      <Harness
        {...defaultProps({
          isDirty: false,
          loadedUpdatedAt: "2026-01-02T00:00:00Z",
          onReconcile,
          onAppendNodes,
          onRemoteUpdatedAt,
        })}
      />,
    )

    lastSubscription().handler({
      new: {
        id: "wf-1",
        nodes: [makeNode("n1")],
        edges: [],
        updated_at: "2026-01-02T00:00:00Z", // matches local
      },
    })

    expect(onReconcile).not.toHaveBeenCalled()
    expect(onAppendNodes).not.toHaveBeenCalled()
    expect(onRemoteUpdatedAt).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Remote-divergence tracking
  // -------------------------------------------------------------------------

  it("reports remote updated_at on the dirty path (drives the divergence banner)", () => {
    const onRemoteUpdatedAt = vi.fn()
    render(
      <Harness
        {...defaultProps({
          isDirty: true,
          loadedUpdatedAt: "2026-01-01T00:00:00Z",
          onRemoteUpdatedAt,
        })}
      />,
    )

    lastSubscription().handler({
      new: {
        id: "wf-1",
        nodes: [makeNode("n1")],
        edges: [],
        updated_at: "2026-01-02T00:00:00Z",
      },
    })

    expect(onRemoteUpdatedAt).toHaveBeenCalledTimes(1)
    expect(onRemoteUpdatedAt).toHaveBeenCalledWith("2026-01-02T00:00:00Z")
  })

  it("does NOT call onRemoteUpdatedAt on the clean reconcile path (reconcileFromRemote clears it itself — avoid the wasted set→clear pair)", () => {
    const onReconcile = vi.fn()
    const onRemoteUpdatedAt = vi.fn()
    render(
      <Harness
        {...defaultProps({
          isDirty: false,
          loadedUpdatedAt: "T0",
          onReconcile,
          onRemoteUpdatedAt,
        })}
      />,
    )

    lastSubscription().handler({
      new: {
        id: "wf-1",
        nodes: [makeNode("n1")],
        edges: [],
        updated_at: "T1",
      },
    })

    expect(onReconcile).toHaveBeenCalledTimes(1)
    expect(onRemoteUpdatedAt).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Idempotency / fresh-callback contracts
  // -------------------------------------------------------------------------

  it("is idempotent in the clean path: replaying the SAME payload doesn't double-reconcile when loadedUpdatedAt has advanced", () => {
    // First event reconciles → caller advances loadedUpdatedAt to T1.
    // Second event with same updated_at=T1 must short-circuit.
    const onReconcile = vi.fn<(args: {
      nodes: Node[]
      edges: Edge[]
      updatedAt: string
    }) => void>()
    let loadedUpdatedAt: string | null = "T0"

    const { rerender } = render(
      <Harness
        {...defaultProps({
          isDirty: false,
          loadedUpdatedAt,
          onReconcile,
        })}
      />,
    )

    const handler = lastSubscription().handler
    handler({
      new: {
        id: "wf-1",
        nodes: [makeNode("n1")],
        edges: [],
        updated_at: "T1",
      },
    })
    expect(onReconcile).toHaveBeenCalledTimes(1)

    // Caller (store) advances loadedUpdatedAt to T1.
    loadedUpdatedAt = "T1"
    rerender(
      <Harness
        {...defaultProps({
          isDirty: false,
          loadedUpdatedAt,
          onReconcile,
        })}
      />,
    )

    handler({
      new: {
        id: "wf-1",
        nodes: [makeNode("n1")],
        edges: [],
        updated_at: "T1",
      },
    })
    expect(onReconcile).toHaveBeenCalledTimes(1)
  })

  it("uses the LATEST callbacks/state on each event (no stale closure)", () => {
    const onReconcile = vi.fn()
    let currentNodes: readonly Node[] = []
    let isDirty = true

    const { rerender } = render(
      <Harness
        {...defaultProps({
          currentNodes,
          isDirty,
          loadedUpdatedAt: "T0",
          onReconcile,
        })}
      />,
    )

    const handler = lastSubscription().handler

    // Local becomes clean (user saved). Re-render with the new state.
    isDirty = false
    currentNodes = [makeNode("locally-saved")]
    rerender(
      <Harness
        {...defaultProps({
          currentNodes,
          isDirty,
          loadedUpdatedAt: "T0",
          onReconcile,
        })}
      />,
    )

    handler({
      new: {
        id: "wf-1",
        nodes: [makeNode("from-remote")],
        edges: [],
        updated_at: "T2",
      },
    })

    // Should hit the reconcile path now because isDirty flipped to false.
    expect(onReconcile).toHaveBeenCalledTimes(1)
    expect(
      (onReconcile.mock.calls[0][0] as { nodes: Node[] }).nodes.map((n) => n.id),
    ).toEqual(["from-remote"])
  })

  it("tolerates payloads where new is null or required fields are missing/non-array", () => {
    const onReconcile = vi.fn()
    const onAppendNodes = vi.fn()
    const onAppendEdges = vi.fn()
    const onRemoteUpdatedAt = vi.fn()
    render(
      <Harness
        {...defaultProps({
          isDirty: false,
          loadedUpdatedAt: "T0",
          onReconcile,
          onAppendNodes,
          onAppendEdges,
          onRemoteUpdatedAt,
        })}
      />,
    )

    const handler = lastSubscription().handler

    // null new
    expect(() => handler({ new: null })).not.toThrow()
    // missing updated_at — must skip silently (no reconcile, no banner)
    expect(() =>
      handler({ new: { id: "wf-1", nodes: [], edges: [] } as { id: string; nodes: unknown[]; edges: unknown[] } }),
    ).not.toThrow()
    // non-array nodes / edges with valid updated_at — reconcile to empty
    handler({
      new: {
        id: "wf-1",
        nodes: null,
        edges: "not-an-array",
        updated_at: "T1",
      } as unknown as { id: string; nodes: unknown; edges: unknown; updated_at: string },
    })

    expect(onAppendNodes).not.toHaveBeenCalled()
    expect(onAppendEdges).not.toHaveBeenCalled()
    expect(onReconcile).toHaveBeenCalledTimes(1)
    const arg = onReconcile.mock.calls[0][0] as { nodes: Node[]; edges: Edge[] }
    expect(arg.nodes).toEqual([])
    expect(arg.edges).toEqual([])
    // Clean reconcile path doesn't call onRemoteUpdatedAt — the store's
    // reconcileFromRemote clears remoteUpdatedAt itself. Only the dirty
    // path tracks the divergence to drive the banner.
    expect(onRemoteUpdatedAt).not.toHaveBeenCalled()
  })
})
