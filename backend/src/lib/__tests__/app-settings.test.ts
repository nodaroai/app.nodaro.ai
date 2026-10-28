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

  it("parses service_margin_percent, dropping invalid entries", async () => {
    mockSelect.mockResolvedValueOnce({
      data: [
        { key: "cost_markup_percent", value: 25 },
        {
          key: "service_margin_percent",
          value: { svc: 30, "svc:pro": 45, bad: -5, over: 501, "": 10, str: "20", nan: Number.NaN },
        },
      ],
      error: null,
    })

    const settings = await getAppSettings()

    // Valid rows kept; negative / >500 / empty-prefix / non-number / NaN dropped.
    expect(settings.service_margin_percent).toEqual({ svc: 30, "svc:pro": 45 })
    expect(settings.cost_markup_percent).toBe(25)
  })

  it("defaults service_margin_percent to empty when the row is missing or malformed", async () => {
    mockSelect.mockResolvedValueOnce({
      data: [{ key: "service_margin_percent", value: ["not", "an", "object"] }],
      error: null,
    })
    expect((await getAppSettings()).service_margin_percent).toEqual({})

    invalidateSettingsCache()
    mockSelect.mockResolvedValueOnce({ data: [], error: null })
    expect((await getAppSettings()).service_margin_percent).toEqual({})
  })

  it("returns defaults on DB error", async () => {
    mockSelect.mockResolvedValueOnce({
      data: null,
      error: { message: "fail" },
    })

    const settings = await getAppSettings()

    expect(settings.ai_provider).toBe("replicate")
    expect(settings.cost_markup_percent).toBe(0)
    // No maker mark is published on a guess.
    expect(settings.model_maker_logos).toEqual([])
  })

  it("reads model_maker_logos — the known maker ids, once each — and defaults to none", async () => {
    mockSelect.mockResolvedValueOnce({
      data: [{ key: "model_maker_logos", value: ["google", "acme", "google", "openai", 7] }],
      error: null,
    })
    expect((await getAppSettings()).model_maker_logos).toEqual(["google", "openai"])

    invalidateSettingsCache()
    mockSelect.mockResolvedValueOnce({ data: [{ key: "model_maker_logos", value: "google" }], error: null })
    expect((await getAppSettings()).model_maker_logos).toEqual([])

    invalidateSettingsCache()
    mockSelect.mockResolvedValueOnce({ data: [], error: null })
    expect((await getAppSettings()).model_maker_logos).toEqual([])
  })

  it("reads the direct runs' Pulse audio: original or generated, anything else (or no row, or a failed read) as never saved", async () => {
    mockSelect.mockResolvedValueOnce({ data: [{ key: "nodaro_motion_pulse_audio", value: "generated" }], error: null })
    expect((await getAppSettings()).nodaro_motion_pulse_audio).toBe("generated")

    invalidateSettingsCache()
    mockSelect.mockResolvedValueOnce({ data: [{ key: "nodaro_motion_pulse_audio", value: "original" }], error: null })
    expect((await getAppSettings()).nodaro_motion_pulse_audio).toBe("original")

    for (const value of ["mute", "", null, { pulseAudio: "generated" }]) {
      invalidateSettingsCache()
      mockSelect.mockResolvedValueOnce({ data: [{ key: "nodaro_motion_pulse_audio", value }], error: null })
      expect((await getAppSettings()).nodaro_motion_pulse_audio, JSON.stringify(value)).toBeNull()
    }

    invalidateSettingsCache()
    mockSelect.mockResolvedValueOnce({ data: [], error: null })
    expect((await getAppSettings()).nodaro_motion_pulse_audio).toBeNull()

    invalidateSettingsCache()
    mockSelect.mockResolvedValueOnce({ data: null, error: { message: "fail" } })
    expect((await getAppSettings()).nodaro_motion_pulse_audio).toBeNull()
  })

  it("reads the direct runs' Prism reference audio: full, voice or none, anything else (or no row, or a failed read) as never saved", async () => {
    for (const value of ["full", "voice", "none"]) {
      invalidateSettingsCache()
      mockSelect.mockResolvedValueOnce({ data: [{ key: "nodaro_motion_prism_reference_audio", value }], error: null })
      expect((await getAppSettings()).nodaro_motion_prism_reference_audio).toBe(value)
    }

    for (const value of ["mute", "", null, { prismReferenceAudio: "voice" }]) {
      invalidateSettingsCache()
      mockSelect.mockResolvedValueOnce({ data: [{ key: "nodaro_motion_prism_reference_audio", value }], error: null })
      expect((await getAppSettings()).nodaro_motion_prism_reference_audio, JSON.stringify(value)).toBeNull()
    }

    invalidateSettingsCache()
    mockSelect.mockResolvedValueOnce({ data: [], error: null })
    expect((await getAppSettings()).nodaro_motion_prism_reference_audio).toBeNull()

    invalidateSettingsCache()
    mockSelect.mockResolvedValueOnce({ data: null, error: { message: "fail" } })
    expect((await getAppSettings()).nodaro_motion_prism_reference_audio).toBeNull()
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

  it("reads the gallery moderation lists, keeping only well-formed entries", async () => {
    const creator = "00000000-0000-4000-8000-00000000000a"
    mockSelect.mockResolvedValueOnce({
      data: [
        { key: "gallery_blocked_words", value: [{ word: " bucket ", translations: ["seau", ""], exceptions: ["bucket of water"] }, { nope: 1 }] },
        { key: "gallery_banned_users", value: [{ userId: creator, addedAt: "2026-10-04T00:00:00.000Z" }, { userId: "not-an-id" }] },
      ],
      error: null,
    })

    const settings = await getAppSettings()

    expect(settings.gallery_blocked_words).toEqual([{ word: "bucket", translations: ["seau"], exceptions: ["bucket of water"] }])
    expect(settings.gallery_banned_users).toEqual([{ userId: creator, addedAt: "2026-10-04T00:00:00.000Z" }])
  })

  it("defaults the gallery moderation lists to empty", async () => {
    mockSelect.mockResolvedValueOnce({ data: [{ key: "gallery_blocked_words", value: "garbage" }], error: null })

    const settings = await getAppSettings()

    expect(settings.gallery_blocked_words).toEqual([])
    expect(settings.gallery_banned_users).toEqual([])
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
    expect(settings.cost_markup_percent).toBe(0)
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
