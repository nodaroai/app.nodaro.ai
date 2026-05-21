import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

// Stub localStorage for jsdom (which doesn't expose a usable one here).
const localStorageStore: Record<string, string> = {}
const localStorageMock = {
  getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageStore[key] = value
  }),
  removeItem: vi.fn((key: string) => {
    delete localStorageStore[key]
  }),
  clear: vi.fn(() => {
    Object.keys(localStorageStore).forEach((k) => delete localStorageStore[k])
  }),
  length: 0,
  key: vi.fn(() => null),
}
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
})

import { ChatPanel } from "../chat-panel"

vi.mock("@/lib/pipelines-api", () => ({
  pipelinesApi: {
    fetchChat: vi.fn(),
    postChat: vi.fn(),
    applyChat: vi.fn(),
  },
}))

import { pipelinesApi } from "@/lib/pipelines-api"

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  })
}

describe("ChatPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(localStorageStore).forEach((k) => delete localStorageStore[k])
    setViewport(1600)
    // jsdom doesn't ship scrollIntoView
    Element.prototype.scrollIntoView = vi.fn()
    ;(pipelinesApi.fetchChat as ReturnType<typeof vi.fn>).mockResolvedValue({
      turns: [],
    })
  })

  it("renders the expanded panel above the 1280px breakpoint", async () => {
    wrap(<ChatPanel pipelineId="p1" stage="script" />)
    await waitFor(() => expect(screen.getByTestId("chat-panel")).toBeInTheDocument())
  })

  it("auto-collapses below the 1280px breakpoint on mount", async () => {
    setViewport(1024)
    wrap(<ChatPanel pipelineId="p1" stage="script" />)
    await waitFor(() =>
      expect(screen.getByTestId("chat-panel-collapsed")).toBeInTheDocument(),
    )
  })

  it("toggles collapsed state on the collapse button", async () => {
    wrap(<ChatPanel pipelineId="p1" stage="script" />)
    await waitFor(() => expect(screen.getByTestId("chat-panel")).toBeInTheDocument())
    await userEvent.click(screen.getByTestId("chat-panel-collapse-btn"))
    expect(screen.getByTestId("chat-panel-collapsed")).toBeInTheDocument()
    await userEvent.click(screen.getByTestId("chat-panel-collapsed"))
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument()
  })

  it("persists width to localStorage and rehydrates on next mount", async () => {
    window.localStorage.setItem("nodaro-pipeline-chat-width", "420")
    wrap(<ChatPanel pipelineId="p1" stage="script" />)
    await waitFor(() => expect(screen.getByTestId("chat-panel")).toBeInTheDocument())
    expect(screen.getByTestId("chat-panel").style.width).toBe("420px")
  })

  it("clamps width to [280, 640] when localStorage is out of range", async () => {
    window.localStorage.setItem("nodaro-pipeline-chat-width", "9000")
    wrap(<ChatPanel pipelineId="p1" stage="script" />)
    await waitFor(() => expect(screen.getByTestId("chat-panel")).toBeInTheDocument())
    expect(screen.getByTestId("chat-panel").style.width).toBe("640px")
  })

  it("clamps width to MIN when localStorage value is too small", async () => {
    window.localStorage.setItem("nodaro-pipeline-chat-width", "50")
    wrap(<ChatPanel pipelineId="p1" stage="script" />)
    await waitFor(() => expect(screen.getByTestId("chat-panel")).toBeInTheDocument())
    expect(screen.getByTestId("chat-panel").style.width).toBe("280px")
  })

  it("collapsed tab shows turn count", async () => {
    ;(pipelinesApi.fetchChat as ReturnType<typeof vi.fn>).mockResolvedValue({
      turns: [
        {
          id: "1",
          turn_n: 1,
          role: "user",
          content: "hi",
          proposed_change: null,
          llm_call_id: null,
          applied_to_attempt_id: null,
          created_at: new Date().toISOString(),
        },
      ],
    })
    setViewport(1024)
    wrap(<ChatPanel pipelineId="p1" stage="script" />)
    await waitFor(() =>
      expect(screen.getByTestId("chat-panel-collapsed")).toHaveTextContent("1"),
    )
  })

  it("includes the resize handle on the left edge when expanded", async () => {
    wrap(<ChatPanel pipelineId="p1" stage="script" />)
    await waitFor(() =>
      expect(screen.getByTestId("chat-panel-resize-handle")).toBeInTheDocument(),
    )
  })
})
