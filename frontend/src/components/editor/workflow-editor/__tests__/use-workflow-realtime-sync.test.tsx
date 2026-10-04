import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { act, render } from "@testing-library/react"
import type { Node, Edge } from "@xyflow/react"
import { stripStudioDraftWorkflow } from "@nodaro/shared"
import { useWorkflowRealtimeSync, VIEW_POLL_INTERVAL_MS } from "../use-workflow-realtime-sync"
import { ACCESS_RECHECK_INTERVAL_MS } from "../use-workflow-access-recheck"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { ACCESS_ASK_TIMEOUT_MS, requestAccessRecheck } from "@/hooks/workflow-access-mode"
import { hasSavableChanges, isSaveRefused } from "@/hooks/workflow-save-refusal"
import type { WorkflowNode } from "@/types/nodes"
import type { WorkflowAccessInfo, WorkflowAccessLevel, WorkflowDocument } from "@/lib/api"
import type { WorkflowContentAccess } from "@/lib/workflow-content"

// ---------------------------------------------------------------------------
// Supabase mock — capture the latest postgres_changes handler the hook
// registers so tests can fire UPDATE events synchronously, and record the
// channel name / filter / removeChannel calls for assertions. It also answers
// the one table read the hook makes — a `view` reader's content-free stamp
// (T85) — from `table.stamp`, logging each read in `stampReads`.
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

interface StampRead {
  table: string
  projection: string
  filters: Array<[string, unknown]>
}

/** The row's stamp as the table holds it now; null = no row the caller may read. */
const table: { stamp: { updated_at: string; version: number | null } | null } = { stamp: null }
const stampReads: StampRead[] = []

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    channel: (name: string) => channelFactory(name),
    removeChannel: (channel: unknown) => removeChannelMock(channel),
    from: (tableName: string) => ({
      select: (projection: string) => {
        const read: StampRead = { table: tableName, projection, filters: [] }
        stampReads.push(read)
        const query = {
          eq: (col: string, val: unknown) => {
            read.filters.push([col, val])
            return query
          },
          maybeSingle: async () => ({ data: table.stamp ? { ...table.stamp } : null, error: null }),
        }
        return query
      },
    }),
  }),
}))

// The server's door — `GET /v1/workflows/:id` — is the one network edge the
// re-read crosses; the real `readWorkflowContentFromServer` stays in the chain.
// `GET /v1/workflows/:id/access` is the one the access re-check crosses (T97);
// the real `applyWorkflowAccess` stays in that chain too.
const server = vi.hoisted(() => ({ getWorkflowDocument: vi.fn(), getWorkflowAccess: vi.fn() }))
vi.mock("@/lib/api", () => ({
  getWorkflowDocument: (id: string) => server.getWorkflowDocument(id),
  getWorkflowAccess: (id: string) => server.getWorkflowAccess(id),
  isNotFoundError: (err: unknown) => err instanceof Error && (err as { code?: unknown }).code === "not_found",
  getCurrentUserId: async () => undefined,
}))

/** `GET /v1/workflows/:id/access`'s body when it answers `access`. */
function accessInfo(access: Exclude<WorkflowAccessLevel, "none">): { data: WorkflowAccessInfo } {
  return {
    data: { access, workspaceId: null, visibility: "private", canChangeVisibility: false, canShare: false, canRun: true },
  }
}

/** What that route answers — `none` is its 404, as on every by-id route. */
function accessAnswer(access: WorkflowAccessLevel): Promise<{ data: WorkflowAccessInfo }> {
  return access === "none"
    ? Promise.reject(Object.assign(new Error("Workflow not found"), { code: "not_found" }))
    : Promise.resolve(accessInfo(access))
}

// ---------------------------------------------------------------------------
// Which of the two the canvas does — subscribe, or poll — the hook decides
// itself, from the access the load recorded in the REAL workflow store
// (`loadedAccess`, keyed by workflow id). The tests set that record exactly as
// the load does, so they pin the decision the canvas actually runs.
// ---------------------------------------------------------------------------

function loadedAs(workflowId: string, access: WorkflowContentAccess): void {
  act(() => {
    useWorkflowStore.setState({ loadedAccess: { workflowId, access } })
  })
}

function notLoaded(): void {
  act(() => {
    useWorkflowStore.setState({ loadedAccess: null })
  })
}

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
  /** The tab's CAS token; null = unknown (the pre-version-column behaviour). */
  loadedVersion?: number | null
  /** Whether a save is in flight (saveStatus === "saving"). */
  saveInFlight?: boolean
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
    getLoadedVersion: () => props.loadedVersion ?? null,
    getSaveInFlight: () => props.saveInFlight ?? false,
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
    stampReads.length = 0
    table.stamp = null
    server.getWorkflowDocument.mockReset()
    server.getWorkflowDocument.mockRejectedValue(new Error("a subscribed canvas never re-reads"))
    // Unless a test says otherwise, a re-check of the access (T97) finds it
    // unchanged.
    server.getWorkflowAccess.mockReset()
    server.getWorkflowAccess.mockImplementation(() => accessAnswer(useWorkflowStore.getState().loadedAccess?.access ?? "view"))
    // The tests in this outer block are about the OWNER's canvas: its load
    // answered `own` for wf-1, so it subscribes and adopts broadcasts.
    loadedAs("wf-1", "own")
  })

  it("subscribes on mount with the workflow:<id> channel name and id-filtered postgres_changes config", () => {
    loadedAs("abc-123", "own")
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
    loadedAs("wf-A", "own")
    const { rerender } = render(<Harness {...defaultProps({ workflowId: "wf-A" })} />)
    expect(channelFactory).toHaveBeenCalledTimes(1)
    expect(channelFactory).toHaveBeenLastCalledWith("workflow:wf-A")

    // Opening wf-B: its load has not answered yet, and wf-A's answer says
    // nothing about wf-B — the old channel goes, and no new one opens yet.
    rerender(<Harness {...defaultProps({ workflowId: "wf-B" })} />)
    expect(removeChannelMock).toHaveBeenCalledTimes(1)
    expect(channelFactory).toHaveBeenCalledTimes(1)

    // wf-B's load answers `own`.
    loadedAs("wf-B", "own")
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
  // Own-echo suppression by VERSION — a late echo of this tab's own older
  // save (a newer save already moved the updated_at cursor) must never read
  // as "another device": on the clean path it rewound the canvas + CAS token
  // (next save → false conflict toast), on the dirty path it paused autosave.
  // -------------------------------------------------------------------------

  it("skips a late echo of an older own save (version <= loadedVersion) on the clean path, even though updated_at differs", () => {
    const onReconcile = vi.fn()
    const onRemoteUpdatedAt = vi.fn()
    render(
      <Harness
        {...defaultProps({
          isDirty: false,
          loadedUpdatedAt: "T62",
          loadedVersion: 62,
          onReconcile,
          onRemoteUpdatedAt,
        })}
      />,
    )

    lastSubscription().handler({
      new: {
        id: "wf-1",
        nodes: [makeNode("stale-snapshot")],
        edges: [],
        updated_at: "T61",
        version: 61,
      },
    })

    expect(onReconcile).not.toHaveBeenCalled()
    expect(onRemoteUpdatedAt).not.toHaveBeenCalled()
  })

  it("skips a late echo of an older own save on the dirty path (no banner, no append, autosave keeps running)", () => {
    const onReconcile = vi.fn()
    const onAppendNodes = vi.fn()
    const onAppendEdges = vi.fn()
    const onRemoteUpdatedAt = vi.fn()
    render(
      <Harness
        {...defaultProps({
          currentNodes: [makeNode("n1")],
          isDirty: true,
          loadedUpdatedAt: "T62",
          loadedVersion: 62,
          onReconcile,
          onAppendNodes,
          onAppendEdges,
          onRemoteUpdatedAt,
        })}
      />,
    )

    lastSubscription().handler({
      new: {
        id: "wf-1",
        nodes: [makeNode("n1"), makeNode("deleted-since")],
        edges: [makeEdge("e-old", "n1", "deleted-since")],
        updated_at: "T61",
        version: 61,
      },
    })

    expect(onReconcile).not.toHaveBeenCalled()
    expect(onAppendNodes).not.toHaveBeenCalled()
    expect(onAppendEdges).not.toHaveBeenCalled()
    expect(onRemoteUpdatedAt).not.toHaveBeenCalled()
  })

  it("skips the tab's OWN in-flight save echo (newer version WHILE saving) — no banner, no autosave freeze", () => {
    // The completion save's ~116KB echo (version 21) travels the slow WAL and
    // arrives before the save's HTTP response advanced loadedVersion (still 20).
    // While the save is in flight, that newer version is OUR write; skipping it
    // is what stops the false "updated on another device" that stranded
    // remoteUpdatedAt and froze autosave.
    const onReconcile = vi.fn()
    const onAppendNodes = vi.fn()
    const onRemoteUpdatedAt = vi.fn()
    render(
      <Harness
        {...defaultProps({
          currentNodes: [makeNode("n1")],
          isDirty: true,
          loadedUpdatedAt: "T20",
          loadedVersion: 20,
          saveInFlight: true,
          onReconcile,
          onAppendNodes,
          onRemoteUpdatedAt,
        })}
      />,
    )

    lastSubscription().handler({
      new: { id: "wf-1", nodes: [makeNode("n1")], edges: [], updated_at: "T21", version: 21 },
    })

    expect(onRemoteUpdatedAt).not.toHaveBeenCalled()
    expect(onReconcile).not.toHaveBeenCalled()
    expect(onAppendNodes).not.toHaveBeenCalled()
  })

  it("still reports a genuinely newer version when NO save is in flight (real remotes are not suppressed)", () => {
    const onRemoteUpdatedAt = vi.fn()
    render(
      <Harness
        {...defaultProps({
          currentNodes: [makeNode("n1")],
          isDirty: true,
          loadedUpdatedAt: "T20",
          loadedVersion: 20,
          saveInFlight: false,
          onRemoteUpdatedAt,
        })}
      />,
    )

    lastSubscription().handler({
      new: { id: "wf-1", nodes: [makeNode("n1")], edges: [], updated_at: "T21", version: 21 },
    })

    expect(onRemoteUpdatedAt).toHaveBeenCalledWith("T21")
  })

  it("skips an updated_at-only write (same version: thumbnail, share toggle) — nothing to reconcile", () => {
    const onReconcile = vi.fn()
    const onRemoteUpdatedAt = vi.fn()
    render(
      <Harness
        {...defaultProps({
          isDirty: true,
          loadedUpdatedAt: "T62",
          loadedVersion: 62,
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
        updated_at: "T62-thumbnail",
        version: 62,
      },
    })

    expect(onReconcile).not.toHaveBeenCalled()
    expect(onRemoteUpdatedAt).not.toHaveBeenCalled()
  })

  it("still reconciles / reports a genuinely newer version (version > loadedVersion)", () => {
    const onReconcile = vi.fn()
    const onRemoteUpdatedAt = vi.fn()
    const { rerender } = render(
      <Harness
        {...defaultProps({
          isDirty: false,
          loadedUpdatedAt: "T62",
          loadedVersion: 62,
          onReconcile,
          onRemoteUpdatedAt,
        })}
      />,
    )
    const handler = lastSubscription().handler

    handler({
      new: { id: "wf-1", nodes: [makeNode("from-remote")], edges: [], updated_at: "T63", version: 63 },
    })
    expect(onReconcile).toHaveBeenCalledTimes(1)
    expect((onReconcile.mock.calls[0][0] as { version?: number | null }).version).toBe(63)

    rerender(
      <Harness
        {...defaultProps({
          isDirty: true,
          loadedUpdatedAt: "T63",
          loadedVersion: 63,
          onReconcile,
          onRemoteUpdatedAt,
        })}
      />,
    )
    handler({
      new: { id: "wf-1", nodes: [makeNode("from-remote")], edges: [], updated_at: "T64", version: 64 },
    })
    expect(onRemoteUpdatedAt).toHaveBeenCalledWith("T64")
  })

  it("falls back to the updated_at rule when either side has no version", () => {
    const onReconcile = vi.fn()
    render(
      <Harness
        {...defaultProps({
          isDirty: false,
          loadedUpdatedAt: "T0",
          loadedVersion: null,
          onReconcile,
        })}
      />,
    )

    // Versioned payload, versionless tab: updated_at differs → reconcile.
    lastSubscription().handler({
      new: { id: "wf-1", nodes: [makeNode("n1")], edges: [], updated_at: "T1", version: 1 },
    })
    expect(onReconcile).toHaveBeenCalledTimes(1)
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

  // -------------------------------------------------------------------------
  // Who subscribes, and who polls (T85 / T86). A broadcast is the row AS
  // STORED, and a studio production keeps its owner's drafts in it — empty
  // slots and runs in flight per scene, drafts in the bin, each take's voice
  // plan (T11 / T21 / T42). A canvas whose load answered `own` or `edit`
  // subscribes and adopts broadcasts as before; a `view` reader's canvas — or
  // one whose load has not answered — opens no subscription, polls the row's
  // content-free stamp and re-reads through the server's door when it moves.
  // -------------------------------------------------------------------------

  describe("who subscribes, and who polls (T85 / T86)", () => {
    const OWNER = "owner-1"

    /** The owner's stored row: a take's voice plan on the canvas node, an empty
     *  slot and a run in flight on the scene, an empty slot in the bin. */
    function storedRow(updatedAt: string, version: number) {
      return {
        id: "wf-1",
        user_id: OWNER,
        updated_at: updatedAt,
        version,
        edges: [],
        nodes: [{
          id: "clip-1", type: "generate-video", position: { x: 0, y: 0 },
          data: { generatedResults: [{ url: "https://cdn/take.mp4", revoiceTo: { voiceId: "owner-voice" }, voiceMode: "recast" }] },
        }],
        settings: {
          studio: {
            shots: [{ id: "s1", stillSlots: [{ id: "slot-1", prompt: "unsent words" }], pendingClips: [{ jobId: "job-1" }] }],
            trash: [{ id: "t1", kind: "slot", deletedAt: "2026-10-01T00:00:00Z" }],
          },
        },
      }
    }

    /** `GET /v1/workflows/:id`'s answer to a `view` reader: the platform's own strip. */
    function serverViewAnswer(row: ReturnType<typeof storedRow>): WorkflowDocument {
      const shown = stripStudioDraftWorkflow(row) as ReturnType<typeof storedRow>
      return {
        id: shown.id,
        projectId: null,
        userId: shown.user_id,
        folderId: null,
        name: "Production",
        version: shown.version,
        nodes: shown.nodes,
        edges: shown.edges,
        settings: shown.settings,
        createdAt: "2026-09-01T00:00:00Z",
        updatedAt: shown.updated_at,
        access: "view",
      }
    }

    /** The take and the first scene of a reconciled graph. */
    function reconciled(onReconcile: ReturnType<typeof vi.fn>, call = 0) {
      const arg = onReconcile.mock.calls[call]![0] as { nodes: Node[]; settings: Record<string, unknown>; version: number }
      const take = (arg.nodes[0]!.data as { generatedResults: Record<string, unknown>[] }).generatedResults[0]!
      const studio = arg.settings.studio as { shots: Record<string, unknown>[]; trash: unknown[] }
      return { take, scene: studio.shots[0]!, trash: studio.trash, version: arg.version }
    }

    let visibility: DocumentVisibilityState = "visible"
    function setVisibility(state: DocumentVisibilityState): void {
      visibility = state
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"))
      })
    }

    /** Let the clock run, and every promise it releases settle. */
    async function advance(ms: number): Promise<void> {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms)
        for (let i = 0; i < 20; i++) await Promise.resolve()
      })
    }

    /** A canvas that has loaded `T1` / version 1 of wf-1. */
    function held(overrides: Partial<HarnessParams> = {}): HarnessParams {
      return defaultProps({ loadedUpdatedAt: "T1", loadedVersion: 1, ...overrides })
    }

    beforeEach(() => {
      vi.useFakeTimers()
      visibility = "visible"
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility })
      table.stamp = { updated_at: "T1", version: 1 }
    })

    afterEach(() => {
      vi.useRealTimers()
      // Back to jsdom's own getter.
      delete (document as unknown as { visibilityState?: unknown }).visibilityState
    })

    it("a `view` reader's canvas opens no subscription: it polls the stamp, and re-reads through the server when the row moves", async () => {
      loadedAs("wf-1", "view")
      const onReconcile = vi.fn()
      render(<Harness {...held({ onReconcile })} />)
      await advance(0)

      expect(channelFactory).not.toHaveBeenCalled()
      // It looked once on opening, and read nothing but the stamp.
      expect(stampReads).toEqual([{ table: "workflows", projection: "updated_at, version", filters: [["id", "wf-1"]] }])
      expect(server.getWorkflowDocument).not.toHaveBeenCalled()

      // Nothing moved: the next look asks for nothing more.
      await advance(VIEW_POLL_INTERVAL_MS)
      expect(stampReads).toHaveLength(2)
      expect(server.getWorkflowDocument).not.toHaveBeenCalled()

      // The owner saves.
      table.stamp = { updated_at: "T2", version: 2 }
      server.getWorkflowDocument.mockResolvedValue(serverViewAnswer(storedRow("T2", 2)))
      await advance(VIEW_POLL_INTERVAL_MS)

      expect(server.getWorkflowDocument).toHaveBeenCalledTimes(1)
      expect(server.getWorkflowDocument).toHaveBeenCalledWith("wf-1")
      expect(onReconcile).toHaveBeenCalledTimes(1)
      const { take, scene, trash, version } = reconciled(onReconcile)
      expect(take.url).toBe("https://cdn/take.mp4")
      expect("revoiceTo" in take).toBe(false)
      expect("voiceMode" in take).toBe(false)
      expect("stillSlots" in scene).toBe(false)
      expect("pendingClips" in scene).toBe(false)
      expect(trash).toEqual([])
      expect(version).toBe(2)
      expect(channelFactory).not.toHaveBeenCalled()
    })

    it("a move of either value re-reads — an `updated_at`-only write too — and adopts nothing the canvas already holds", async () => {
      loadedAs("wf-1", "view")
      const onReconcile = vi.fn()
      render(<Harness {...held({ onReconcile })} />)
      await advance(0)

      // A thumbnail or share toggle: `updated_at` moves, the content version does not.
      table.stamp = { updated_at: "T1-thumbnail", version: 1 }
      server.getWorkflowDocument.mockResolvedValue(serverViewAnswer(storedRow("T1-thumbnail", 1)))
      await advance(VIEW_POLL_INTERVAL_MS)

      expect(server.getWorkflowDocument).toHaveBeenCalledTimes(1)
      expect(onReconcile).not.toHaveBeenCalled()
    })

    it.each(["own", "edit"] as const)("an `%s` canvas subscribes and adopts the broadcast as it arrived — raw, with no poll and no re-read", async (access) => {
      loadedAs("wf-1", access)
      const onReconcile = vi.fn()
      render(<Harness {...held({ onReconcile })} />)

      expect(channelFactory).toHaveBeenCalledTimes(1)
      lastSubscription().handler({ new: storedRow("T2", 2) })

      expect(onReconcile).toHaveBeenCalledTimes(1)
      const { take, scene } = reconciled(onReconcile)
      expect(take.revoiceTo).toEqual({ voiceId: "owner-voice" })
      expect(scene.stillSlots).toEqual([{ id: "slot-1", prompt: "unsent words" }])

      await advance(VIEW_POLL_INTERVAL_MS * 3)
      expect(stampReads).toEqual([])
      expect(server.getWorkflowDocument).not.toHaveBeenCalled()
      // No poll timer. The one timer is the access re-check's (T97).
      expect(vi.getTimerCount()).toBe(1)
    })

    it("fails closed while the load has not answered: no subscription, and a canvas holding nothing asks nothing", async () => {
      notLoaded()
      // The load is in flight: the canvas holds no row yet.
      const { rerender } = render(<Harness {...defaultProps({ loadedUpdatedAt: null })} />)
      await advance(VIEW_POLL_INTERVAL_MS * 3)

      expect(channelFactory).not.toHaveBeenCalled()
      expect(stampReads).toEqual([])
      expect(server.getWorkflowDocument).not.toHaveBeenCalled()

      // The load answers `own`: the subscription opens, and the poll is gone.
      // The one timer left is the access re-check's, armed now that the load
      // has answered (T97).
      rerender(<Harness {...held()} />)
      loadedAs("wf-1", "own")
      expect(channelFactory).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(1)
    })

    it("fails closed after a failed load, or on an answer about another workflow: treated as `view`, never subscribed", async () => {
      // A failed load records nothing, and leaves the canvas holding nothing.
      notLoaded()
      const { unmount } = render(<Harness {...defaultProps({ loadedUpdatedAt: null })} />)
      await advance(VIEW_POLL_INTERVAL_MS * 3)
      expect(channelFactory).not.toHaveBeenCalled()
      expect(stampReads).toEqual([])
      unmount()

      // `own` — but answered for wf-0, not the wf-1 on the canvas.
      loadedAs("wf-0", "own")
      render(<Harness {...held()} />)
      await advance(VIEW_POLL_INTERVAL_MS)
      expect(channelFactory).not.toHaveBeenCalled()
      expect(stampReads.length).toBeGreaterThan(0)
    })

    it("coalesces re-reads: a burst of changes while one is in flight costs at most two GETs", async () => {
      loadedAs("wf-1", "view")
      const onReconcile = vi.fn()
      const pending: Array<(doc: WorkflowDocument) => void> = []
      server.getWorkflowDocument.mockImplementation(() => new Promise<WorkflowDocument>((resolve) => { pending.push(resolve) }))
      render(<Harness {...held({ onReconcile })} />)
      await advance(0)

      for (let v = 2; v <= 7; v++) {
        table.stamp = { updated_at: `T${v}`, version: v }
        await advance(VIEW_POLL_INTERVAL_MS)
      }
      expect(server.getWorkflowDocument).toHaveBeenCalledTimes(1)

      pending[0]!(serverViewAnswer(storedRow("T3", 3)))
      await advance(0)
      // The one trailing re-read, which reads the row as it is now.
      expect(server.getWorkflowDocument).toHaveBeenCalledTimes(2)
      pending[1]!(serverViewAnswer(storedRow("T7", 7)))
      await advance(VIEW_POLL_INTERVAL_MS * 3)

      expect(server.getWorkflowDocument).toHaveBeenCalledTimes(2)
      expect(onReconcile.mock.calls.map(([arg]) => (arg as { version: number }).version)).toEqual([3, 7])
    })

    it("a hidden tab does not poll; it looks again the moment it is visible, and resumes", async () => {
      loadedAs("wf-1", "view")
      render(<Harness {...held()} />)
      await advance(0)
      expect(stampReads).toHaveLength(1)

      setVisibility("hidden")
      table.stamp = { updated_at: "T2", version: 2 }
      await advance(VIEW_POLL_INTERVAL_MS * 5)
      expect(stampReads).toHaveLength(1)
      expect(server.getWorkflowDocument).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)

      server.getWorkflowDocument.mockResolvedValue(serverViewAnswer(storedRow("T2", 2)))
      setVisibility("visible")
      await advance(0)
      expect(stampReads).toHaveLength(2)
      expect(server.getWorkflowDocument).toHaveBeenCalledTimes(1)

      await advance(VIEW_POLL_INTERVAL_MS)
      expect(stampReads).toHaveLength(3)
    })

    it("a canvas that opens in a hidden tab polls only once it is shown", async () => {
      visibility = "hidden"
      loadedAs("wf-1", "view")
      render(<Harness {...held()} />)
      await advance(VIEW_POLL_INTERVAL_MS * 3)
      expect(stampReads).toEqual([])

      setVisibility("visible")
      await advance(0)
      expect(stampReads).toHaveLength(1)
    })

    it("unmounting leaves no timer and no listener behind", async () => {
      loadedAs("wf-1", "view")
      const { unmount } = render(<Harness {...held()} />)
      await advance(0)
      // The stamp poll's, and the access re-check's (T97).
      expect(vi.getTimerCount()).toBe(2)

      unmount()
      expect(vi.getTimerCount()).toBe(0)

      // The visibility listener went with it: showing the tab restarts nothing.
      setVisibility("hidden")
      setVisibility("visible")
      await advance(VIEW_POLL_INTERVAL_MS * 3)
      expect(vi.getTimerCount()).toBe(0)
      expect(stampReads).toHaveLength(1)
    })

    it("a dirty canvas re-reads once per move, not on every look", async () => {
      loadedAs("wf-1", "view")
      const onRemoteUpdatedAt = vi.fn()
      server.getWorkflowDocument.mockResolvedValue(serverViewAnswer(storedRow("T2", 2)))
      render(<Harness {...held({ isDirty: true, currentNodes: [makeNode("moved-by-hand")], onRemoteUpdatedAt })} />)
      await advance(0)

      table.stamp = { updated_at: "T2", version: 2 }
      await advance(VIEW_POLL_INTERVAL_MS * 4)

      // Dirty keeps its append-only path, so the canvas still holds T1 — and
      // still re-reads only once for the one move.
      expect(server.getWorkflowDocument).toHaveBeenCalledTimes(1)
      expect(onRemoteUpdatedAt).toHaveBeenCalledWith("T2")
    })

    it("a failed re-read is asked again on the next look", async () => {
      loadedAs("wf-1", "view")
      const onReconcile = vi.fn()
      server.getWorkflowDocument
        .mockRejectedValueOnce(new Error("network"))
        .mockResolvedValue(serverViewAnswer(storedRow("T2", 2)))
      render(<Harness {...held({ onReconcile })} />)
      await advance(0)

      table.stamp = { updated_at: "T2", version: 2 }
      await advance(VIEW_POLL_INTERVAL_MS)
      expect(server.getWorkflowDocument).toHaveBeenCalledTimes(1)
      expect(onReconcile).not.toHaveBeenCalled()

      await advance(VIEW_POLL_INTERVAL_MS)
      expect(server.getWorkflowDocument).toHaveBeenCalledTimes(2)
      expect(onReconcile).toHaveBeenCalledTimes(1)
    })

    it("a re-read that lands after the editor moved to another workflow is dropped", async () => {
      loadedAs("wf-1", "view")
      const onReconcile = vi.fn()
      let release: (doc: WorkflowDocument) => void = () => {}
      server.getWorkflowDocument.mockImplementation(() => new Promise<WorkflowDocument>((resolve) => { release = resolve }))
      const { rerender } = render(<Harness {...held({ onReconcile })} />)
      await advance(0)
      table.stamp = { updated_at: "T2", version: 2 }
      await advance(VIEW_POLL_INTERVAL_MS)
      expect(server.getWorkflowDocument).toHaveBeenCalledTimes(1)

      rerender(<Harness {...held({ workflowId: "wf-2", loadedUpdatedAt: null, onReconcile })} />)
      release(serverViewAnswer(storedRow("T2", 2)))
      await advance(0)
      expect(onReconcile).not.toHaveBeenCalled()
    })

    it("a re-read that comes back older than what the canvas already holds is dropped", async () => {
      loadedAs("wf-1", "view")
      const onReconcile = vi.fn()
      let release: (doc: WorkflowDocument) => void = () => {}
      server.getWorkflowDocument.mockImplementation(() => new Promise<WorkflowDocument>((resolve) => { release = resolve }))
      const { rerender } = render(<Harness {...held({ onReconcile })} />)
      await advance(0)
      table.stamp = { updated_at: "T2", version: 2 }
      await advance(VIEW_POLL_INTERVAL_MS)

      // Before the re-read lands, the canvas already moved to version 3.
      rerender(<Harness {...held({ loadedUpdatedAt: "T3", loadedVersion: 3, onReconcile })} />)
      release(serverViewAnswer(storedRow("T2", 2)))
      await advance(0)
      expect(onReconcile).not.toHaveBeenCalled()
    })

    // -----------------------------------------------------------------------
    // T97: the access is not only what the load was told. While the canvas is
    // open it is re-asked — every minute while the tab is visible, as soon as
    // the tab is shown again, and when a save misses in a way that can mean the
    // access changed — and each answer goes into the same `loadedAccess`
    // record, so the decision above follows it.
    // -----------------------------------------------------------------------

    describe("re-asking the access while the canvas is open (T97)", () => {
      /** Where a finished load leaves the store, as the canvas reads it. */
      function openedAs(workflowId: string, access: WorkflowContentAccess): void {
        act(() => {
          useWorkflowStore.setState({
            workflowId,
            loadedAccess: { workflowId, access },
            isReadOnly: access === "view",
            readOnlyReason: null,
            runBlockedReason: null,
            saveRefusedFor: null,
            nodes: [],
            isDirty: false,
          })
        })
      }

      /** What `GET /v1/workflows/:id/access` answers from now on. */
      function accessIsNow(access: WorkflowAccessLevel): void {
        server.getWorkflowAccess.mockImplementation(() => accessAnswer(access))
      }

      /**
       * What the save path does when a save matched no row and was turned away,
       * or met a row the tab can no longer read: the same call, so these tests
       * run the trigger the save path pulls (its side is pinned in
       * use-workflow-persistence-save.test.ts).
       */
      function saveMisses(): void {
        act(() => {
          requestAccessRecheck("wf-1")
        })
      }

      /** A canvas node waiting on `jobId`, as a run leaves it before its result lands. */
      function running(id: string, jobId: string): WorkflowNode {
        return {
          id,
          type: "generate-image",
          position: { x: 0, y: 0 },
          data: { label: id, executionStatus: "running", currentJobId: jobId },
        } as unknown as WorkflowNode
      }

      /** A run's last write: its result, and the job it no longer waits on (poll-job.ts). */
      function finishes(id: string, imageUrl: string): void {
        act(() => {
          useWorkflowStore.getState().updateNodeData(id, {
            executionStatus: "completed",
            generatedImageUrl: imageUrl,
            currentJobId: undefined,
            currentJobProgress: undefined,
          })
        })
      }

      function nodeData(id: string): Record<string, unknown> | undefined {
        return useWorkflowStore.getState().nodes.find((n) => n.id === id)?.data as Record<string, unknown> | undefined
      }

      const triggers = {
        "the slow timer": () => advance(ACCESS_RECHECK_INTERVAL_MS),
        "the tab shown again": async () => {
          setVisibility("hidden")
          setVisibility("visible")
          await advance(0)
        },
        "a save that missed": async () => {
          saveMisses()
          await advance(0)
        },
      }

      afterEach(() => {
        act(() => {
          useWorkflowStore.setState({
            workflowId: null,
            isReadOnly: false,
            readOnlyReason: null,
            runBlockedReason: null,
            saveRefusedFor: null,
            nodes: [],
            isDirty: false,
          })
        })
      })

      it.each(Object.keys(triggers) as Array<keyof typeof triggers>)(
        "an `edit` collaborator lowered to `view` loses the subscription, stops saving, polls the stripped row and, with no run in flight, goes read-only at once — %s",
        async (trigger) => {
          openedAs("wf-1", "edit")
          const onReconcile = vi.fn()
          render(<Harness {...held({ onReconcile })} />)
          await advance(0)
          expect(channelFactory).toHaveBeenCalledTimes(1)
          // Nothing asked on mount: the load has just asked.
          expect(server.getWorkflowAccess).not.toHaveBeenCalled()

          accessIsNow("view")
          await triggers[trigger]()

          expect(server.getWorkflowAccess).toHaveBeenCalledTimes(1)
          expect(server.getWorkflowAccess).toHaveBeenCalledWith("wf-1")
          expect(removeChannelMock).toHaveBeenCalledTimes(1)
          const s = useWorkflowStore.getState()
          expect(s.loadedAccess).toEqual({ workflowId: "wf-1", access: "view" })
          expect(isSaveRefused(s)).toBe(true)
          expect(s.isReadOnly).toBe(true)
          expect(s.readOnlyReason).toBe("This workflow is read-only for you.")
          // It polls instead: one look on the spot, content-free...
          expect(stampReads).toEqual([{ table: "workflows", projection: "updated_at, version", filters: [["id", "wf-1"]] }])

          // ...and when the owner saves, it re-reads through the server's door.
          table.stamp = { updated_at: "T2", version: 2 }
          server.getWorkflowDocument.mockResolvedValue(serverViewAnswer(storedRow("T2", 2)))
          await advance(VIEW_POLL_INTERVAL_MS)
          expect(server.getWorkflowDocument).toHaveBeenCalledTimes(1)
          const { take, scene } = reconciled(onReconcile)
          expect("revoiceTo" in take).toBe(false)
          expect("stillSlots" in scene).toBe(false)
          expect(channelFactory).toHaveBeenCalledTimes(1)
        },
      )

      it("an answer of `none` — the route's 404 — does the same: no subscription, no saves, the poll, read-only", async () => {
        openedAs("wf-1", "edit")
        render(<Harness {...held()} />)
        await advance(0)

        accessIsNow("none")
        await advance(ACCESS_RECHECK_INTERVAL_MS)

        expect(removeChannelMock).toHaveBeenCalledTimes(1)
        expect(useWorkflowStore.getState().loadedAccess).toEqual({ workflowId: "wf-1", access: "none" })
        expect(isSaveRefused(useWorkflowStore.getState())).toBe(true)
        expect(useWorkflowStore.getState().isReadOnly).toBe(true)
        expect(stampReads).toHaveLength(1)
      })

      it("a removed collaborator's save miss re-checks at once: `none` closes the subscription, stops the saves, polls and freezes the canvas", async () => {
        // Removed, they can no longer read the row, so the save path reads
        // their miss as `unknown` and asks (its side: the persistence tests).
        openedAs("wf-1", "edit")
        render(<Harness {...held()} />)
        await advance(0)

        accessIsNow("none")
        saveMisses()
        await advance(0)

        expect(server.getWorkflowAccess).toHaveBeenCalledTimes(1)
        expect(removeChannelMock).toHaveBeenCalledTimes(1)
        const s = useWorkflowStore.getState()
        expect(s.loadedAccess).toEqual({ workflowId: "wf-1", access: "none" })
        expect(isSaveRefused(s)).toBe(true)
        expect(s.isReadOnly).toBe(true)
        expect(stampReads).toEqual([{ table: "workflows", projection: "updated_at, version", filters: [["id", "wf-1"]] }])
      })

      it("a downgrade mid-run stops the saves and the subscription at once, lands every run's result, and only then turns read-only", async () => {
        // Read-only makes `updateNodeData` a no-op: raised while a job is out,
        // it would drop the result of a job already paid for (the store's
        // `saveRefusedFor` doc). So it waits until no node holds a job.
        openedAs("wf-1", "edit")
        act(() => {
          useWorkflowStore.setState({ nodes: [running("n1", "job-1"), running("n2", "job-2")] })
        })
        render(<Harness {...held()} />)
        await advance(0)

        accessIsNow("view")
        await advance(ACCESS_RECHECK_INTERVAL_MS)

        // At once: the subscription is gone, the poll has looked, and nothing
        // more is sent.
        expect(removeChannelMock).toHaveBeenCalledTimes(1)
        expect(stampReads).toHaveLength(1)
        expect(useWorkflowStore.getState().loadedAccess).toEqual({ workflowId: "wf-1", access: "view" })
        expect(isSaveRefused(useWorkflowStore.getState())).toBe(true)
        // Not yet: two jobs are out.
        expect(useWorkflowStore.getState().isReadOnly).toBe(false)

        finishes("n1", "https://cdn/n1.png")
        expect(nodeData("n1")).toMatchObject({ executionStatus: "completed", generatedImageUrl: "https://cdn/n1.png" })
        expect(nodeData("n1")?.currentJobId).toBeUndefined()
        // One job is still out.
        expect(useWorkflowStore.getState().isReadOnly).toBe(false)

        // A later re-check that says `view` again changes nothing about that.
        await advance(ACCESS_RECHECK_INTERVAL_MS)
        expect(server.getWorkflowAccess).toHaveBeenCalledTimes(2)
        expect(useWorkflowStore.getState().isReadOnly).toBe(false)

        finishes("n2", "https://cdn/n2.png")
        expect(nodeData("n2")).toMatchObject({ executionStatus: "completed", generatedImageUrl: "https://cdn/n2.png" })
        // The last result landed; now the canvas freezes, as a `view` load does.
        const s = useWorkflowStore.getState()
        expect(s.isReadOnly).toBe(true)
        expect(s.readOnlyReason).toBe("This workflow is read-only for you.")
      })

      it.each(["the slow timer", "the tab shown again"] as const)(
        "a dirty canvas frozen by %s refuses its saves too, so leaving it offers no Save that would write nothing",
        async (trigger) => {
          // A read-only canvas's save returns success without writing, so the
          // unsaved-changes dialog's Save would report a save that kept nothing.
          // A refused save is what keeps that dialog from offering it.
          openedAs("wf-1", "edit")
          act(() => {
            useWorkflowStore.setState({ isDirty: true })
          })
          render(<Harness {...held({ isDirty: true })} />)
          await advance(0)
          expect(hasSavableChanges(useWorkflowStore.getState())).toBe(true)

          accessIsNow("view")
          await triggers[trigger]()

          const s = useWorkflowStore.getState()
          expect(s.isReadOnly).toBe(true)
          expect(isSaveRefused(s)).toBe(true)
          expect(hasSavableChanges(s)).toBe(false)
          // The browser's own close prompt still guards the unsaved work.
          expect(s.isDirty).toBe(true)
        },
      )

      it("an upgrade opens the subscription again on the next re-check, and the poll stops; the canvas stays read-only until reloaded", async () => {
        openedAs("wf-1", "view")
        render(<Harness {...held()} />)
        await advance(0)
        expect(channelFactory).not.toHaveBeenCalled()

        accessIsNow("edit")
        await advance(ACCESS_RECHECK_INTERVAL_MS)

        expect(channelFactory).toHaveBeenCalledTimes(1)
        expect(channelFactory).toHaveBeenLastCalledWith("workflow:wf-1")
        expect(useWorkflowStore.getState().loadedAccess).toEqual({ workflowId: "wf-1", access: "edit" })
        // It may be holding the reader's projection; writable, it would save
        // that back over the owner's drafts.
        expect(useWorkflowStore.getState().isReadOnly).toBe(true)
        const reads = stampReads.length
        await advance(VIEW_POLL_INTERVAL_MS * 3)
        expect(stampReads).toHaveLength(reads)
      })

      it("the owner keeps the subscription when the answer narrows — it is their row — and the canvas still stops saving and turns read-only", async () => {
        // The creator of a workflow in an archived workspace is answered `view`.
        openedAs("wf-1", "own")
        render(<Harness {...held()} />)
        await advance(0)

        accessIsNow("view")
        await advance(ACCESS_RECHECK_INTERVAL_MS)

        expect(server.getWorkflowAccess).toHaveBeenCalledTimes(1)
        expect(removeChannelMock).not.toHaveBeenCalled()
        expect(stampReads).toEqual([])
        expect(useWorkflowStore.getState().loadedAccess).toEqual({ workflowId: "wf-1", access: "own" })
        expect(isSaveRefused(useWorkflowStore.getState())).toBe(true)
        expect(useWorkflowStore.getState().isReadOnly).toBe(true)
      })

      it("a failed re-check keeps the current mode — subscribed and writable — and the next one asks again", async () => {
        // Decided, not defaulted: failing closed to `view` would freeze the
        // canvas of every collaborator whose network blinks (the shown-again
        // re-check fires as a laptop wakes), and an upgrade never lifts
        // read-only, so it would stay frozen until reloaded.
        openedAs("wf-1", "edit")
        server.getWorkflowAccess.mockRejectedValueOnce(new Error("network"))
        render(<Harness {...held()} />)
        await advance(ACCESS_RECHECK_INTERVAL_MS)

        expect(server.getWorkflowAccess).toHaveBeenCalledTimes(1)
        expect(removeChannelMock).not.toHaveBeenCalled()
        expect(stampReads).toEqual([])
        expect(useWorkflowStore.getState().loadedAccess).toEqual({ workflowId: "wf-1", access: "edit" })
        expect(useWorkflowStore.getState().isReadOnly).toBe(false)
        expect(isSaveRefused(useWorkflowStore.getState())).toBe(false)

        accessIsNow("view")
        await advance(ACCESS_RECHECK_INTERVAL_MS)
        expect(removeChannelMock).toHaveBeenCalledTimes(1)
      })

      it("an ask that never settles times out, and the trigger queued behind it asks again", async () => {
        // Re-checks are coalesced to one in flight plus one trailing: without a
        // deadline, one hung ask (a stale connection as a laptop wakes) would
        // hold every later trigger behind it, the subscription with them.
        openedAs("wf-1", "edit")
        server.getWorkflowAccess.mockImplementationOnce(() => new Promise(() => {}))
        render(<Harness {...held()} />)
        await advance(ACCESS_RECHECK_INTERVAL_MS)
        expect(server.getWorkflowAccess).toHaveBeenCalledTimes(1)

        // The access drops, and a save misses, while that ask hangs.
        accessIsNow("view")
        saveMisses()
        await advance(ACCESS_ASK_TIMEOUT_MS - 1)
        expect(server.getWorkflowAccess).toHaveBeenCalledTimes(1)
        expect(removeChannelMock).not.toHaveBeenCalled()

        // The deadline passes: the hung ask fails, changing nothing, and the
        // queued one asks.
        await advance(1)
        expect(server.getWorkflowAccess).toHaveBeenCalledTimes(2)
        expect(removeChannelMock).toHaveBeenCalledTimes(1)
        expect(useWorkflowStore.getState().loadedAccess).toEqual({ workflowId: "wf-1", access: "view" })
      })

      it("a hidden tab does not re-check; showing it re-checks at once and restarts the timer", async () => {
        openedAs("wf-1", "edit")
        render(<Harness {...held()} />)
        await advance(0)

        setVisibility("hidden")
        await advance(ACCESS_RECHECK_INTERVAL_MS * 5)
        expect(server.getWorkflowAccess).not.toHaveBeenCalled()
        expect(vi.getTimerCount()).toBe(0)

        setVisibility("visible")
        await advance(0)
        expect(server.getWorkflowAccess).toHaveBeenCalledTimes(1)
        await advance(ACCESS_RECHECK_INTERVAL_MS)
        expect(server.getWorkflowAccess).toHaveBeenCalledTimes(2)
      })

      it("a canvas whose load finishes in a hidden tab does not re-check until it is shown", async () => {
        visibility = "hidden"
        notLoaded()
        act(() => {
          useWorkflowStore.setState({ workflowId: "wf-1" })
        })
        const { rerender } = render(<Harness {...defaultProps({ loadedUpdatedAt: null })} />)

        // The load answers while the tab is in the background.
        rerender(<Harness {...held()} />)
        loadedAs("wf-1", "edit")
        await advance(ACCESS_RECHECK_INTERVAL_MS * 3)
        expect(server.getWorkflowAccess).not.toHaveBeenCalled()
        expect(vi.getTimerCount()).toBe(0)

        setVisibility("visible")
        await advance(0)
        expect(server.getWorkflowAccess).toHaveBeenCalledTimes(1)
        await advance(ACCESS_RECHECK_INTERVAL_MS)
        expect(server.getWorkflowAccess).toHaveBeenCalledTimes(2)
      })

      it("a save that missed re-checks at once even in a hidden tab, whose subscription would otherwise outlive the change", async () => {
        openedAs("wf-1", "edit")
        render(<Harness {...held()} />)
        await advance(0)
        setVisibility("hidden")

        accessIsNow("view")
        saveMisses()
        await advance(0)

        expect(server.getWorkflowAccess).toHaveBeenCalledTimes(1)
        expect(removeChannelMock).toHaveBeenCalledTimes(1)
        // Hidden, the poll waits for the tab to be shown.
        expect(stampReads).toEqual([])
        expect(vi.getTimerCount()).toBe(0)
      })

      it("a save miss for another workflow asks nothing of this canvas", async () => {
        openedAs("wf-1", "edit")
        render(<Harness {...held()} />)
        await advance(0)

        act(() => {
          requestAccessRecheck("wf-2")
        })
        await advance(0)
        expect(server.getWorkflowAccess).not.toHaveBeenCalled()
      })

      it("asks nothing before the load has answered, and nothing on the answer itself", async () => {
        notLoaded()
        act(() => {
          useWorkflowStore.setState({ workflowId: "wf-1" })
        })
        const { rerender } = render(<Harness {...defaultProps({ loadedUpdatedAt: null })} />)
        await advance(ACCESS_RECHECK_INTERVAL_MS * 3)
        setVisibility("hidden")
        setVisibility("visible")
        await advance(0)
        expect(server.getWorkflowAccess).not.toHaveBeenCalled()

        // The load answers — and has just asked, so the next ask is a minute out.
        rerender(<Harness {...held()} />)
        loadedAs("wf-1", "edit")
        await advance(ACCESS_RECHECK_INTERVAL_MS - 1)
        expect(server.getWorkflowAccess).not.toHaveBeenCalled()
        await advance(1)
        expect(server.getWorkflowAccess).toHaveBeenCalledTimes(1)
      })

      it("a save miss that lands while a re-check is out gets an answer asked after it", async () => {
        openedAs("wf-1", "edit")
        const pending: Array<(answer: { data: WorkflowAccessInfo }) => void> = []
        server.getWorkflowAccess.mockImplementation(() => new Promise((resolve) => { pending.push(resolve) }))
        render(<Harness {...held()} />)
        await advance(ACCESS_RECHECK_INTERVAL_MS)
        expect(server.getWorkflowAccess).toHaveBeenCalledTimes(1)

        // The access drops and a save misses while the timed re-check, asked
        // before the change, is still out.
        saveMisses()
        await advance(0)
        expect(server.getWorkflowAccess).toHaveBeenCalledTimes(1)
        pending[0]!(accessInfo("edit"))
        await advance(0)
        expect(removeChannelMock).not.toHaveBeenCalled()

        expect(server.getWorkflowAccess).toHaveBeenCalledTimes(2)
        pending[1]!(accessInfo("view"))
        await advance(0)
        expect(removeChannelMock).toHaveBeenCalledTimes(1)
        expect(useWorkflowStore.getState().loadedAccess).toEqual({ workflowId: "wf-1", access: "view" })
      })

      it("a re-check that lands after the editor moved to another workflow is ignored", async () => {
        openedAs("wf-1", "edit")
        let release: (answer: { data: WorkflowAccessInfo }) => void = () => {}
        server.getWorkflowAccess.mockImplementation(() => new Promise((resolve) => { release = resolve }))
        const { rerender } = render(<Harness {...held()} />)
        await advance(ACCESS_RECHECK_INTERVAL_MS)
        expect(server.getWorkflowAccess).toHaveBeenCalledTimes(1)

        // wf-2 opens, and its load answers `edit`.
        openedAs("wf-2", "edit")
        rerender(<Harness {...held({ workflowId: "wf-2" })} />)
        expect(channelFactory).toHaveBeenLastCalledWith("workflow:wf-2")
        const removed = removeChannelMock.mock.calls.length

        // wf-1's answer lands, saying `view`.
        release(accessInfo("view"))
        await advance(0)

        const s = useWorkflowStore.getState()
        expect(s.loadedAccess).toEqual({ workflowId: "wf-2", access: "edit" })
        expect(s.isReadOnly).toBe(false)
        expect(removeChannelMock).toHaveBeenCalledTimes(removed)
      })

      it("unmounting leaves no re-check timer, visibility listener or save-miss listener behind", async () => {
        openedAs("wf-1", "edit")
        const { unmount } = render(<Harness {...held()} />)
        await advance(0)
        expect(vi.getTimerCount()).toBe(1)

        unmount()
        expect(vi.getTimerCount()).toBe(0)
        setVisibility("hidden")
        setVisibility("visible")
        saveMisses()
        await advance(ACCESS_RECHECK_INTERVAL_MS * 3)
        expect(server.getWorkflowAccess).not.toHaveBeenCalled()
        expect(vi.getTimerCount()).toBe(0)
      })

      it("unmounting with a re-check out and another queued drops the queued one", async () => {
        openedAs("wf-1", "edit")
        const pending: Array<(answer: { data: WorkflowAccessInfo }) => void> = []
        server.getWorkflowAccess.mockImplementation(() => new Promise((resolve) => { pending.push(resolve) }))
        const { unmount } = render(<Harness {...held()} />)
        await advance(ACCESS_RECHECK_INTERVAL_MS)
        expect(server.getWorkflowAccess).toHaveBeenCalledTimes(1)
        saveMisses()

        unmount()
        pending[0]!(accessInfo("edit"))
        await advance(0)
        // The canvas is gone; the trailing re-check queued behind the first
        // asks nothing for it.
        expect(server.getWorkflowAccess).toHaveBeenCalledTimes(1)
      })
    })
  })
})
