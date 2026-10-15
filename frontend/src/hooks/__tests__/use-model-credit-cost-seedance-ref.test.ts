/**
 * A Seedance reference-video quote key rides the same price cache as every
 * model id, so the run estimate reads and prefetches it without knowing about
 * it: the prefetch sends a quote key to the quote endpoint (never to the batch
 * model-cost endpoint), the cache answers its `credits`, and a key the server
 * refuses (a clip the run would refuse) is not asked again.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const api = vi.hoisted(() => ({
  batches: [] as string[][],
  quotes: [] as unknown[],
  refuse: false,
}))
vi.mock("@/lib/api", () => ({
  fetchBatchModelCreditCosts: vi.fn(async (models: string[]) => {
    api.batches.push(models)
    return { data: Object.fromEntries(models.map((m) => [m, 7])), missing: [] }
  }),
  getModelCreditCost: vi.fn(),
  estimateSeedanceRefCredits: vi.fn(async (request: unknown) => {
    api.quotes.push(request)
    if (api.refuse) throw new Error("video_too_long")
    return { credits: 1911, min: 1911, exact: true }
  }),
}))
vi.mock("@/lib/edition", () => ({ hasCredits: () => true }))

import { queryClient } from "@/lib/query-client"
import { forgetUnpricedModels, getCachedModelCredits, isModelUnpriced, prefetchModelCreditCosts } from "../use-model-credit-cost"
import { seedanceRefQuoteKey } from "@/lib/seedance-ref-quote-key"

const REQUEST = { provider: "seedance-2-5", duration: 8, referenceVideoUrls: ["https://cdn.example/clip.mp4"] }
const KEY = seedanceRefQuoteKey(REQUEST)

beforeEach(() => {
  queryClient.clear()
  forgetUnpricedModels()
  api.batches = []
  api.quotes = []
  api.refuse = false
})

describe("price cache — Seedance reference-video quote keys", () => {
  it("prefetches a quote key through the quote endpoint and answers its credits", async () => {
    await prefetchModelCreditCosts(["seedance-2-5:8s:720p-ref", KEY])
    expect(api.batches).toEqual([["seedance-2-5:8s:720p-ref"]])
    expect(api.quotes).toEqual([{ ...REQUEST, resolution: undefined, draft: undefined, unknownReferenceVideos: undefined }])
    expect(getCachedModelCredits(KEY)).toBe(1911)
    expect(getCachedModelCredits("seedance-2-5:8s:720p-ref")).toBe(7)

    await prefetchModelCreditCosts([KEY])
    expect(api.quotes).toHaveLength(1)
  })

  it("remembers a refused quote and does not ask again", async () => {
    api.refuse = true
    await prefetchModelCreditCosts([KEY])
    expect(getCachedModelCredits(KEY)).toBeUndefined()
    expect(isModelUnpriced(KEY)).toBe(true)
    await prefetchModelCreditCosts([KEY])
    expect(api.quotes).toHaveLength(1)
  })
})
