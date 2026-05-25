import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

// ─── Mocks (declared above the SUT import) ─────────────────────────────────

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
  const state = {
    updateNodeDataByEntityId,
    setLastAddedPipelineNodeId,
    setActivePipelineStatus,
    nodes: [] as unknown[],
  }
  const store = ((selector: (s: typeof state) => unknown) => selector(state)) as unknown as {
    (selector: (s: typeof state) => unknown): unknown
    getState: () => typeof state
  }
  store.getState = () => state
  return { useWorkflowStore: store }
})

import { usePipelineEvents } from "../use-pipeline-events"

// ─── Helpers ────────────────────────────────────────────────────────────────

async function* fakeStreamOf(events: unknown[]): AsyncGenerator<unknown> {
  for (const evt of events) {
    yield { type: "execution", data: evt }
  }
  await new Promise(() => undefined)
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children)
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("usePipelineEvents — stage:progress", () => {
  let client: QueryClient
  beforeEach(() => {
    mockStreamGet.mockReset()
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  it("captures stageProgress from a stage:progress event", async () => {
    mockStreamGet.mockReturnValue(
      fakeStreamOf([
        {
          type: "stage:progress",
          pipelineId: "p1",
          stageName: "script",
          message: "Drafting plan (1.2 KB so far)…",
          bytesSoFar: 1200,
        },
      ]),
    )

    const { result } = renderHook(() => usePipelineEvents("p1"), {
      wrapper: wrapper(client),
    })

    await waitFor(() => expect(result.current.stageProgress).not.toBeNull())
    expect(result.current.stageProgress).toEqual({
      stageName: "script",
      message: "Drafting plan (1.2 KB so far)…",
      bytesSoFar: 1200,
    })
  })

  it("clears stageProgress when stage:status fires for the same stage", async () => {
    mockStreamGet.mockReturnValue(
      fakeStreamOf([
        {
          type: "stage:progress",
          pipelineId: "p1",
          stageName: "script",
          message: "Drafting plan…",
        },
        {
          type: "stage:status",
          pipelineId: "p1",
          stageName: "script",
          status: "awaiting_approval",
        },
      ]),
    )

    const { result } = renderHook(() => usePipelineEvents("p1"), {
      wrapper: wrapper(client),
    })

    await waitFor(() => expect(result.current.stageProgress).toBeNull())
  })

  it("keeps stageProgress when stage:status fires for a DIFFERENT stage", async () => {
    // The orchestrator fires stage:status for the script stage approving, then
    // the next stage is set up — but the script-stage progress should clear,
    // not the unrelated other stage. This test mirrors the inverse: a script
    // progress event then a characters stage status. Should NOT clear.
    mockStreamGet.mockReturnValue(
      fakeStreamOf([
        {
          type: "stage:progress",
          pipelineId: "p1",
          stageName: "script",
          message: "Drafting plan…",
        },
        {
          type: "stage:status",
          pipelineId: "p1",
          stageName: "characters",
          status: "running",
        },
      ]),
    )

    const { result } = renderHook(() => usePipelineEvents("p1"), {
      wrapper: wrapper(client),
    })

    // After both events processed, the script progress should still be set.
    await waitFor(() =>
      expect(result.current.lastEvent?.type).toBe("stage:status"),
    )
    expect(result.current.stageProgress?.stageName).toBe("script")
  })

  it("subsequent stage:progress events overwrite the previous message", async () => {
    mockStreamGet.mockReturnValue(
      fakeStreamOf([
        {
          type: "stage:progress",
          pipelineId: "p1",
          stageName: "script",
          message: "Drafting plan (1 KB so far)…",
          bytesSoFar: 1024,
        },
        {
          type: "stage:progress",
          pipelineId: "p1",
          stageName: "script",
          message: "Drafting plan (3 KB so far)…",
          bytesSoFar: 3072,
        },
      ]),
    )

    const { result } = renderHook(() => usePipelineEvents("p1"), {
      wrapper: wrapper(client),
    })

    await waitFor(() => expect(result.current.stageProgress?.bytesSoFar).toBe(3072))
    expect(result.current.stageProgress?.message).toBe(
      "Drafting plan (3 KB so far)…",
    )
  })
})
