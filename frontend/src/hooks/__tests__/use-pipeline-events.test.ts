import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

// ---------------------------------------------------------------------------
// Mocks (declared above the SUT import)
// ---------------------------------------------------------------------------

const mockStreamGet = vi.fn()

vi.mock("@/lib/sse-client", () => ({
  streamGet: (...args: unknown[]) => mockStreamGet(...args),
}))

vi.mock("@/lib/api", () => ({
  getAuthHeaders: vi.fn().mockResolvedValue({ Authorization: "Bearer test" }),
}))

vi.mock("@/lib/pipelines-api", () => ({
  pipelinesApi: {
    eventsUrl: (id: string) => `/v1/pipelines/${id}/events`,
  },
}))

vi.mock("@/hooks/use-workflow-store", () => {
  const updateNodeDataByEntityId = vi.fn()
  const setLastAddedPipelineNodeId = vi.fn()
  const setActivePipelineStatus = vi.fn()
  // The hook reads via `useWorkflowStore((s) => s.foo)` AND
  // `useWorkflowStore.getState()`. Both code paths need to be supported.
  const state = {
    updateNodeDataByEntityId,
    setLastAddedPipelineNodeId,
    setActivePipelineStatus,
    nodes: [] as unknown[],
  }
  const store = ((selector: (s: typeof state) => unknown) =>
    selector(state)) as unknown as {
    (selector: (s: typeof state) => unknown): unknown
    getState: () => typeof state
  }
  store.getState = () => state
  return { useWorkflowStore: store }
})

// ---------------------------------------------------------------------------
// SUT import (after mocks)
// ---------------------------------------------------------------------------

import { usePipelineEvents } from "../use-pipeline-events"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build an async-generator wrapper that emits a sequence of SSE frames
 * shaped like `{ type: "execution", data: <PipelineEvent> }`. The hook
 * unwraps frames inside the for-await loop.
 */
async function* fakeStreamOf(events: unknown[]): AsyncGenerator<unknown> {
  for (const evt of events) {
    yield { type: "execution", data: evt }
  }
  // Block forever so the consumer doesn't fall through to the `finally`
  // branch mid-test (matches the real server holding the connection open).
  await new Promise(() => undefined)
}

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children)
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("usePipelineEvents — chat events (Phase 1D.2b §5.11)", () => {
  let client: QueryClient

  beforeEach(() => {
    mockStreamGet.mockReset()
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  it("appends a chat:turn event to the chat-history cache", async () => {
    const turn = {
      id: "turn-1",
      turn_n: 1,
      role: "assistant" as const,
      content: "hello",
      proposed_change: null,
    }
    mockStreamGet.mockReturnValue(
      fakeStreamOf([
        {
          type: "chat:turn",
          pipelineId: "p1",
          stageName: "script",
          turn,
        },
      ]),
    )

    renderHook(() => usePipelineEvents("p1"), {
      wrapper: makeWrapper(client),
    })

    await waitFor(() => {
      const data = client.getQueryData<{ turns: Array<{ id: string }> }>([
        "pipelines",
        "p1",
        "stages",
        "script",
        "chat",
      ])
      expect(data?.turns).toHaveLength(1)
      expect(data?.turns[0]?.id).toBe("turn-1")
    })
  })

  it("is idempotent: a re-emitted chat:turn with the same id is a no-op", async () => {
    const turn = {
      id: "turn-dup",
      turn_n: 1,
      role: "assistant" as const,
      content: "hello",
      proposed_change: null,
    }
    mockStreamGet.mockReturnValue(
      fakeStreamOf([
        { type: "chat:turn", pipelineId: "p1", stageName: "script", turn },
        // Same id re-emitted (simulates SSE reconnect re-delivery).
        { type: "chat:turn", pipelineId: "p1", stageName: "script", turn },
      ]),
    )

    renderHook(() => usePipelineEvents("p1"), {
      wrapper: makeWrapper(client),
    })

    await waitFor(() => {
      const data = client.getQueryData<{ turns: Array<{ id: string }> }>([
        "pipelines",
        "p1",
        "stages",
        "script",
        "chat",
      ])
      expect(data?.turns).toHaveLength(1)
    })

    // Give the second frame a chance to land then re-assert length=1.
    await new Promise((r) => setTimeout(r, 20))
    const data = client.getQueryData<{ turns: Array<{ id: string }> }>([
      "pipelines",
      "p1",
      "stages",
      "script",
      "chat",
    ])
    expect(data?.turns).toHaveLength(1)
  })

  it("appends a second chat:turn with a different id", async () => {
    mockStreamGet.mockReturnValue(
      fakeStreamOf([
        {
          type: "chat:turn",
          pipelineId: "p1",
          stageName: "script",
          turn: {
            id: "t-1",
            turn_n: 1,
            role: "user",
            content: "make it darker",
            proposed_change: null,
          },
        },
        {
          type: "chat:turn",
          pipelineId: "p1",
          stageName: "script",
          turn: {
            id: "t-2",
            turn_n: 2,
            role: "assistant",
            content: "ok",
            proposed_change: null,
          },
        },
      ]),
    )

    renderHook(() => usePipelineEvents("p1"), {
      wrapper: makeWrapper(client),
    })

    await waitFor(() => {
      const data = client.getQueryData<{ turns: Array<{ id: string }> }>([
        "pipelines",
        "p1",
        "stages",
        "script",
        "chat",
      ])
      expect(data?.turns.map((t) => t.id)).toEqual(["t-1", "t-2"])
    })
  })

  it("chat:proposal_applied marks the source turn as applied", async () => {
    // Seed the cache so the setQueryData updater has something to map over.
    client.setQueryData(
      ["pipelines", "p1", "stages", "script", "chat"],
      {
        turns: [
          {
            id: "turn-1",
            turn_n: 1,
            role: "assistant",
            content: "proposed",
            proposed_change: { patch_kind: "json_patch", ops: [] },
            llm_call_id: null,
            applied_to_attempt_id: null,
            created_at: "2026-05-20T00:00:00Z",
          },
        ],
      },
    )

    mockStreamGet.mockReturnValue(
      fakeStreamOf([
        {
          type: "chat:proposal_applied",
          pipelineId: "p1",
          stageName: "script",
          turnId: "turn-1",
          attemptId: "attempt-99",
        },
      ]),
    )

    renderHook(() => usePipelineEvents("p1"), {
      wrapper: makeWrapper(client),
    })

    await waitFor(() => {
      const data = client.getQueryData<{
        turns: Array<{ id: string; applied_to_attempt_id: string | null }>
      }>(["pipelines", "p1", "stages", "script", "chat"])
      expect(data?.turns[0]?.applied_to_attempt_id).toBe("attempt-99")
    })
  })

  it("chat:proposal_applied invalidates the pipeline query", async () => {
    // Seed the chat cache + an unrelated `["pipelines", "p1"]` query so
    // we can observe an invalidation side effect.
    client.setQueryData(["pipelines", "p1", "stages", "script", "chat"], {
      turns: [
        {
          id: "turn-1",
          turn_n: 1,
          role: "assistant",
          content: "x",
          proposed_change: null,
          llm_call_id: null,
          applied_to_attempt_id: null,
          created_at: "2026-05-20T00:00:00Z",
        },
      ],
    })
    const invalidateSpy = vi.spyOn(client, "invalidateQueries")

    mockStreamGet.mockReturnValue(
      fakeStreamOf([
        {
          type: "chat:proposal_applied",
          pipelineId: "p1",
          stageName: "script",
          turnId: "turn-1",
          attemptId: "attempt-1",
        },
      ]),
    )

    renderHook(() => usePipelineEvents("p1"), {
      wrapper: makeWrapper(client),
    })

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["pipelines", "p1"],
      })
    })
  })

  it("chat:proposal_applied is a no-op when the chat cache is empty", async () => {
    // No seed → `prev` is undefined → updater returns prev unchanged.
    mockStreamGet.mockReturnValue(
      fakeStreamOf([
        {
          type: "chat:proposal_applied",
          pipelineId: "p1",
          stageName: "script",
          turnId: "nonexistent",
          attemptId: "attempt-1",
        },
      ]),
    )

    renderHook(() => usePipelineEvents("p1"), {
      wrapper: makeWrapper(client),
    })

    // Wait for the event to be processed (invalidate still fires).
    await new Promise((r) => setTimeout(r, 30))
    const data = client.getQueryData([
      "pipelines",
      "p1",
      "stages",
      "script",
      "chat",
    ])
    // Cache stayed undefined — no fake row was created.
    expect(data).toBeUndefined()
  })
})
