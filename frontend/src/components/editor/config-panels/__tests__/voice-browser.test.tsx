import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

// Radix Dialog/Select need these pointer + scroll shims in jsdom.
Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, writable: true, value: () => {} })
Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", { configurable: true, writable: true, value: () => {} })
Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", { configurable: true, writable: true, value: () => false })
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, writable: true, value: () => {} })

// ---------------------------------------------------------------------------
// Controllable IntersectionObserver — the infinite-scroll sentinel is driven by
// a real IntersectionObserver in VoiceList. jsdom has none, so we install a mock
// that records each observer's callback; `triggerSentinel()` fires the most
// recent one (the live sentinel) as if it scrolled into view.
// ---------------------------------------------------------------------------
const ioCallbacks: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = []
class MockIntersectionObserver {
  constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
    ioCallbacks.push(cb)
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}
vi.stubGlobal("IntersectionObserver", MockIntersectionObserver)

async function triggerSentinel() {
  const cb = ioCallbacks[ioCallbacks.length - 1]
  await act(async () => {
    cb?.([{ isIntersecting: true }])
    await Promise.resolve()
  })
}

// ---------------------------------------------------------------------------
// Fixtures: 90 library voices across 3 pages of 30.
// ---------------------------------------------------------------------------
const LIBRARY_TOTAL = 90
const ALL_LIBRARY = Array.from({ length: LIBRARY_TOTAL }, (_, i) => ({
  voice_id: `lib-${i}`,
  name: `Lib Voice ${i}`,
  preview_url: "",
  gender: "female",
  accent: "American",
  age: "young",
  description: "",
  use_case: "narration",
  category: "professional",
}))

const PREMADE = Array.from({ length: 5 }, (_, i) => ({
  voice_id: `pre-${i}`,
  name: `Premade ${i}`,
  preview_url: "",
  gender: "male",
  accent: "British",
  age: "young",
  description: "",
  use_case: "",
  category: "premade",
}))

const mockGetVoices = vi.fn(async () => PREMADE)
const mockSearchVoiceLibrary = vi.fn(
  async (params: { page?: number; page_size?: number; search?: string }) => {
    const page = params.page ?? 0
    const pageSize = params.page_size ?? 30
    const start = page * pageSize
    const voices = ALL_LIBRARY.slice(start, start + pageSize)
    return { voices, hasMore: start + pageSize < ALL_LIBRARY.length }
  },
)

vi.mock("@/lib/api", () => ({
  getVoices: (...a: unknown[]) => mockGetVoices(...(a as [])),
  searchVoiceLibrary: (...a: unknown[]) => mockSearchVoiceLibrary(...(a as [never])),
  // Referenced by transitively-imported hooks that never run in these tests
  // (MyVoicesTab is not mounted — showCustomVoices defaults off).
  getVoiceClones: vi.fn(),
  createVoiceClone: vi.fn(),
  deleteVoiceClone: vi.fn(),
}))

vi.mock("@/hooks/use-voice-clones", () => ({
  useVoiceClones: () => ({ data: [], isLoading: false }),
  useCreateVoiceClone: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteVoiceClone: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock("@/ee/hooks/use-model-credits", () => ({
  getCachedCredits: () => 5,
  prefetchModelCredits: vi.fn(),
}))

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { VoiceBrowser } from "../voice-browser"

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
function renderBrowser(onSelect = vi.fn()) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  render(<VoiceBrowser value="" onSelect={onSelect} triggerAriaLabel="Open voice picker" />, { wrapper })
  return { onSelect }
}

async function openLibraryTab() {
  fireEvent.click(screen.getByRole("button", { name: "Open voice picker" }))
  fireEvent.click(await screen.findByText("Voice Library"))
}

beforeEach(() => {
  vi.clearAllMocks()
  ioCallbacks.length = 0
})

describe("VoiceBrowser — Voice Library infinite scroll", () => {
  it("renders only the first page (initial window) — page 0 fetched, page 2 not yet", async () => {
    renderBrowser()
    await openLibraryTab()

    // First page (30 voices, ids 0..29) rendered.
    expect(await screen.findByText("Lib Voice 0")).toBeInTheDocument()
    expect(screen.getByText("Lib Voice 29")).toBeInTheDocument()
    // Second page (id 30+) NOT loaded yet — the window is one page.
    expect(screen.queryByText("Lib Voice 30")).not.toBeInTheDocument()

    // Exactly one server page requested, at page 0.
    expect(mockSearchVoiceLibrary).toHaveBeenCalledTimes(1)
    expect(mockSearchVoiceLibrary).toHaveBeenCalledWith(expect.objectContaining({ page: 0, page_size: 30 }))
  })

  it("extends the window when the sentinel scrolls into view (no Load more button)", async () => {
    renderBrowser()
    await openLibraryTab()
    await screen.findByText("Lib Voice 0")

    // There is no "Load more" button — the sentinel drives pagination.
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument()

    await triggerSentinel()

    // Page 1 fetched and appended (accumulates — page 0 rows still present).
    await waitFor(() => expect(screen.getByText("Lib Voice 30")).toBeInTheDocument())
    expect(screen.getByText("Lib Voice 0")).toBeInTheDocument()
    expect(screen.getByText("Lib Voice 59")).toBeInTheDocument()
    expect(mockSearchVoiceLibrary).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }))
  })

  it("search filters the FULL dataset server-side (debounced) and resets to page 0", async () => {
    renderBrowser()
    await openLibraryTab()
    await screen.findByText("Lib Voice 0")
    mockSearchVoiceLibrary.mockClear()

    fireEvent.change(screen.getByPlaceholderText("Search the voice library..."), {
      target: { value: "warm narrator" },
    })

    // After the 400ms debounce the query re-runs server-side with the search term
    // at page 0 (filtering hits the full library, not just the loaded window).
    await waitFor(
      () =>
        expect(mockSearchVoiceLibrary).toHaveBeenCalledWith(
          expect.objectContaining({ search: "warm narrator", page: 0 }),
        ),
      { timeout: 2000 },
    )
  })

  it("selection fires onSelect with the library voice id, name, and type", async () => {
    const onSelect = vi.fn()
    renderBrowser(onSelect)
    await openLibraryTab()

    fireEvent.click(await screen.findByText("Lib Voice 3"))

    expect(onSelect).toHaveBeenCalledWith(
      "lib-3",
      "Lib Voice 3",
      "library",
      expect.anything(),
    )
  })
})

describe("VoiceBrowser — Premade tab", () => {
  it("selection fires onSelect with the premade voice id and type", async () => {
    const onSelect = vi.fn()
    renderBrowser(onSelect)
    // Premade is the default tab; open the dialog.
    fireEvent.click(screen.getByRole("button", { name: "Open voice picker" }))

    fireEvent.click(await screen.findByText("Premade 2"))

    expect(onSelect).toHaveBeenCalledWith("pre-2", "Premade 2", "premade", undefined)
  })
})
