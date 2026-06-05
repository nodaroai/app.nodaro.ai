import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { HeygenAvatar } from "@/lib/api"
import {
  deriveGenders,
  filterAvatars,
  hasGroupSegmentation,
  avatarSupportsV,
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

const AVATAR_V_CAPABLE: HeygenAvatar = {
  avatarId: "av-4",
  name: "Vera V",
  gender: "female",
  previewImageUrl: "https://example.com/vera.jpg",
  supportedEngines: ["avatar_v", "avatar_iv"],
}

const AVATAR_IV_ONLY: HeygenAvatar = {
  avatarId: "av-5",
  name: "Irene IV",
  gender: "female",
  previewImageUrl: "https://example.com/irene.jpg",
  supportedEngines: ["avatar_iv"],
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
// avatarSupportsV helper
// ===========================================================================
describe("avatarSupportsV()", () => {
  it("returns true when supportedEngines includes 'avatar_v'", () => {
    expect(avatarSupportsV(AVATAR_V_CAPABLE)).toBe(true)
  })

  it("returns false when supportedEngines only contains 'avatar_iv'", () => {
    expect(avatarSupportsV(AVATAR_IV_ONLY)).toBe(false)
  })

  it("returns false when supportedEngines is undefined (no metadata from API)", () => {
    expect(avatarSupportsV(MALE_AVATAR)).toBe(false)
  })
})

// ===========================================================================
// filterAvatars — Avatar V filter
// ===========================================================================
describe("filterAvatars() with onlyAvatarV", () => {
  const catalog = [MALE_AVATAR, AVATAR_V_CAPABLE, AVATAR_IV_ONLY]

  it("returns all avatars when onlyAvatarV is false (default)", () => {
    expect(filterAvatars(catalog, "", "all", "all", false)).toHaveLength(3)
  })

  it("filters to only V-capable avatars when onlyAvatarV is true", () => {
    const result = filterAvatars(catalog, "", "all", "all", true)
    expect(result).toHaveLength(1)
    expect(result[0].avatarId).toBe("av-4")
  })

  it("combines onlyAvatarV with gender filter", () => {
    // Both V-capable and gender=male → 0 results (Vera is female)
    expect(filterAvatars(catalog, "", "male", "all", true)).toHaveLength(0)
  })

  it("backwards-compatible: omitting onlyAvatarV defaults to false", () => {
    expect(filterAvatars(catalog, "", "all", "all")).toHaveLength(3)
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

  it("shows 'Avatar V' badge on V-capable avatars", async () => {
    mockGetHeygenAvatars.mockResolvedValue([AVATAR_V_CAPABLE, AVATAR_IV_ONLY])
    renderWithQuery(<AvatarPicker value={undefined} onSelect={() => {}} />)

    await waitFor(() => screen.getByRole("radio", { name: /Vera V/i }))

    // V-capable tile should have the badge accessible by label
    expect(screen.getByLabelText("Supports Avatar V")).toBeInTheDocument()
  })

  it("does NOT show Avatar V badge on IV-only avatars", async () => {
    mockGetHeygenAvatars.mockResolvedValue([AVATAR_IV_ONLY])
    renderWithQuery(<AvatarPicker value={undefined} onSelect={() => {}} />)

    await waitFor(() => screen.getByRole("radio", { name: /Irene IV/i }))

    expect(screen.queryByLabelText("Supports Avatar V")).not.toBeInTheDocument()
  })

  it("shows the 'Supports Avatar V' filter toggle when V avatars are present", async () => {
    mockGetHeygenAvatars.mockResolvedValue([AVATAR_V_CAPABLE, AVATAR_IV_ONLY])
    renderWithQuery(<AvatarPicker value={undefined} onSelect={() => {}} />)

    await waitFor(() => screen.getByRole("radio", { name: /Vera V/i }))

    expect(screen.getByRole("button", { name: /Supports Avatar V/i })).toBeInTheDocument()
  })

  it("does NOT show the 'Supports Avatar V' toggle when no V avatars exist", async () => {
    mockGetHeygenAvatars.mockResolvedValue([AVATAR_IV_ONLY, MALE_AVATAR])
    renderWithQuery(<AvatarPicker value={undefined} onSelect={() => {}} />)

    await waitFor(() => screen.getByRole("radio", { name: /Irene IV/i }))

    expect(screen.queryByRole("button", { name: /Supports Avatar V/i })).not.toBeInTheDocument()
  })

  it("clicking the Avatar V toggle narrows the list to V-capable avatars", async () => {
    mockGetHeygenAvatars.mockResolvedValue([AVATAR_V_CAPABLE, AVATAR_IV_ONLY])
    renderWithQuery(<AvatarPicker value={undefined} onSelect={() => {}} />)

    await waitFor(() => screen.getByRole("radio", { name: /Vera V/i }))

    // Both tiles present before toggle
    expect(screen.getByRole("radio", { name: /Irene IV/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /Supports Avatar V/i }))

    await waitFor(() => {
      expect(screen.queryByRole("radio", { name: /Irene IV/i })).not.toBeInTheDocument()
    })
    expect(screen.getByRole("radio", { name: /Vera V/i })).toBeInTheDocument()
  })
})

// ===========================================================================
// Multi-select mode — single-select usage (above) must stay unchanged
// ===========================================================================
describe("AvatarPicker multi-select mode", () => {
  it("renders tiles as checkboxes (role=checkbox) instead of radios", async () => {
    mockGetHeygenAvatars.mockResolvedValue(AVATARS)
    renderWithQuery(
      <AvatarPicker multiple selected={[]} onToggle={() => {}} onSelect={() => {}} />,
    )

    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: /Alex Studio/i })).toBeInTheDocument()
    })
    // No radios in multi mode
    expect(screen.queryByRole("radio", { name: /Alex Studio/i })).not.toBeInTheDocument()
  })

  it("clicking a tile calls onToggle with the avatar (not onSelect's single path)", async () => {
    mockGetHeygenAvatars.mockResolvedValue(AVATARS)
    const onToggle = vi.fn()
    renderWithQuery(
      <AvatarPicker multiple selected={[]} onToggle={onToggle} onSelect={() => {}} />,
    )

    await waitFor(() => screen.getByRole("checkbox", { name: /Alex Studio/i }))
    fireEvent.click(screen.getByRole("checkbox", { name: /Alex Studio/i }))

    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onToggle).toHaveBeenCalledWith(MALE_AVATAR)
  })

  it("reflects selected ids as aria-checked=true on the matching tiles", async () => {
    mockGetHeygenAvatars.mockResolvedValue(AVATARS)
    renderWithQuery(
      <AvatarPicker multiple selected={["av-1", "av-3"]} onToggle={() => {}} onSelect={() => {}} />,
    )

    await waitFor(() => screen.getByRole("checkbox", { name: /Alex Studio/i }))
    expect(screen.getByRole("checkbox", { name: /Alex Studio/i })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("checkbox", { name: /My Custom/i })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("checkbox", { name: /Diana Pro/i })).toHaveAttribute("aria-checked", "false")
  })

  it("disables unselected tiles once the cap (max) is reached", async () => {
    mockGetHeygenAvatars.mockResolvedValue(AVATARS)
    const onToggle = vi.fn()
    // max=2, already 2 selected → the third (unselected) tile is disabled.
    renderWithQuery(
      <AvatarPicker
        multiple
        max={2}
        selected={["av-1", "av-2"]}
        onToggle={onToggle}
        onSelect={() => {}}
      />,
    )

    await waitFor(() => screen.getByRole("checkbox", { name: /My Custom/i }))
    const capped = screen.getByRole("checkbox", { name: /My Custom/i })
    expect(capped).toHaveAttribute("aria-disabled", "true")

    // Clicking a disabled tile must NOT toggle.
    fireEvent.click(capped)
    expect(onToggle).not.toHaveBeenCalled()
  })

  it("still allows deselecting an already-selected tile at the cap", async () => {
    mockGetHeygenAvatars.mockResolvedValue(AVATARS)
    const onToggle = vi.fn()
    renderWithQuery(
      <AvatarPicker
        multiple
        max={2}
        selected={["av-1", "av-2"]}
        onToggle={onToggle}
        onSelect={() => {}}
      />,
    )

    await waitFor(() => screen.getByRole("checkbox", { name: /Alex Studio/i }))
    const selectedTile = screen.getByRole("checkbox", { name: /Alex Studio/i })
    // Selected tiles are never disabled even at the cap.
    expect(selectedTile).not.toHaveAttribute("aria-disabled", "true")
    fireEvent.click(selectedTile)
    expect(onToggle).toHaveBeenCalledWith(MALE_AVATAR)
  })
})
