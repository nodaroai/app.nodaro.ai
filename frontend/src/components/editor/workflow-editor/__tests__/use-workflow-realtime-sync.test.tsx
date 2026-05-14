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

// One record per subscribe(). The active subscription is always the last
// one — tests can introspect the array to confirm exactly one channel was
// opened (or that an old one was removed when workflowId changed).
const subscribeLog: SubscribeRecord[] = []
const removeChannelMock = vi.fn()

// Stable channel object returned by .channel(name) so tests can compare
// identity to the argument passed to removeChannel.
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
// and inspect the resulting onAppend* invocations.
// ---------------------------------------------------------------------------

interface HarnessParams {
  workflowId: string | null | undefined
  currentNodes: readonly Node[]
  currentEdges: readonly Edge[]
  onAppendNodes: (newNodes: Node[]) => void
  onAppendEdges: (newEdges: Edge[]) => void
}

function Harness(props: HarnessParams) {
  useWorkflowRealtimeSync({
    workflowId: props.workflowId,
    getCurrentNodes: () => props.currentNodes,
    getCurrentEdges: () => props.currentEdges,
    onAppendNodes: props.onAppendNodes,
    onAppendEdges: props.onAppendEdges,
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
    const onAppendNodes = vi.fn()
    const onAppendEdges = vi.fn()
    render(
      <Harness
        workflowId="abc-123"
        currentNodes={[]}
        currentEdges={[]}
        onAppendNodes={onAppendNodes}
        onAppendEdges={onAppendEdges}
      />,
    )

    expect(channelFactory).toHaveBeenCalledTimes(1)
    expect(channelFactory).toHaveBeenCalledWith("workflow:abc-123")

    const sub = lastSubscription()
    expect(sub.event).toBe("UPDATE")
    expect(sub.schema).toBe("public")
    expect(sub.table).toBe("workflows")
    expect(sub.filter).toBe("id=eq.abc-123")
  })

  it("does NOT subscribe when workflowId is null/undefined (hook is a no-op)", () => {
    const onAppendNodes = vi.fn()
    const onAppendEdges = vi.fn()
    const { rerender } = render(
      <Harness
        workflowId={null}
        currentNodes={[]}
        currentEdges={[]}
        onAppendNodes={onAppendNodes}
        onAppendEdges={onAppendEdges}
      />,
    )
    expect(channelFactory).not.toHaveBeenCalled()

    rerender(
      <Harness
        workflowId={undefined}
        currentNodes={[]}
        currentEdges={[]}
        onAppendNodes={onAppendNodes}
        onAppendEdges={onAppendEdges}
      />,
    )
    expect(channelFactory).not.toHaveBeenCalled()
  })

  it("unsubscribes on unmount", () => {
    const { unmount } = render(
      <Harness
        workflowId="wf-1"
        currentNodes={[]}
        currentEdges={[]}
        onAppendNodes={vi.fn()}
        onAppendEdges={vi.fn()}
      />,
    )
    expect(removeChannelMock).not.toHaveBeenCalled()
    unmount()
    expect(removeChannelMock).toHaveBeenCalledTimes(1)
  })

  it("tears down old subscription and opens a fresh one when workflowId changes", () => {
    const { rerender } = render(
      <Harness
        workflowId="wf-A"
        currentNodes={[]}
        currentEdges={[]}
        onAppendNodes={vi.fn()}
        onAppendEdges={vi.fn()}
      />,
    )
    expect(channelFactory).toHaveBeenCalledTimes(1)
    expect(channelFactory).toHaveBeenLastCalledWith("workflow:wf-A")
    expect(removeChannelMock).not.toHaveBeenCalled()

    rerender(
      <Harness
        workflowId="wf-B"
        currentNodes={[]}
        currentEdges={[]}
        onAppendNodes={vi.fn()}
        onAppendEdges={vi.fn()}
      />,
    )
    expect(removeChannelMock).toHaveBeenCalledTimes(1)
    expect(channelFactory).toHaveBeenCalledTimes(2)
    expect(channelFactory).toHaveBeenLastCalledWith("workflow:wf-B")
  })

  it("calls onAppendNodes with ONLY new nodes (filtered by id) on UPDATE", () => {
    const existing = makeNode("n1")
    const onAppendNodes = vi.fn()
    const onAppendEdges = vi.fn()
    render(
      <Harness
        workflowId="wf-1"
        currentNodes={[existing]}
        currentEdges={[]}
        onAppendNodes={onAppendNodes}
        onAppendEdges={onAppendEdges}
      />,
    )

    const incoming = [existing, makeNode("n2"), makeNode("n3")]
    lastSubscription().handler({ new: { id: "wf-1", nodes: incoming, edges: [] } })

    expect(onAppendNodes).toHaveBeenCalledTimes(1)
    const appended = onAppendNodes.mock.calls[0][0] as Node[]
    expect(appended.map((n) => n.id)).toEqual(["n2", "n3"])
    expect(onAppendEdges).not.toHaveBeenCalled()
  })

  it("calls onAppendEdges with ONLY new edges (filtered by id) on UPDATE", () => {
    const existing = makeEdge("e1", "n1", "n2")
    const onAppendNodes = vi.fn()
    const onAppendEdges = vi.fn()
    render(
      <Harness
        workflowId="wf-1"
        currentNodes={[]}
        currentEdges={[existing]}
        onAppendNodes={onAppendNodes}
        onAppendEdges={onAppendEdges}
      />,
    )

    const incoming = [existing, makeEdge("e2", "n2", "n3"), makeEdge("e3", "n3", "n4")]
    lastSubscription().handler({ new: { id: "wf-1", nodes: [], edges: incoming } })

    expect(onAppendEdges).toHaveBeenCalledTimes(1)
    const appended = onAppendEdges.mock.calls[0][0] as Edge[]
    expect(appended.map((e) => e.id)).toEqual(["e2", "e3"])
    expect(onAppendNodes).not.toHaveBeenCalled()
  })

  it("does NOT call onAppendNodes when all incoming nodes already exist locally", () => {
    const a = makeNode("n1")
    const b = makeNode("n2")
    const onAppendNodes = vi.fn()
    const onAppendEdges = vi.fn()
    render(
      <Harness
        workflowId="wf-1"
        currentNodes={[a, b]}
        currentEdges={[]}
        onAppendNodes={onAppendNodes}
        onAppendEdges={onAppendEdges}
      />,
    )

    lastSubscription().handler({
      new: { id: "wf-1", nodes: [a, b], edges: [] },
    })

    expect(onAppendNodes).not.toHaveBeenCalled()
    expect(onAppendEdges).not.toHaveBeenCalled()
  })

  it("does NOT call onAppendEdges when all incoming edges already exist locally", () => {
    const e1 = makeEdge("e1", "a", "b")
    const onAppendNodes = vi.fn()
    const onAppendEdges = vi.fn()
    render(
      <Harness
        workflowId="wf-1"
        currentNodes={[]}
        currentEdges={[e1]}
        onAppendNodes={onAppendNodes}
        onAppendEdges={onAppendEdges}
      />,
    )

    lastSubscription().handler({
      new: { id: "wf-1", nodes: [], edges: [e1] },
    })

    expect(onAppendEdges).not.toHaveBeenCalled()
    expect(onAppendNodes).not.toHaveBeenCalled()
  })

  it("handles UPDATE events that change both nodes and edges in a single payload", () => {
    const onAppendNodes = vi.fn()
    const onAppendEdges = vi.fn()
    render(
      <Harness
        workflowId="wf-1"
        currentNodes={[]}
        currentEdges={[]}
        onAppendNodes={onAppendNodes}
        onAppendEdges={onAppendEdges}
      />,
    )

    lastSubscription().handler({
      new: {
        id: "wf-1",
        nodes: [makeNode("n1"), makeNode("n2")],
        edges: [makeEdge("e1", "n1", "n2")],
      },
    })

    expect(onAppendNodes).toHaveBeenCalledTimes(1)
    expect((onAppendNodes.mock.calls[0][0] as Node[]).map((n) => n.id)).toEqual(["n1", "n2"])
    expect(onAppendEdges).toHaveBeenCalledTimes(1)
    expect((onAppendEdges.mock.calls[0][0] as Edge[]).map((e) => e.id)).toEqual(["e1"])
  })

  it("is idempotent: replaying the SAME payload twice does not double-append", () => {
    const onAppendNodes = vi.fn<(newNodes: Node[]) => void>()
    const onAppendEdges = vi.fn()

    // Simulate the caller wiring through actual append into a local
    // reference so the second event sees the appended nodes as already
    // existing.
    const localNodes: Node[] = []
    function handleAppend(newNodes: Node[]) {
      onAppendNodes(newNodes)
      localNodes.push(...newNodes)
    }

    const { rerender } = render(
      <Harness
        workflowId="wf-1"
        currentNodes={localNodes}
        currentEdges={[]}
        onAppendNodes={handleAppend}
        onAppendEdges={onAppendEdges}
      />,
    )

    const payload = { new: { id: "wf-1", nodes: [makeNode("n1")], edges: [] } }
    lastSubscription().handler(payload)
    expect(onAppendNodes).toHaveBeenCalledTimes(1)
    expect((onAppendNodes.mock.calls[0][0] as Node[]).map((n) => n.id)).toEqual(["n1"])

    // Re-render so the harness reads the now-populated localNodes; the
    // hook's getCurrentNodes callback will see "n1" as existing.
    rerender(
      <Harness
        workflowId="wf-1"
        currentNodes={localNodes}
        currentEdges={[]}
        onAppendNodes={handleAppend}
        onAppendEdges={onAppendEdges}
      />,
    )

    lastSubscription().handler(payload)
    // Still 1 — second event sees n1 as existing in current state.
    expect(onAppendNodes).toHaveBeenCalledTimes(1)
  })

  it("uses the LATEST getCurrent* callbacks on each event (no stale closure)", () => {
    const onAppendNodes = vi.fn()
    let currentNodes: readonly Node[] = []

    const { rerender } = render(
      <Harness
        workflowId="wf-1"
        currentNodes={currentNodes}
        currentEdges={[]}
        onAppendNodes={onAppendNodes}
        onAppendEdges={vi.fn()}
      />,
    )

    // Capture the handler from the only subscription — workflowId is
    // stable across re-renders so the same handler is reused.
    const handler = lastSubscription().handler

    // User adds n1 locally (drags from sidebar). Re-render with the new
    // state — the hook's refs now point at currentNodes = [n1].
    currentNodes = [makeNode("n1")]
    rerender(
      <Harness
        workflowId="wf-1"
        currentNodes={currentNodes}
        currentEdges={[]}
        onAppendNodes={onAppendNodes}
        onAppendEdges={vi.fn()}
      />,
    )

    // Realtime event arrives: payload says nodes are [n1, n2]. Without
    // ref-based callbacks we'd diff against the empty array captured at
    // subscribe time and incorrectly append n1 a second time. With the
    // ref pattern, only n2 is new.
    handler({ new: { id: "wf-1", nodes: [makeNode("n1"), makeNode("n2")], edges: [] } })

    expect(onAppendNodes).toHaveBeenCalledTimes(1)
    expect((onAppendNodes.mock.calls[0][0] as Node[]).map((n) => n.id)).toEqual(["n2"])
  })

  it("tolerates payloads where new is null or nodes/edges are missing/non-array", () => {
    const onAppendNodes = vi.fn()
    const onAppendEdges = vi.fn()
    render(
      <Harness
        workflowId="wf-1"
        currentNodes={[]}
        currentEdges={[]}
        onAppendNodes={onAppendNodes}
        onAppendEdges={onAppendEdges}
      />,
    )

    const handler = lastSubscription().handler

    // null new
    expect(() => handler({ new: null })).not.toThrow()
    // missing nodes / edges fields
    expect(() => handler({ new: { id: "wf-1" } as unknown as { id: string } })).not.toThrow()
    // non-array values (e.g. DB legacy column edge cases)
    expect(() =>
      handler({ new: { id: "wf-1", nodes: null, edges: "not-an-array" } }),
    ).not.toThrow()

    expect(onAppendNodes).not.toHaveBeenCalled()
    expect(onAppendEdges).not.toHaveBeenCalled()
  })
})
