import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { CHAT_TURN_CAPS } from "@nodaro/shared"
import type { ChatTurn } from "@nodaro/client"
import { usePipelineChat } from "../use-pipeline-chat"

vi.mock("@/lib/pipelines-api", () => ({
  pipelinesApi: {
    fetchChat: vi.fn(),
    postChat: vi.fn(),
    applyChat: vi.fn(),
  },
}))

import { pipelinesApi } from "@/lib/pipelines-api"

function wrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function makeTurn(over: Partial<ChatTurn>): ChatTurn {
  return {
    id: "t1",
    turn_n: 1,
    role: "user",
    content: "hello",
    proposed_change: null,
    llm_call_id: null,
    applied_to_attempt_id: null,
    created_at: new Date().toISOString(),
    ...over,
  }
}

describe("usePipelineChat", () => {
  beforeEach(() => vi.clearAllMocks())

  it("loads turns + computes remaining = CHAT_TURN_CAPS[stage] − user count", async () => {
    ;(pipelinesApi.fetchChat as ReturnType<typeof vi.fn>).mockResolvedValue({
      turns: [
        makeTurn({ id: "1", turn_n: 1, role: "user" }),
        makeTurn({ id: "2", turn_n: 2, role: "assistant" }),
        makeTurn({ id: "3", turn_n: 3, role: "user" }),
      ],
    })
    const { result } = renderHook(() => usePipelineChat("p1", "script"), {
      wrapper: wrapper(newClient()),
    })
    await waitFor(() => expect(result.current.turns).toHaveLength(3))
    expect(result.current.remaining).toBe(CHAT_TURN_CAPS.script - 2)
    expect(result.current.isAtCap).toBe(false)
  })

  it("isAtCap true when remaining <= 0", async () => {
    const userTurns = Array.from({ length: CHAT_TURN_CAPS.script }, (_, i) =>
      makeTurn({ id: `u-${i}`, turn_n: i * 2, role: "user" }),
    )
    ;(pipelinesApi.fetchChat as ReturnType<typeof vi.fn>).mockResolvedValue({
      turns: userTurns,
    })
    const { result } = renderHook(() => usePipelineChat("p1", "script"), {
      wrapper: wrapper(newClient()),
    })
    await waitFor(() =>
      expect(result.current.turns).toHaveLength(CHAT_TURN_CAPS.script),
    )
    expect(result.current.remaining).toBe(0)
    expect(result.current.isAtCap).toBe(true)
  })

  it("sendMessage calls pipelinesApi.postChat", async () => {
    ;(pipelinesApi.fetchChat as ReturnType<typeof vi.fn>).mockResolvedValue({
      turns: [],
    })
    ;(pipelinesApi.postChat as ReturnType<typeof vi.fn>).mockResolvedValue({
      turnId: "t-new",
      role: "assistant",
      content: "ack",
      proposed_change: null,
    })
    const { result } = renderHook(() => usePipelineChat("p1", "script"), {
      wrapper: wrapper(newClient()),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    act(() => result.current.sendMessage("hi"))
    await waitFor(() =>
      expect(pipelinesApi.postChat).toHaveBeenCalledWith("p1", "script", "hi"),
    )
  })

  it("applyProposal invalidates pipeline + stage + chat caches", async () => {
    ;(pipelinesApi.fetchChat as ReturnType<typeof vi.fn>).mockResolvedValue({
      turns: [],
    })
    ;(pipelinesApi.applyChat as ReturnType<typeof vi.fn>).mockResolvedValue({
      applied: true,
      attemptId: "a1",
      newOutput: { plan: {} },
    })
    const client = newClient()
    const spy = vi.spyOn(client, "invalidateQueries")
    const { result } = renderHook(() => usePipelineChat("p1", "script"), {
      wrapper: wrapper(client),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    act(() => result.current.applyProposal("turn-7"))
    await waitFor(() => expect(pipelinesApi.applyChat).toHaveBeenCalled())
    await waitFor(() => expect(result.current.isApplying).toBe(false))
    const calls = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))
    expect(calls).toContain(JSON.stringify(["pipeline", "p1"]))
    expect(calls).toContain(JSON.stringify(["pipeline-stage", "p1", "script"]))
    expect(calls).toContain(
      JSON.stringify(["pipelines", "p1", "stages", "script", "chat"]),
    )
  })

  it("exposes isSending while postChat is pending", async () => {
    ;(pipelinesApi.fetchChat as ReturnType<typeof vi.fn>).mockResolvedValue({
      turns: [],
    })
    let resolveIt: (() => void) | undefined
    ;(pipelinesApi.postChat as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveIt = resolve
        }),
    )
    const { result } = renderHook(() => usePipelineChat("p1", "script"), {
      wrapper: wrapper(newClient()),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    act(() => result.current.sendMessage("hi"))
    await waitFor(() => expect(result.current.isSending).toBe(true))
    resolveIt?.()
  })
})
