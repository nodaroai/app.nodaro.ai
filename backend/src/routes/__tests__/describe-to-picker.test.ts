import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const mocks = vi.hoisted(() => ({
  maybeProxyLlmRouteToCloud: vi.fn(),
  insertJob: vi.fn(),
  jobUpdate: vi.fn(),
  reserveCreditsForJob: vi.fn(),
  commitReservedCreditsForJob: vi.fn(),
  refundReservedCreditsForJob: vi.fn(),
  markProviderCallStart: vi.fn(),
  llmCompleteStructured: vi.fn(),
  prefetchAsBase64: vi.fn(),
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", ANTHROPIC_API_KEY: "test-key", KIE_API_KEY: "", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true,
}))
vi.mock("@/lib/cloud-llm-proxy.js", () => ({ maybeProxyLlmRouteToCloud: mocks.maybeProxyLlmRouteToCloud }))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: mocks.insertJob }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: mocks.reserveCreditsForJob,
}))
vi.mock("@/lib/credits-job-lifecycle.js", () => ({
  commitReservedCreditsForJob: mocks.commitReservedCreditsForJob,
  refundReservedCreditsForJob: mocks.refundReservedCreditsForJob,
}))
vi.mock("@/lib/reconcile/persistence.js", () => ({ markProviderCallStart: mocks.markProviderCallStart }))
vi.mock("@/lib/llm-client.js", () => ({ llmCompleteStructured: mocks.llmCompleteStructured }))
vi.mock("@/lib/anthropic-image.js", () => ({ prefetchAsBase64: mocks.prefetchAsBase64 }))
vi.mock("@/lib/supabase.js", () => {
  // .update({...}).eq("id", …).eq("user_id", …) — the exact chain the route uses.
  const second = vi.fn().mockResolvedValue({ data: null, error: null })
  const first = vi.fn(() => ({ eq: second }))
  return {
    supabase: {
      from: vi.fn(() => ({
        update: (row: Record<string, unknown>) => {
          mocks.jobUpdate(row)
          return { eq: first }
        },
      })),
      rpc: vi.fn().mockResolvedValue({ error: null }),
    },
  }
})

import { resolveTargetPickers, buildGapRecords, buildMissingPickerReport, buildSystemPrompt, describeToPickerRoutes } from "../describe-to-picker.js"

describe("resolveTargetPickers", () => {
  it("prefers the targetPickers array", () => {
    expect(resolveTargetPickers({ targetPickers: ["person", "styling"] })).toEqual(["person", "styling"])
  })
  it("falls back to the legacy scalar targetPicker", () => {
    expect(resolveTargetPickers({ targetPicker: "person" })).toEqual(["person"])
  })
  it("returns [] when neither present", () => {
    expect(resolveTargetPickers({})).toEqual([])
  })
})

describe("buildGapRecords", () => {
  const pickerJson = { person: { age: "age-early-20s" }, framing: { composition: ["centered", "negative-space"] } }
  it("joins chosenId from the picker section and normalizes observed", () => {
    const recs = buildGapRecords(
      { missingItems: [{ picker: "person", dimension: "age", observed: "  Late  Teens " }], missingCategories: [] },
      pickerJson,
      "u1",
    )
    expect(recs).toEqual([
      {
        p_picker_type: "person",
        p_gap_type: "item",
        p_dimension: "age",
        p_observed: "  Late  Teens ",
        p_observed_norm: "late teens",
        p_chosen_id: "age-early-20s",
        p_sample_user_id: "u1",
      },
    ])
  })
  it("uses the first array element for chosenId and null for categories", () => {
    const recs = buildGapRecords(
      {
        missingItems: [{ picker: "framing", dimension: "composition", observed: "x" }],
        missingCategories: [{ picker: "person", suggestedDimension: "freckle-density", observed: "y" }],
      },
      pickerJson,
      "u1",
    )
    expect(recs[0].p_chosen_id).toBe("centered")
    expect(recs[1]).toMatchObject({ p_gap_type: "category", p_dimension: "freckle-density", p_chosen_id: null })
  })
  it("returns [] for empty/absent gaps", () => {
    expect(buildGapRecords(undefined, pickerJson, "u1")).toEqual([])
    expect(buildGapRecords({ missingItems: [], missingCategories: [] }, pickerJson, "u1")).toEqual([])
  })
})

describe("buildMissingPickerReport", () => {
  const ctx = {
    imageUrl: "https://cdn.example/img.png",
    llmModel: "claude-opus-4.7",
    targetPickers: ["person"],
    origin: "person",
    userId: "u1",
    jobId: "j1",
  }

  it("builds a per-incident app_report carrying the image link and app origin", () => {
    const gaps = {
      missingItems: [{ picker: "person", dimension: "hair-color", observed: "blue-green ombre" }],
      missingCategories: [{ picker: "person", suggestedDimension: "freckles", observed: "dense freckles" }],
    }
    const report = buildMissingPickerReport(gaps, ctx)
    expect(report).toMatchObject({
      appSlug: "person",
      node: "describe-to-picker",
      kind: "missing-picker",
      title: "2 unmatched attributes in image analysis",
      userId: "u1",
      jobId: "j1",
    })
    expect(report?.payload).toMatchObject({ imageUrl: ctx.imageUrl, gaps, llmModel: ctx.llmModel })
  })

  it("is null when the analysis had no gaps (no report row)", () => {
    expect(buildMissingPickerReport(undefined, ctx)).toBeNull()
    expect(buildMissingPickerReport({ missingItems: [], missingCategories: [] }, ctx)).toBeNull()
  })

  it("omits the app slug when no origin was sent", () => {
    const report = buildMissingPickerReport(
      { missingItems: [{ picker: "person", dimension: "age", observed: "x" }], missingCategories: [] },
      { ...ctx, origin: undefined },
    )
    expect(report?.appSlug).toBeNull()
    expect(report?.title).toBe("1 unmatched attribute in image analysis")
  })
})

describe("buildSystemPrompt", () => {
  const otherLegend = "- setting: Setting\n- exposure-settings: Exposure Settings — Aperture, Shutter Speed, ISO"

  it("appends the OTHER PICKERS reference (with its text) when otherPickersLegend is non-empty", () => {
    const out = buildSystemPrompt("WIRED LEGEND", undefined, otherLegend)
    expect(out).toContain("OTHER PICKERS")
    expect(out).toContain(otherLegend)
    // The appended reference lands AFTER the wired legend.
    expect(out.indexOf("OTHER PICKERS")).toBeGreaterThan(out.indexOf("WIRED LEGEND"))
  })

  it("omits the OTHER PICKERS section entirely when otherPickersLegend is empty", () => {
    const out = buildSystemPrompt("WIRED LEGEND", undefined, "")
    expect(out).not.toContain("OTHER PICKERS")
    // The wired legend + gap guidance are still present.
    expect(out).toContain("WIRED LEGEND")
    expect(out).toContain("GAPS (catalog feedback)")
  })
})

describe("POST /v1/describe-to-picker — W1-a minor-age floor", () => {
  const USER_ID = "00000000-0000-4000-8000-000000000001"

  let app: FastifyInstance

  async function post(payload: Record<string, unknown>) {
    return app.inject({ method: "POST", url: "/v1/describe-to-picker", payload })
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.maybeProxyLlmRouteToCloud.mockResolvedValue(false)
    mocks.insertJob.mockResolvedValue({ data: { id: "job-1" }, error: null })
    mocks.reserveCreditsForJob.mockResolvedValue({ usageLogId: "usage-1" })
    mocks.commitReservedCreditsForJob.mockResolvedValue(undefined)
    mocks.refundReservedCreditsForJob.mockResolvedValue(0)
    mocks.markProviderCallStart.mockResolvedValue(undefined)
    mocks.prefetchAsBase64.mockResolvedValue({ type: "image", url: "https://cdn.example/img.png" })

    app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      const body = req.body as Record<string, unknown> | undefined
      if (typeof body?.userId === "string") req.userId = body.userId
    })
    await app.register(async (instance) => { await describeToPickerRoutes(instance) })
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  const VALID = {
    imageUrl: "https://cdn.example/img.png",
    targetPickers: ["person", "styling"],
    userId: USER_ID,
  }

  it("a minor person value floors adult-only ids from the same analysis's styling before the response", async () => {
    mocks.llmCompleteStructured.mockResolvedValue({
      output: { person: { age: "age-pre-teen" }, styling: { top: "top-bra-top" } },
      inputTokens: 100,
      outputTokens: 50,
    })
    const res = await post(VALID)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.pickerJson.styling).toEqual({})
    expect(body.pickerJson.person).toEqual({ age: "age-pre-teen" })
    // The floored value is also what gets persisted on the job row and fed to gap recording.
    expect(mocks.jobUpdate).toHaveBeenCalledWith({
      status: "completed",
      output_data: { json: { person: { age: "age-pre-teen" }, styling: {} }, targetPickers: ["person", "styling"], usage: { inputTokens: 100, outputTokens: 50 } },
    })
  })

  it("is unaffected for an adult person value", async () => {
    mocks.llmCompleteStructured.mockResolvedValue({
      output: { person: { age: "age-30s" }, styling: { top: "top-bra-top" } },
      inputTokens: 100,
      outputTokens: 50,
    })
    const res = await post(VALID)
    expect(res.statusCode).toBe(200)
    expect(res.json().pickerJson.styling).toEqual({ top: "top-bra-top" })
  })
})
