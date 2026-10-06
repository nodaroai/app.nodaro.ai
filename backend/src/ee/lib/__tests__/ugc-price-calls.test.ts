import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * `priceUgcCalls` (spec §5.4): the charge-time price of each builder call, in
 * order, behind the plugin's `tk.http.priceUgcCalls`. Same rows and gates as
 * `buildUgcQuote`; the price table and the profile read are stubbed the way
 * `ugc-quote.test.ts` stubs them. Which id each tool reserves is pinned against
 * the real routes in `ugc-quote-parity.test.ts`.
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
const { priceUgcCalls, ESTIMATE_CALLER } = await import("../ugc-quote.js")

beforeEach(() => {
  h.prices = {}
  h.markup = 0
  h.jobs = []
  h.availability = {}
  h.profile = { tier: "free", subscription_tier: null, lifetime_topup_credits: 0 }
  h.profiles = {}
  h.profileReads = 0
  h.profileReadIds = []
})

describe("priceUgcCalls (spec §5.4)", () => {
  it("prices each call at its charge-time row, in order", async () => {
    h.prices = { "seedance-2-5:15s:720p": 2370, "image-to-text": 3 }
    const calls = [
      { tool: "generate_video", args: { prompt: "p", model: "seedance-2-5", aspect_ratio: "9:16", duration: 15, resolution: "720p", reference_image_urls: ["https://cdn.example/c.png"] } },
      { tool: "image_to_text", args: { custom_prompt: "q" } },
    ]
    expect(await priceUgcCalls({ userId: USER }, calls)).toEqual([2370, 3])
  })
  it("prices a creator image through the route's own id function", async () => {
    h.prices = { "nano-banana-pro": 45 }
    expect(await priceUgcCalls({ userId: USER }, [{ tool: "generate_image", args: { prompt: "p", model: "nano-banana-pro", aspect_ratio: "3:4", resolution: "1K" } }])).toEqual([45])
  })
  it("prices a lever-less creator model (no resolution, no quality) at its own row", async () => {
    h.prices = { qwen: 10 }
    expect(await priceUgcCalls({ userId: USER }, [{ tool: "generate_image", args: { prompt: "p", model: "qwen", aspect_ratio: "3:4" } }])).toEqual([10])
  })
  it("prices a realism pass on a lever-less model without an image in hand", async () => {
    h.prices = { "qwen-i2i": 12 }
    expect(await priceUgcCalls({ userId: USER }, [{ tool: "image_to_image", args: { prompt: "p", model: "qwen-i2i" } }])).toEqual([12])
  })
  it("throws on an unpriceable call, never 0", async () => {
    await expect(priceUgcCalls({ userId: USER }, [{ tool: "teleport", args: {} }])).rejects.toThrow("could not price")
  })
  it("the estimate caller reads no profile and passes a tier restriction; a disabled model still throws", async () => {
    h.prices = { "image-to-text": 3 }
    h.availability = { "image-to-text": { tierRestriction: "business" } }
    expect(await priceUgcCalls(ESTIMATE_CALLER, [{ tool: "image_to_text", args: { custom_prompt: "q" } }])).toEqual([3])
    expect(h.profileReads).toBe(0)
    h.availability = { "image-to-text": { isEnabled: false } }
    await expect(priceUgcCalls(ESTIMATE_CALLER, [{ tool: "image_to_text", args: { custom_prompt: "q" } }])).rejects.toThrow("could not price")
  })
  it("a user caller is still refused a model above their tier", async () => {
    h.prices = { "image-to-text": 3 }
    h.availability = { "image-to-text": { tierRestriction: "business" } }
    await expect(priceUgcCalls({ userId: USER }, [{ tool: "image_to_text", args: { custom_prompt: "q" } }])).rejects.toThrow("could not price")
    expect(h.profileReads).toBe(1)
  })
})
