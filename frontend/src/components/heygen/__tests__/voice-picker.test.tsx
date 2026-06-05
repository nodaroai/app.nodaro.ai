import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { HeygenVoice } from "@/lib/api"
import {
  deriveLanguages,
  deriveVoiceGenders,
  filterVoices,
} from "../voice-picker"

// ---------------------------------------------------------------------------
// Mock @/lib/api
// ---------------------------------------------------------------------------
const mockGetHeygenVoices = vi.fn()
vi.mock("@/lib/api", () => ({
  getHeygenAvatars: vi.fn(),
  getHeygenVoices: (...args: unknown[]) => mockGetHeygenVoices(...args),
}))

// ---------------------------------------------------------------------------
// Stub @tanstack/react-virtual so jsdom renders all items without real layout.
// The stub produces virtual items for every row so VoiceRow components mount.
// ---------------------------------------------------------------------------
vi.mock("@tanstack/react-virtual", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-virtual")>()
  return {
    ...actual,
    useVirtualizer: ({ count }: { count: number }) => ({
      getTotalSize: () => count * 52,
      getVirtualItems: () =>
        Array.from({ length: count }, (_, i) => ({
          key: i,
          index: i,
          start: i * 52,
          size: 52,
        })),
    }),
  }
})

// ---------------------------------------------------------------------------
// Stub active-player so we can spy on setActivePlayer without real Audio.
// ---------------------------------------------------------------------------
const mockSetActivePlayer = vi.fn()
const mockReleaseActivePlayer = vi.fn()
vi.mock("@/components/audio-player/active-player", () => ({
  setActivePlayer: (...args: unknown[]) => mockSetActivePlayer(...args),
  releaseActivePlayer: (...args: unknown[]) => mockReleaseActivePlayer(...args),
}))

// ---------------------------------------------------------------------------
// Stub HTMLAudioElement.play() — jsdom doesn't implement it.
// ---------------------------------------------------------------------------
const mockPlay = vi.fn().mockResolvedValue(undefined)
window.HTMLMediaElement.prototype.play = mockPlay
window.HTMLMediaElement.prototype.pause = vi.fn()

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const VOICE_EN_MALE: HeygenVoice = {
  voiceId: "v-1",
  name: "Adam",
  language: "English",
  gender: "male",
  previewAudio: "https://example.com/adam.mp3",
  supportPause: true,
  emotionSupport: false,
  supportLocale: true,
}

const VOICE_EN_FEMALE: HeygenVoice = {
  voiceId: "v-2",
  name: "Alice",
  language: "English",
  gender: "female",
  previewAudio: "https://example.com/alice.mp3",
  supportPause: false,
  emotionSupport: true,
  supportLocale: false,
}

const VOICE_ES_FEMALE: HeygenVoice = {
  voiceId: "v-3",
  name: "Sofia",
  language: "Spanish",
  gender: "female",
  previewAudio: "https://example.com/sofia.mp3",
  supportPause: false,
  emotionSupport: false,
  supportLocale: false,
}

const VOICES: HeygenVoice[] = [VOICE_EN_MALE, VOICE_EN_FEMALE, VOICE_ES_FEMALE]

// ---------------------------------------------------------------------------
// Helper: render with a fresh QueryClient
// ---------------------------------------------------------------------------
function renderWithQuery(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

// SUT imported AFTER mocks.
import { VoicePicker } from "../voice-picker"

beforeEach(() => {
  vi.clearAllMocks()
})

// ===========================================================================
// Unit tests for pure helpers
// ===========================================================================
describe("deriveLanguages()", () => {
  it("returns sorted unique language strings", () => {
    const result = deriveLanguages(VOICES)
    expect(result).toEqual(["English", "Spanish"])
  })

  it("returns [] for an empty catalog", () => {
    expect(deriveLanguages([])).toEqual([])
  })
})

describe("deriveVoiceGenders()", () => {
  it("returns sorted, lowercased genders", () => {
    const result = deriveVoiceGenders(VOICES)
    expect(result).toEqual(["female", "male"])
  })
})

describe("filterVoices()", () => {
  it("returns all when filters are at defaults", () => {
    expect(filterVoices(VOICES, "", "all", "all")).toHaveLength(3)
  })

  it("filters by name query (case-insensitive)", () => {
    const result = filterVoices(VOICES, "adam", "all", "all")
    expect(result).toHaveLength(1)
    expect(result[0].voiceId).toBe("v-1")
  })

  it("filters by language", () => {
    const result = filterVoices(VOICES, "", "Spanish", "all")
    expect(result).toHaveLength(1)
    expect(result[0].voiceId).toBe("v-3")
  })

  it("filters by gender", () => {
    const result = filterVoices(VOICES, "", "all", "female")
    expect(result).toHaveLength(2)
    expect(result.map((v) => v.voiceId)).toContain("v-2")
    expect(result.map((v) => v.voiceId)).toContain("v-3")
  })

  it("combines query + language + gender", () => {
    const result = filterVoices(VOICES, "alice", "English", "female")
    expect(result).toHaveLength(1)
    expect(result[0].voiceId).toBe("v-2")
  })

  it("returns [] when no voices match", () => {
    expect(filterVoices(VOICES, "xyzqq", "all", "all")).toHaveLength(0)
  })

  it("never mutates the input array", () => {
    const input = [...VOICES]
    filterVoices(input, "x", "English", "male")
    expect(input).toHaveLength(3)
  })
})

// ===========================================================================
// Component integration tests
// ===========================================================================
describe("VoicePicker component", () => {
  it("renders voice rows after data loads", async () => {
    mockGetHeygenVoices.mockResolvedValue(VOICES)
    renderWithQuery(<VoicePicker value={undefined} onSelect={() => {}} />)

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: /Adam/i })).toBeInTheDocument()
    })
    expect(screen.getByRole("radio", { name: /Alice/i })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: /Sofia/i })).toBeInTheDocument()
  })

  it("shows loading skeleton while fetching", () => {
    mockGetHeygenVoices.mockReturnValue(new Promise(() => {}))
    const { container } = renderWithQuery(
      <VoicePicker value={undefined} onSelect={() => {}} />,
    )
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0)
  })

  it("shows the configure message when voice list is empty", async () => {
    mockGetHeygenVoices.mockResolvedValue([])
    renderWithQuery(<VoicePicker value={undefined} onSelect={() => {}} />)

    await waitFor(() => {
      expect(screen.getByTestId("voice-picker-empty")).toBeInTheDocument()
    })
    expect(screen.getByText(/Configure the HeyGen API key/i)).toBeInTheDocument()
  })

  it("clicking a row calls onSelect with the full voice object", async () => {
    mockGetHeygenVoices.mockResolvedValue(VOICES)
    const onSelect = vi.fn()
    renderWithQuery(<VoicePicker value={undefined} onSelect={onSelect} />)

    await waitFor(() => screen.getByRole("radio", { name: /Adam/i }))
    fireEvent.click(screen.getByRole("radio", { name: /Adam/i }))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(VOICE_EN_MALE)
  })

  it("selected row has aria-checked=true", async () => {
    mockGetHeygenVoices.mockResolvedValue(VOICES)
    renderWithQuery(<VoicePicker value="v-2" onSelect={() => {}} />)

    await waitFor(() => screen.getByRole("radio", { name: /Alice/i }))
    const selectedRow = screen.getByRole("radio", { name: /Alice/i })
    expect(selectedRow).toHaveAttribute("aria-checked", "true")

    const otherRow = screen.getByRole("radio", { name: /Adam/i })
    expect(otherRow).toHaveAttribute("aria-checked", "false")
  })

  it("language filter control renders with correct aria-label", async () => {
    // Radix Select portals don't work well in jsdom (scrollIntoView missing).
    // The filter logic itself is thoroughly tested in the filterVoices() unit
    // tests above. Here we just verify the control is present and accessible.
    mockGetHeygenVoices.mockResolvedValue(VOICES)
    renderWithQuery(<VoicePicker value={undefined} onSelect={() => {}} />)

    await waitFor(() => screen.getByLabelText("Filter by language"))
    expect(screen.getByLabelText("Filter by language")).toBeInTheDocument()
    // The language trigger is a button (Radix SelectTrigger).
    expect(screen.getByLabelText("Filter by language").tagName.toLowerCase()).toBe(
      "button",
    )
  })

  it("search narrows voices by name", async () => {
    mockGetHeygenVoices.mockResolvedValue(VOICES)
    renderWithQuery(<VoicePicker value={undefined} onSelect={() => {}} />)

    await waitFor(() => screen.getByLabelText("Search voices"))
    fireEvent.change(screen.getByLabelText("Search voices"), {
      target: { value: "sofia" },
    })

    await waitFor(() => {
      expect(screen.queryByRole("radio", { name: /Adam/i })).not.toBeInTheDocument()
    })
    expect(screen.getByRole("radio", { name: /Sofia/i })).toBeInTheDocument()
  })

  it("clicking play triggers setActivePlayer from active-player singleton", async () => {
    mockGetHeygenVoices.mockResolvedValue(VOICES)
    renderWithQuery(<VoicePicker value={undefined} onSelect={() => {}} />)

    await waitFor(() => screen.getByRole("button", { name: /Play Adam/i }))
    fireEvent.click(screen.getByRole("button", { name: /Play Adam/i }))

    expect(mockSetActivePlayer).toHaveBeenCalledTimes(1)
  })

  it("shows error state when query rejects", async () => {
    mockGetHeygenVoices.mockRejectedValue(new Error("network error"))
    renderWithQuery(<VoicePicker value={undefined} onSelect={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText(/Failed to load voices/i)).toBeInTheDocument()
    })
  })

  it("shows 'No voices match' when filters have no results", async () => {
    mockGetHeygenVoices.mockResolvedValue(VOICES)
    renderWithQuery(<VoicePicker value={undefined} onSelect={() => {}} />)

    await waitFor(() => screen.getByLabelText("Search voices"))
    fireEvent.change(screen.getByLabelText("Search voices"), {
      target: { value: "xyzqq_nomatch" },
    })

    await waitFor(() => {
      expect(screen.getByText(/No voices match/i)).toBeInTheDocument()
    })
  })

  it("emotionSupport and supportPause badges render correctly", async () => {
    mockGetHeygenVoices.mockResolvedValue(VOICES)
    renderWithQuery(<VoicePicker value={undefined} onSelect={() => {}} />)

    await waitFor(() => screen.getByRole("radio", { name: /Adam/i }))

    // Adam has supportPause=true, emotionSupport=false — "pause" badge present, "emotion" absent
    const adamRow = screen.getByRole("radio", { name: /Adam/i })
    expect(adamRow.querySelector("[class*='pause']") ?? adamRow.textContent).toContain("pause")

    // Alice has emotionSupport=true — "emotion" badge present
    const aliceRow = screen.getByRole("radio", { name: /Alice/i })
    expect(aliceRow.textContent).toContain("emotion")
  })
})
