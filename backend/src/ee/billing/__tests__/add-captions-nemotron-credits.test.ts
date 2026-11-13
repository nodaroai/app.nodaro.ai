// @test-units-by-name prices only the node types it names (add-captions, upload-video, transcribe) and the caption / Nemotron rows by id
/**
 * Add Captions transcribing on Nemotron 3.5 Transcribe is ONE charge (decided
 * 2026-11-13): `add-captions:kinetic:nemotron:<N>m`, the kinetic render row plus
 * Nemotron's per-minute base for N minutes, summed and marked up once under
 * Add Captions' margin — in the single lookup (reservations, settlements), the
 * price table (listings, estimates) and the static fallback alike — and quoted
 * only for a node that would transcribe on it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { db, settings, edition } = vi.hoisted(() => ({
  db: {
    rows: [] as Array<{ model_identifier: string; credit_cost: number }>,
    /** PostgREST's max_rows: the most rows one response can carry. */
    cap: 1000,
    /** How many whole-table reads fail before one succeeds. */
    failReads: 0,
    rangeCalls: 0,
  },
  settings: {
    value: { cost_markup_percent: 0, service_margin_percent: {} as Record<string, number> },
  },
  edition: { hasCredits: true },
}))

function modelPricingQuery() {
  let identifier: string | undefined
  const query = {
    select: () => query,
    order: () => query,
    eq: (_column: string, value: string) => {
      identifier = value
      return query
    },
    single: async () => {
      const row = db.rows.find((r) => r.model_identifier === identifier)
      return row
        ? { data: { credit_cost: row.credit_cost, is_enabled: true, tier_restriction: null }, error: null }
        : { data: null, error: { code: "PGRST116" } }
    },
    range: async (from: number, to: number) => {
      db.rangeCalls++
      if (db.failReads > 0) {
        db.failReads--
        return { data: null, error: { message: "connection reset" } }
      }
      const sorted = [...db.rows].sort((a, b) => a.model_identifier.localeCompare(b.model_identifier))
      return { data: sorted.slice(from, Math.min(to + 1, from + db.cap)), error: null }
    },
  }
  return query
}

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "model_pricing") throw new Error(`unexpected table ${table}`)
      return modelPricingQuery()
    },
  },
}))

vi.mock("@/lib/app-settings.js", () => ({
  getAppSettings: async () => settings.value,
}))

vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, hasCredits: () => edition.hasCredits }
})

import {
  CreditsService,
  STATIC_CREDIT_COSTS,
  chargedCredits,
  getChargedPriceTable,
  getModelCreditBaseCost,
  getModelCreditCostFromDB,
  invalidateModelPricingCache,
} from "../credits.js"
import { addCaptionsNemotronMinutesId, nemotronTranscribeBaseCredits, NEMOTRON_TRANSCRIBE_PRICING } from "@nodaro/shared/credits"

const KINETIC = STATIC_CREDIT_COSTS["add-captions:kinetic"]!
const RATE = STATIC_CREDIT_COSTS[NEMOTRON_TRANSCRIBE_PRICING.RATE_CREDIT_ID]!
const id = addCaptionsNemotronMinutesId

beforeEach(() => {
  db.rows = []
  settings.value = { cost_markup_percent: 0, service_margin_percent: {} }
  edition.hasCredits = true
  invalidateModelPricingCache()
})

describe("add-captions:kinetic:nemotron:<N>m — the render plus the video's minutes, one charge", () => {
  it("is never a stored row: priced from the kinetic row and the four-minute rate row", async () => {
    expect(Object.keys(STATIC_CREDIT_COSTS).filter((k) => k.startsWith("add-captions:kinetic:nemotron"))).toEqual([])
    const table = await getChargedPriceTable()
    for (const minutes of [1, 2, 10, 30, 60]) {
      expect(table.base(id(minutes)), id(minutes)).toBe(KINETIC + nemotronTranscribeBaseCredits(RATE, minutes))
      expect((await getModelCreditBaseCost(id(minutes))).creditCost, id(minutes)).toBe(KINETIC + nemotronTranscribeBaseCredits(RATE, minutes))
    }
    expect(table.base(id(10))).toBe(58)
  })

  it("is marked up once — the same as a Nemotron Transcribe node plus Add Captions with its transcript wired in", async () => {
    settings.value = { cost_markup_percent: 10, service_margin_percent: {} }
    const table = await getChargedPriceTable()
    const expected: Record<number, number> = { 1: 57, 2: 58, 10: 64, 30: 81, 60: 105 }
    for (const [minutes, credits] of Object.entries(expected)) {
      const m = Number(minutes)
      expect(chargedCredits(table, id(m)), id(m)).toBe(credits)
      expect(chargedCredits(table, id(m)), id(m)).toBe(
        chargedCredits(table, "add-captions:kinetic")! + chargedCredits(table, `nemotron-3-5-transcribe:${m}m`)!,
      )
      expect(chargedCredits(table, id(m)), id(m)).toBe((await getModelCreditCostFromDB(id(m))).creditCost)
    }
  })

  it("carries Add Captions' margin, never Nemotron's", async () => {
    settings.value = { cost_markup_percent: 0, service_margin_percent: { "add-captions": 20 } }
    expect(chargedCredits(await getChargedPriceTable(), id(10))).toBe(70)
    invalidateModelPricingCache()
    settings.value = { cost_markup_percent: 0, service_margin_percent: { "nemotron-3-5-transcribe": 50 } }
    expect(chargedCredits(await getChargedPriceTable(), id(10))).toBe(58)
  })

  it("follows both rows when they are retuned", async () => {
    db.rows = [
      { model_identifier: "add-captions:kinetic", credit_cost: 60 },
      { model_identifier: NEMOTRON_TRANSCRIBE_PRICING.RATE_CREDIT_ID, credit_cost: 4 },
    ]
    expect((await getChargedPriceTable()).base(id(3))).toBe(63)
    expect((await getModelCreditBaseCost(id(3))).creditCost).toBe(63)
  })

  it("does not price an out-of-range minutes id", async () => {
    const table = await getChargedPriceTable()
    expect(table.base("add-captions:kinetic:nemotron:0m")).toBeUndefined()
    expect(table.base("add-captions:kinetic:nemotron:61m")).toBeUndefined()
  })
})

describe("an Add Captions node on Nemotron in a workflow estimate", () => {
  const captions = (data: Record<string, unknown> = {}) => ({
    id: "c",
    type: "add-captions",
    data: { captionStyle: "word-highlight", transcribeProvider: "nemotron-3-5-transcribe", ...data },
  })
  const video = { id: "v", type: "upload-video", data: { url: "https://m.test/v.mp4", duration: 290 } }

  it("quotes 60 minutes — the most a run that measures the video can be charged — when the video's length is not known", async () => {
    expect(await CreditsService.estimateWorkflowCredits([captions()])).toBe(KINETIC + nemotronTranscribeBaseCredits(RATE, 60))
  })

  it("quotes an uploaded video at the started minutes of its recorded length (4:50 → 5 minutes)", async () => {
    expect(
      await CreditsService.estimateWorkflowCredits([video, captions()], [{ source: "v", target: "c", sourceHandle: "video", targetHandle: "in" }]),
    ).toBe(KINETIC + nemotronTranscribeBaseCredits(RATE, 5))
  })

  it("a node that transcribes nothing, or that the graph KNOWS is fed a transcript or a caption plan, is the render alone", async () => {
    expect(await CreditsService.estimateWorkflowCredits([captions({ captions: [{ text: "hi", startMs: 0, endMs: 1 }] })])).toBe(KINETIC)
    expect(await CreditsService.estimateWorkflowCredits([captions({ autoTranscribe: false, text: "Hello there" })])).toBe(KINETIC)
    const t = { id: "t", type: "transcribe", data: { provider: "elevenlabs-stt" } }
    const wiredTranscript = await CreditsService.estimateWorkflowCredits(
      [video, t, captions()],
      [
        { source: "v", target: "c", sourceHandle: "video", targetHandle: "in" },
        { source: "t", target: "c", sourceHandle: "json", targetHandle: "transcript" },
      ],
    )
    expect(wiredTranscript).toBe(STATIC_CREDIT_COSTS["elevenlabs-stt"]! + KINETIC)
  })

  // The run's resolver hands Add Captions a Transcribe node's WORDS, and only when there are some; a
  // wordless one hands it text, which a kinetic style only falls back on — so it still transcribes.
  describe("a Transcribe node wired into the video handle", () => {
    const graph = (transcribeData: Record<string, unknown>, extraEdges: Array<{ source: string; target: string; sourceHandle: string; targetHandle: string }> = []) =>
      CreditsService.estimateWorkflowCredits(
        [video, { id: "t", type: "transcribe", data: transcribeData }, captions()],
        [
          { source: "v", target: "c", sourceHandle: "video", targetHandle: "in" },
          { source: "t", target: "c", sourceHandle: "text", targetHandle: "in" },
          ...extraEdges,
        ],
      )
    const withComposite = (transcribe: string) => STATIC_CREDIT_COSTS[transcribe]! + KINETIC + nemotronTranscribeBaseCredits(RATE, 5)
    const withRender = (transcribe: string) => STATIC_CREDIT_COSTS[transcribe]! + KINETIC

    it("that returns words (ElevenLabs Scribe, word-level always) replaces the transcription: the render alone", async () => {
      expect(await graph({ provider: "elevenlabs-stt" })).toBe(withRender("elevenlabs-stt"))
    })

    it("on whisper (no word timings) does not: the node still transcribes, and is quoted so (never below the charge)", async () => {
      expect(await graph({ provider: "whisper" })).toBe(withComposite("whisper"))
    })

    it("while translating does not either", async () => {
      // The Transcribe node itself: Nemotron at its 60-minute quote (no audio wired to it).
      expect(await graph({ provider: "nemotron-3-5-transcribe", targetLanguage: "es" })).toBe(
        nemotronTranscribeBaseCredits(RATE, 60) + KINETIC + nemotronTranscribeBaseCredits(RATE, 5),
      )
    })

    it("on a lane that gives words only when asked: not asked → still transcribes; asked (or its json wired) → the render alone", async () => {
      expect(await graph({ provider: "incredibly-fast-whisper" })).toBe(withComposite("incredibly-fast-whisper"))
      expect(await graph({ provider: "incredibly-fast-whisper", wordTimestamps: true })).toBe(withRender("incredibly-fast-whisper"))
    })
  })

  it("leaves the other engines on the flat render price", async () => {
    expect(await CreditsService.estimateWorkflowCredits([captions({ transcribeProvider: "elevenlabs-stt" })])).toBe(KINETIC)
    expect(await CreditsService.estimateWorkflowCredits([captions({ transcribeProvider: undefined })])).toBe(KINETIC)
  })
})
