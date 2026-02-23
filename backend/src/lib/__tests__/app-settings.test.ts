import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/supabase.js", () => {
  const mockSelect = vi.fn()
  const mockFrom = vi.fn().mockReturnValue({ select: mockSelect })
  return { supabase: { from: mockFrom } }
})

import {
  getAppSettings,
  calculateDisplayCost,
  invalidateSettingsCache,
} from "@/lib/app-settings.js"
import { supabase } from "@/lib/supabase.js"

const mockFrom = supabase.from as ReturnType<typeof vi.fn>
const mockSelect = (mockFrom as (...args: unknown[]) => Record<string, ReturnType<typeof vi.fn>>)().select as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  invalidateSettingsCache()
})

describe("getAppSettings", () => {
  it("returns parsed settings from DB rows", async () => {
    mockSelect.mockResolvedValueOnce({
      data: [
        { key: "ai_provider", value: "kie" },
        { key: "cost_markup_percent", value: 50 },
      ],
      error: null,
    })

    const settings = await getAppSettings()

    expect(settings.ai_provider).toBe("kie")
    expect(settings.cost_markup_percent).toBe(50)
    expect(mockFrom).toHaveBeenCalledWith("app_settings")
  })

  it("returns defaults on DB error", async () => {
    mockSelect.mockResolvedValueOnce({
      data: null,
      error: { message: "fail" },
    })

    const settings = await getAppSettings()

    expect(settings.ai_provider).toBe("replicate")
    ***REDACTED-OSS-SCRUB***
  })

  it("returns cached result on second call within TTL", async () => {
    mockSelect.mockResolvedValueOnce({
      data: [
        { key: "ai_provider", value: "kie" },
        { key: "cost_markup_percent", value: 30 },
      ],
      error: null,
    })

    const first = await getAppSettings()
    const second = await getAppSettings()

    expect(first).toEqual(second)
    expect(mockSelect).toHaveBeenCalledTimes(1)
  })

  it("refreshes after invalidateSettingsCache", async () => {
    mockSelect
      .mockResolvedValueOnce({
        data: [{ key: "ai_provider", value: "kie" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ key: "ai_provider", value: "replicate" }],
        error: null,
      })

    const first = await getAppSettings()
    expect(first.ai_provider).toBe("kie")

    invalidateSettingsCache()

    const second = await getAppSettings()
    expect(second.ai_provider).toBe("replicate")
    expect(mockSelect).toHaveBeenCalledTimes(2)
  })

  it("coalesces concurrent calls (stampede protection)", async () => {
    mockSelect.mockResolvedValueOnce({
      data: [{ key: "ai_provider", value: "kie" }],
      error: null,
    })

    const [a, b, c] = await Promise.all([
      getAppSettings(),
      getAppSettings(),
      getAppSettings(),
    ])

    expect(a).toEqual(b)
    expect(b).toEqual(c)
    expect(mockSelect).toHaveBeenCalledTimes(1)
  })

  it("ignores unknown keys in rows", async () => {
    mockSelect.mockResolvedValueOnce({
      data: [
        { key: "unknown_setting", value: "whatever" },
        { key: "ai_provider", value: "kie" },
      ],
      error: null,
    })

    const settings = await getAppSettings()

    expect(settings.ai_provider).toBe("kie")
    ***REDACTED-OSS-SCRUB***
    expect(settings).not.toHaveProperty("unknown_setting")
  })
})

describe("calculateDisplayCost", () => {
  it("applies configured pricing factor to $1.00", () => {
    expect(calculateDisplayCost(1.0, 25)).toBe(1.25)
  })

  it("applies 0% markup to $1.00", () => {
    expect(calculateDisplayCost(1.0, 0)).toBe(1.0)
  })

  it("applies 100% markup to $0.50", () => {
    expect(calculateDisplayCost(0.5, 100)).toBe(1.0)
  })
})
