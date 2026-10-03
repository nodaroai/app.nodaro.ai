import { beforeEach, describe, expect, it, vi } from "vitest"
import type { BillingContext } from "../../../lib/billing-context.js"

/**
 * The UGC quote's arithmetic, with the price table and the jobs table stubbed.
 * Which id each tool reserves is pinned against the real routes in
 * `ugc-quote-parity.test.ts`; this file pins the pricing, the refusals and the
 * already-spent lines.
 */
const h = vi.hoisted(() => ({
  prices: {} as Record<string, number>,
  markup: 0,
  jobs: [] as Array<Record<string, unknown>>,
  jobsError: null as unknown,
  inCalls: [] as unknown[][],
  /** Per-id admin availability; an id not listed is enabled for every tier. */
  availability: {} as Record<string, { isEnabled?: boolean; tierRestriction?: string | null }>,
  profile: { tier: "free", subscription_tier: null, lifetime_topup_credits: 0 } as Record<string, unknown> | null,
  /** Other accounts' profiles (a deployment payer's), by id. */
  profiles: {} as Record<string, Record<string, unknown>>,
  profileReads: 0,
  profileReadIds: [] as string[],
}))

vi.mock("../../billing/credits.js", () => ({
  getModelCreditCostFromDB: vi.fn(async (id: string) => {
    const base = h.prices[id]
    if (base === undefined) throw new Error(`no price for ${id}`)
    const a = h.availability[id] ?? {}
    return {
      creditCost: h.markup > 0 ? Math.ceil((base * (100 + h.markup)) / 100) : base,
      isEnabled: a.isEnabled ?? true,
      tierRestriction: a.tierRestriction ?? null,
    }
  }),
}))
vi.mock("../../../lib/app-settings.js", () => ({
  getAppSettings: vi.fn(async () => ({ cost_markup_percent: h.markup })),
}))
vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: vi.fn((table: string) => table === "profiles" ? ({
      select: () => ({
        eq: (_c: string, id: string) => ({
          single: async () => {
            h.profileReads += 1
            h.profileReadIds.push(id)
            const row = id === USER ? h.profile : h.profiles[id]
            return row ? { data: row, error: null } : { data: null, error: { message: "no profile" } }
          },
        }),
      }),
    }) : ({
      select: () => ({
        in: (_col: string, ids: unknown[]) => {
          h.inCalls.push(ids)
          return {
            eq: async (_c: string, userId: string) => ({
              data: h.jobsError ? null : h.jobs.filter((j) => ids.includes(j.id) && j.user_id === userId),
              error: h.jobsError,
            }),
          }
        },
      }),
    })),
  },
}))

const USER = "u1"
const PAYER = "payer-1"
const { buildUgcQuote, pricingFor, UgcQuoteError } = await import("../ugc-quote.js")

const J = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const item = (tool: string, args: Record<string, unknown> = {}, label = tool) => ({ label, tool, args, count: 1 })
const quote = (items: ReturnType<typeof item>[], spentJobIds: string[] = [], clipCount = 1, billingContext?: BillingContext) =>
  buildUgcQuote({ items, clipCount, spentJobIds, userId: USER, ...(billingContext ? { billingContext } : {}) })

beforeEach(() => {
  h.prices = {
    "seedance-2-5:8s:720p": 1260, "extract-frame": 10, "image-collage:2K": 20,
    "image-collage:4K": 40, "image-to-text": 3, "elevenlabs-forced-alignment": 30, "elevenlabs-stt": 22,
    "video-overlay": 20, "add-captions": 30, "add-captions:kinetic": 50, "elevenlabs-v3": 30, "combine-videos": 30,
    "silence-detect": 10,
  }
  h.markup = 0
  h.jobs = []
  h.jobsError = null
  h.inCalls = []
  h.availability = {}
  h.profile = { tier: "free", subscription_tier: null, lifetime_topup_credits: 0 }
  h.profiles = {}
  h.profileReads = 0
  h.profileReadIds = []
})

describe("pricing each item", () => {
  it("a clip prices at its exact duration × resolution row", async () => {
    const q = await quote([item("generate_video", { model: "seedance-2-5", aspect_ratio: "16:9", duration: 8, resolution: "720p", reference_image_urls: ["https://cdn.example/a.png"] }, "Clip 1")])
    expect(q.lines).toEqual([{ label: "Clip 1", credits: 1260 }])
  })
  it("the frame check prices the collage at its explicit 2K row", async () => {
    const q = await quote([item("image_collage", { resolution: "2K", layout: "grid" })])
    expect(q.lines[0]!.credits).toBe(20)
    expect(pricingFor("image_collage", {}, { clipCount: 1 })).toEqual({ id: "image-collage:4K" })
  })
  it("caption segments price at the kinetic row, whatever their styles", async () => {
    const q = await quote([item("add_captions", { segments: [{ style: "subtitle" }, { style: "word-highlight" }] })])
    expect(q.lines[0]!.credits).toBe(50)
  })
  it("transcribe prices at the engine the verb sends, never the route's default", async () => {
    expect(pricingFor("transcribe", {}, { clipCount: 1 })).toEqual({ id: "elevenlabs-stt" })
    expect((await quote([item("transcribe")])).lines[0]!.credits).toBe(22)
  })
  it("the join prices the combine estimate for its clip count, marked up like the guard marks it", async () => {
    expect(pricingFor("combine_videos", { transition: "cut", audio_mode: "keep", smart_cut: false }, { clipCount: 2 })).toEqual({ id: "combine-videos", base: 4 })
    expect(pricingFor("combine_videos", { transition: "cut" }, { clipCount: 3 })).toEqual({ id: "combine-videos", base: 6 })
    h.markup = 50
    expect((await quote([item("combine_videos", { transition: "cut" })], [], 2)).lines[0]!.credits).toBe(6)
  })
  it("the charge-time price carries the configured markup", async () => {
    h.markup = 10
    expect((await quote([item("extract_frame", { mode: "timestamp", time_seconds: 4 })])).lines[0]!.credits).toBe(11)
  })
  it("the whole list is replaced by lines, in order, with one total", async () => {
    const q = await quote([
      item("extract_frame", {}, "a"), item("image_to_text", { custom_prompt: "x" }, "b"), item("forced_alignment", {}, "c"),
      item("overlay_images", {}, "d"), item("generate_speech", { text: "hi", model: "elevenlabs-v3" }, "e"), item("silence_detect", {}, "f"),
      { ...item("extract_frame", {}, "g"), count: 2 },
    ])
    expect(q.lines).toEqual([
      { label: "a", credits: 10 }, { label: "b", credits: 3 }, { label: "c", credits: 30 }, { label: "d", credits: 20 },
      { label: "e", credits: 30 }, { label: "f", credits: 10 }, { label: "g", credits: 20 },
    ])
    expect(q.total).toBe(123)
  })
})

describe("refusing to guess", () => {
  it.each([
    ["an unknown tool", item("teleport_video", {}, "Mystery step")],
    ["a clip with no explicit duration", item("generate_video", { model: "seedance-2-5", resolution: "720p" }, "Mystery step")],
    ["a clip with reference videos", item("generate_video", { model: "seedance-2-5", duration: 8, resolution: "720p", reference_video_urls: ["x"] }, "Mystery step")],
    ["speech with no model", item("generate_speech", { text: "hi" }, "Mystery step")],
    ["an id with no price", item("generate_video", { model: "seedance-2-5", duration: 9, resolution: "720p" }, "Mystery step")],
    ["a count of zero", { ...item("extract_frame", {}, "Mystery step"), count: 0 }],
    ["a fractional count", { ...item("extract_frame", {}, "Mystery step"), count: 1.5 }],
    ["args that are not an object", { ...item("extract_frame", {}, "Mystery step"), args: "x" as never }],
    ["a tool that is not a string", { ...item("extract_frame", {}, "Mystery step"), tool: 5 as never }],
  ])("%s → could not price <label>, never a zero", async (_n, it_) => {
    await expect(quote([item("extract_frame"), it_])).rejects.toThrow(UgcQuoteError)
    await expect(quote([it_])).rejects.toThrow("could not price Mystery step")
  })
})

describe("a model the caller cannot run", () => {
  const clip = item("generate_video", { model: "seedance-2-5", aspect_ratio: "16:9", duration: 8, resolution: "720p" }, "Clip 1")
  it("a model an admin disabled → could not price <label>", async () => {
    h.availability = { "seedance-2-5:8s:720p": { isEnabled: false } }
    await expect(quote([item("extract_frame"), clip])).rejects.toThrow("could not price Clip 1")
  })
  it("a disabled join is refused too, though its amount is computed rather than read from its row", async () => {
    h.availability = { "combine-videos": { isEnabled: false } }
    await expect(quote([item("combine_videos", { transition: "cut" }, "Join")], [], 2)).rejects.toThrow("could not price Join")
  })
  it("a model restricted to a tier above the caller's → could not price <label>", async () => {
    h.availability = { "seedance-2-5:8s:720p": { tierRestriction: "pro" } }
    h.profile = { tier: "basic", subscription_tier: "basic", lifetime_topup_credits: 0 }
    await expect(quote([clip])).rejects.toThrow("could not price Clip 1")
  })
  it("a free account that has topped up ranks as payg, which a basic-and-up model still refuses", async () => {
    h.availability = { "seedance-2-5:8s:720p": { tierRestriction: "basic" } }
    h.profile = { tier: "free", subscription_tier: null, lifetime_topup_credits: 500 }
    await expect(quote([clip])).rejects.toThrow("could not price Clip 1")
    h.availability = { "seedance-2-5:8s:720p": { tierRestriction: "payg" } }
    expect((await quote([clip])).lines).toEqual([{ label: "Clip 1", credits: 1260 }])
  })
  it("a restricted model the caller's tier allows is priced as usual, the profile read once", async () => {
    h.availability = { "seedance-2-5:8s:720p": { tierRestriction: "pro" }, "extract-frame": { tierRestriction: "basic" } }
    h.profile = { tier: "pro", subscription_tier: "pro", lifetime_topup_credits: 0 }
    const q = await quote([clip, item("extract_frame")])
    expect(q.lines).toEqual([{ label: "Clip 1", credits: 1260 }, { label: "extract_frame", credits: 10 }])
    expect(h.profileReads).toBe(1)
  })
  it("an unrestricted list never reads the profile", async () => {
    await quote([clip, item("extract_frame")])
    expect(h.profileReads).toBe(0)
  })
  it("a profile that cannot be read is a quote error, never a guess at the tier", async () => {
    h.availability = { "seedance-2-5:8s:720p": { tierRestriction: "basic" } }
    h.profile = null
    await expect(quote([clip])).rejects.toThrow(UgcQuoteError)
    await expect(quote([clip])).rejects.toThrow("could not price the rest of the video")
  })
})

describe("the free-tier model blocklist", () => {
  // `veo3.1` at 720p reserves under the bare `veo3.1` id, which FREE_TIER_RESTRICTIONS.blockedModels lists.
  const veo = item("generate_video", { model: "veo3.1", aspect_ratio: "16:9", duration: 8, resolution: "720p" }, "Clip 1")
  const omni4k = item("generate_video", { model: "gemini-omni-video", aspect_ratio: "16:9", duration: 8, resolution: "4k" }, "Clip 2")
  beforeEach(() => {
    h.prices["veo3.1"] = 150
    h.prices["gemini-omni-video:4k:8"] = 400
  })
  it("the quoted ids are the blocklisted ones", () => {
    expect(pricingFor(veo.tool, veo.args, { clipCount: 1 })).toEqual({ id: "veo3.1" })
    expect(pricingFor(omni4k.tool, omni4k.args, { clipCount: 1 })).toEqual({ id: "gemini-omni-video:4k:8" })
  })
  it("a free account → could not price <label>", async () => {
    await expect(quote([item("extract_frame"), veo])).rejects.toThrow("could not price Clip 1")
    await expect(quote([omni4k])).rejects.toThrow("could not price Clip 2")
  })
  it("a free account that has topped up (payg, never web-free on MCP) is not free-tier work: priced", async () => {
    h.profile = { tier: "free", subscription_tier: null, lifetime_topup_credits: 500 }
    expect((await quote([veo])).lines).toEqual([{ label: "Clip 1", credits: 150 }])
  })
  it("a paid account: priced", async () => {
    h.profile = { tier: "basic", subscription_tier: "basic", lifetime_topup_credits: 0 }
    expect((await quote([veo, omni4k])).lines).toEqual([{ label: "Clip 1", credits: 150 }, { label: "Clip 2", credits: 400 }])
    expect(h.profileReads).toBe(1)
  })
  it("a degraded personal fallback is a personal payer: refused for a free account", async () => {
    await expect(quote([veo], [], 1, { payer: "user", userId: USER, degraded: true })).rejects.toThrow("could not price Clip 1")
  })
})

describe("who pays decides the grade", () => {
  const clip = item("generate_video", { model: "seedance-2-5", aspect_ratio: "16:9", duration: 8, resolution: "720p" }, "Clip 1")
  const veo = item("generate_video", { model: "veo3.1", aspect_ratio: "16:9", duration: 8, resolution: "720p" }, "Veo clip")
  beforeEach(() => {
    h.prices["veo3.1"] = 150
  })

  describe("a deployment payer: the payer's profile and grade, never the requester's", () => {
    const DEP: BillingContext = {
      payer: "deployment",
      userId: USER,
      payerId: PAYER,
      entitlements: { watermark: false, dailyCapCredits: null, parallelism: 4, tierForGates: "pro" },
    }
    beforeEach(() => {
      // The requester is free; the payer's own row is what the guard reads.
      h.profiles[PAYER] = { tier: "pro", subscription_tier: "pro", lifetime_topup_credits: 0 }
    })
    it("a model restricted to the payer's grade is priced, though the requester is free", async () => {
      h.availability = { "seedance-2-5:8s:720p": { tierRestriction: "pro" } }
      expect((await quote([clip], [], 1, DEP)).lines).toEqual([{ label: "Clip 1", credits: 1260 }])
      expect(h.profileReadIds).toEqual([PAYER])
    })
    it("a model restricted above the payer's grade → could not price <label>", async () => {
      h.availability = { "seedance-2-5:8s:720p": { tierRestriction: "business" } }
      await expect(quote([clip], [], 1, DEP)).rejects.toThrow("could not price Clip 1")
    })
    it("the free-tier blocklist is off: deployment work is never free-tier work", async () => {
      expect((await quote([veo], [], 1, DEP)).lines).toEqual([{ label: "Veo clip", credits: 150 }])
      expect(h.profileReadIds).toEqual([PAYER])
    })
    it("a payer's profile that cannot be read is a quote error, as the guard's 500 would be", async () => {
      delete h.profiles[PAYER]
      await expect(quote([veo], [], 1, DEP)).rejects.toThrow("could not price the rest of the video")
    })
  })

  describe("a workspace payer: the organization's grade", () => {
    const WS: BillingContext = {
      payer: "workspace",
      userId: USER,
      workspaceId: "ws-1",
      orgId: "org-1",
      memberCap: null,
      entitlements: {
        watermark: false,
        dailyCapCredits: null,
        parallelism: 12,
        tierForGates: "business",
        freeTierBlocklist: false,
        webFreeMode: false,
        appCreditsAllowance: false,
      },
    }
    it("a free member's class work may price a business-only model and a blocklisted one", async () => {
      h.availability = { "seedance-2-5:8s:720p": { tierRestriction: "business" } }
      expect((await quote([clip, veo], [], 1, WS)).lines).toEqual([
        { label: "Clip 1", credits: 1260 },
        { label: "Veo clip", credits: 150 },
      ])
    })
    it("the same member without the workspace is refused both", async () => {
      h.availability = { "seedance-2-5:8s:720p": { tierRestriction: "business" } }
      await expect(quote([clip])).rejects.toThrow("could not price Clip 1")
      await expect(quote([veo])).rejects.toThrow("could not price Veo clip")
    })
    it("a model an admin disabled is refused whatever the grade", async () => {
      h.availability = { "seedance-2-5:8s:720p": { isEnabled: false } }
      await expect(quote([clip], [], 1, WS)).rejects.toThrow("could not price Clip 1")
    })
  })

  it("a personal payer, stated or absent, is unchanged", async () => {
    h.availability = { "seedance-2-5:8s:720p": { tierRestriction: "pro" } }
    h.profile = { tier: "pro", subscription_tier: "pro", lifetime_topup_credits: 0 }
    expect((await quote([clip], [], 1, { payer: "user", userId: USER })).lines).toEqual([{ label: "Clip 1", credits: 1260 }])
    expect((await quote([clip])).lines).toEqual([{ label: "Clip 1", credits: 1260 }])
    expect(h.profileReadIds).toEqual([USER, USER])
  })
})

describe("a malformed item from the builder", () => {
  it.each([
    ["null", null],
    ["a string", "extract_frame"],
    ["an item with no label", { tool: "extract_frame", args: {}, count: 1 }],
    ["an item with a blank label", { label: "", tool: "extract_frame", args: {}, count: 1 }],
  ])("%s → could not price a quote item, never a crash", async (_n, raw) => {
    await expect(buildUgcQuote({ items: [raw], clipCount: 1, spentJobIds: [], userId: USER })).rejects.toThrow(UgcQuoteError)
    await expect(buildUgcQuote({ items: [raw], clipCount: 1, spentJobIds: [], userId: USER })).rejects.toThrow("could not price a quote item")
  })
  it("an item with no args prices as if it had none", async () => {
    const q = await buildUgcQuote({ items: [{ label: "a", tool: "extract_frame", count: 1 }], clipCount: 1, spentJobIds: [], userId: USER })
    expect(q.lines).toEqual([{ label: "a", credits: 10 }])
  })
})

describe("already-spent lines", () => {
  it("each of this user's jobs is a line labelled by its type, above the lines to come, in the total", async () => {
    h.jobs = [
      { id: J(1), user_id: USER, status: "completed", job_type: "generate-image", input_data: { type: "generate-image" }, credits: 45, credits_actual: 45 },
      { id: J(2), user_id: USER, status: "completed", job_type: null, input_data: { type: "image-to-text" }, credits: 3, credits_actual: 3 },
    ]
    const q = await quote([item("extract_frame")], [J(1), J(2)])
    expect(q.spent).toEqual([{ label: "generate-image (already spent)", credits: 45 }, { label: "image-to-text (already spent)", credits: 3 }])
    expect(q.total).toBe(58)
    expect(q.skipped).toEqual([])
  })
  it.each([
    ["a completed job counts its settled charge", "completed", 60, 45, 45],
    ["a completed job with no settled charge yet counts its reservation", "completed", 60, null, 60],
    ["a running job counts its reservation", "processing", 45, null, 45],
    ["a failed job with no charge counts nothing", "failed", 45, null, 0],
    ["a failed job settled with a charge counts that charge", "failed", 45, 12, 12],
    ["a cancelled job with no charge counts nothing", "cancelled", 45, null, 0],
    ["a cancelled job settled with a partial charge counts that charge", "cancelled", 45, 30, 30],
    ["a cancelled job fully refunded counts nothing", "cancelled", 45, 0, 0],
  ])("%s", async (_n, status, credits, creditsActual, expected) => {
    h.jobs = [{ id: J(1), user_id: USER, status, job_type: "generate-image", input_data: {}, credits, credits_actual: creditsActual }]
    const q = await quote([], [J(1)])
    expect(q.spent).toEqual([{ label: "generate-image (already spent)", credits: expected }])
  })
  it("another user's job, an unknown id and a non-uuid are skipped and named — the query never sees a non-uuid", async () => {
    h.jobs = [{ id: J(1), user_id: "someone-else", status: "completed", job_type: "x", input_data: {}, credits: 9, credits_actual: 9 }]
    const q = await quote([], [J(1), J(2), "https://cdn.example/a.png", "job-123"])
    expect(q.spent).toEqual([])
    expect(q.skipped).toEqual([J(1), J(2), "https://cdn.example/a.png", "job-123"])
    expect(h.inCalls).toEqual([[J(1), J(2)]])
  })
  it("a duplicated id is counted once", async () => {
    h.jobs = [{ id: J(1), user_id: USER, status: "completed", job_type: "generate-image", input_data: {}, credits: 45, credits_actual: 45 }]
    expect((await quote([], [J(1), J(1)])).spent).toHaveLength(1)
  })
  it("a user's own id sent in upper case is counted, not skipped, and once alongside its lower-case form", async () => {
    const id = "abcdef00-0000-4000-8000-00000000000a"
    h.jobs = [{ id, user_id: USER, status: "completed", job_type: "generate-image", input_data: {}, credits: 45, credits_actual: 45 }]
    const q = await quote([], [id.toUpperCase(), id])
    expect(q.spent).toEqual([{ label: "generate-image (already spent)", credits: 45 }])
    expect(q.skipped).toEqual([])
    expect(h.inCalls).toEqual([[id]])
  })
  it("no ids → no query", async () => {
    await quote([item("extract_frame")])
    expect(h.inCalls).toEqual([])
  })
  it("a failed read is a quote error, never a missing line", async () => {
    h.jobsError = { message: "boom" }
    await expect(quote([], [J(1)])).rejects.toThrow("could not price the calls already made")
  })
})
