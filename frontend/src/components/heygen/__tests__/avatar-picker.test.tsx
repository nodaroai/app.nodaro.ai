import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { HeygenAvatar } from "@/lib/api"
import {
  deriveGenders,
  filterAvatars,
  hasGroupSegmentation,
} from "../avatar-picker"

// ---------------------------------------------------------------------------
// Mock @/lib/api — hoisted before the SUT import
// ---------------------------------------------------------------------------
const mockGetHeygenAvatars = vi.fn()
vi.mock("@/lib/api", () => ({
  getHeygenAvatars: (...args: unknown[]) => mockGetHeygenAvatars(...args),
  // VoicePicker is not used here but the module must export consistently.
  getHeygenVoices: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Stub use-lazy-mount so tiles render images immediately in tests (jsdom has
// no IntersectionObserver layout, so the lazy hook never fires).
// ---------------------------------------------------------------------------
vi.mock("@/components/audio-player/use-lazy-mount", () => ({
  useLazyMount: () => ({
    ref: { current: null },
    mounted: true,
    mountNow: vi.fn(),
  }),
}))

// ---------------------------------------------------------------------------
// Stub the virtualizer so we get real DOM rows without needing layout.
// The stub renders ALL items in a single flat div (no virtualization),
// which is correct for tests where the item count is small.
// ---------------------------------------------------------------------------
vi.mock("@/hooks/use-virtual-grid", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-virtual-grid")>()
  return {
    ...actual,
    useVirtualGrid: ({ itemCount }: { itemCount: number }) => ({
      gridRef: () => {},
      virtualRows: Array.from({ length: Math.ceil(itemCount / 3) }, (_, i) => ({
        key: i,
        index: i,
        start: i * 180,
        size: 180,
      })),
      totalSize: Math.ceil(itemCount / 3) * 180,
      columns: 3,
      scrollMargin: 0,
      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    }),
  }
})

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const MALE_AVATAR: HeygenAvatar = {
  avatarId: "av-1",
  name: "Alex Studio",
  gender: "male",
  previewImageUrl: "https://example.com/alex.jpg",
  defaultVoiceId: "v-1",
  preferredOrientation: "portrait",
}

const FEMALE_AVATAR: HeygenAvatar = {
  avatarId: "av-2",
  name: "Diana Pro",
  gender: "female",
  previewImageUrl: "https://example.com/diana.jpg",
}

const CUSTOM_AVATAR: HeygenAvatar = {
  avatarId: "av-3",
  name: "My Custom",
  gender: "male",
  previewImageUrl: "https://example.com/custom.jpg",
  groupId: "custom-group-1",
}

const AVATARS: HeygenAvatar[] = [MALE_AVATAR, FEMALE_AVATAR, CUSTOM_AVATAR]

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
import { AvatarPicker } from "../avatar-picker"

beforeEach(() => {
  vi.clearAllMocks()
})

// ===========================================================================
// Unit tests for pure helpers — no React needed
// ===========================================================================
describe("deriveGenders()", () => {
  it("returns sorted, deduplicated, lowercased genders", () => {
    const result = deriveGenders(AVATARS)
    expect(result).toEqual(["female", "male"])
  })

  it("returns [] for an empty catalog", () => {
    expect(deriveGenders([])).toEqual([])
  })
})

describe("hasGroupSegmentation()", () => {
  it("returns true when at least one avatar has a groupId", () => {
    expect(hasGroupSegmentation(AVATARS)).toBe(true)
  })

  it("returns false when no avatar has a groupId", () => {
    expect(hasGroupSegmentation([MALE_AVATAR, FEMALE_AVATAR])).toBe(false)
  })
})

describe("filterAvatars()", () => {
  it("returns all when filters are at defaults", () => {
    expect(filterAvatars(AVATARS, "", "all", "all")).toHaveLength(3)
  })

  it("filters by query (case-insensitive name match)", () => {
    const result = filterAvatars(AVATARS, "diana", "all", "all")
    expect(result).toHaveLength(1)
    expect(result[0].avatarId).toBe("av-2")
  })

  it("filters by gender", () => {
    const result = filterAvatars(AVATARS, "", "female", "all")
    expect(result).toHaveLength(1)
    expect(result[0].avatarId).toBe("av-2")
  })

  it("filters segment=stock excludes avatars with groupId", () => {
    const result = filterAvatars(AVATARS, "", "all", "stock")
    expect(result.map((a) => a.avatarId)).not.toContain("av-3")
    expect(result).toHaveLength(2)
  })

  it("filters segment=custom includes only avatars with groupId", () => {
    const result = filterAvatars(AVATARS, "", "all", "custom")
    expect(result).toHaveLength(1)
    expect(result[0].avatarId).toBe("av-3")
  })

  it("combines query + gender filters", () => {
    // "studio" matches "Alex Studio" (male) — female gender filter excludes it.
    const result = filterAvatars(AVATARS, "studio", "female", "all")
    expect(result).toHaveLength(0)
  })

  it("never mutates the input array", () => {
    const input = [...AVATARS]
    filterAvatars(input, "x", "male", "stock")
    expect(input).toHaveLength(3) // unchanged
  })
})

// ===========================================================================
// Component integration tests
// ===========================================================================
describe("AvatarPicker component", () => {
  it("renders avatar tiles after data loads", async () => {
    mockGetHeygenAvatars.mockResolvedValue(AVATARS)
    renderWithQuery(<AvatarPicker value={undefined} onSelect={() => {}} />)

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: /Alex Studio/i })).toBeInTheDocument()
    })
    expect(screen.getByRole("radio", { name: /Diana Pro/i })).toBeInTheDocument()
  })

  it("shows the loading skeleton while fetching", () => {
    // Never resolves — stays in loading state.
    mockGetHeygenAvatars.mockReturnValue(new Promise(() => {}))
    const { container } = renderWithQuery(
      <AvatarPicker value={undefined} onSelect={() => {}} />,
    )
    // Skeleton: animate-pulse divs present, no tiles yet.
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0)
  })

  it("shows the configure message when avatars list is empty", async () => {
    mockGetHeygenAvatars.mockResolvedValue([])
    renderWithQuery(<AvatarPicker value={undefined} onSelect={() => {}} />)

    await waitFor(() => {
      expect(screen.getByTestId("avatar-picker-empty")).toBeInTheDocument()
    })
    expect(screen.getByText(/Configure the HeyGen API key/i)).toBeInTheDocument()
  })

  it("clicking a tile calls onSelect with the full avatar object", async () => {
    mockGetHeygenAvatars.mockResolvedValue(AVATARS)
    const onSelect = vi.fn()
    renderWithQuery(<AvatarPicker value={undefined} onSelect={onSelect} />)

    await waitFor(() => screen.getByRole("radio", { name: /Alex Studio/i }))
    fireEvent.click(screen.getByRole("radio", { name: /Alex Studio/i }))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(MALE_AVATAR)
  })

  it("selected tile has aria-checked=true", async () => {
    mockGetHeygenAvatars.mockResolvedValue(AVATARS)
    renderWithQuery(<AvatarPicker value="av-2" onSelect={() => {}} />)

    await waitFor(() => screen.getByRole("radio", { name: /Diana Pro/i }))
    const tile = screen.getByRole("radio", { name: /Diana Pro/i })
    expect(tile).toHaveAttribute("aria-checked", "true")

    const otherTile = screen.getByRole("radio", { name: /Alex Studio/i })
    expect(otherTile).toHaveAttribute("aria-checked", "false")
  })

  it("typing in search narrows tiles", async () => {
    mockGetHeygenAvatars.mockResolvedValue(AVATARS)
    renderWithQuery(<AvatarPicker value={undefined} onSelect={() => {}} />)

    await waitFor(() => screen.getByRole("radio", { name: /Alex Studio/i }))

    fireEvent.change(screen.getByLabelText("Search avatars"), {
      target: { value: "diana" },
    })

    await waitFor(() => {
      expect(screen.queryByRole("radio", { name: /Alex Studio/i })).not.toBeInTheDocument()
    })
    expect(screen.getByRole("radio", { name: /Diana Pro/i })).toBeInTheDocument()
  })

  it("shows 'No avatars match' when search has no results", async () => {
    mockGetHeygenAvatars.mockResolvedValue(AVATARS)
    renderWithQuery(<AvatarPicker value={undefined} onSelect={() => {}} />)

    await waitFor(() => screen.getByLabelText("Search avatars"))
    fireEvent.change(screen.getByLabelText("Search avatars"), {
      target: { value: "xyzqq_nomatch" },
    })

    await waitFor(() => {
      expect(screen.getByText(/No avatars match/i)).toBeInTheDocument()
    })
  })

  it("shows an error state when the query rejects", async () => {
    mockGetHeygenAvatars.mockRejectedValue(new Error("network error"))
    renderWithQuery(<AvatarPicker value={undefined} onSelect={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText(/Failed to load avatars/i)).toBeInTheDocument()
    })
  })
})
