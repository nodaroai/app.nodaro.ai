/**
 * The Seedance 2.5 HD keys are priced by their own endpoint,
 * `POST /v1/credits/seedance-hd-estimate`, never by the model-cost batch
 * (which would answer them `missing`), and the run estimate reads the answer
 * from the same cache:
 *
 * - `seedance-hd-quote:` — the finalize of a draft not made yet, sent as
 *   `plannedDraft`;
 * - `seedance-hd-draft:` — the exact finalize of a draft that exists, by its
 *   task id: the very query the Seedance 2.5 HD node's pill reads.
 *
 * A failure is remembered (not asked again this session) only when it is the
 * server's lasting answer for that key — a coded refusal — never a rate limit,
 * a sign-in or a network failure, which would otherwise pin the finalize to the
 * provider's bare row until reload (decided 2026-11-12).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const api = vi.hoisted(() => ({
  batch: [] as string[][],
  hd: [] as Array<Record<string, unknown>>,
  credits: 4324,
  /** The code the next HD estimate is refused with (`null`: a failure with no code, a network error). */
  refuse: undefined as string | null | undefined,
}))
vi.mock("@/lib/api", () => ({
  fetchBatchModelCreditCosts: vi.fn(async (models: string[]) => {
    api.batch.push(models)
    return { data: Object.fromEntries(models.map((m) => [m, 7])), missing: [] }
  }),
  getModelCreditCost: vi.fn(),
  estimateSeedanceRefCredits: vi.fn(),
  estimateSeedanceHdCredits: vi.fn(async (body: Record<string, unknown>) => {
    api.hd.push(body)
    if (api.refuse !== undefined) throw Object.assign(new Error("refused"), api.refuse === null ? {} : { code: api.refuse })
    return { credits: api.credits, minimum: false }
  }),
}))
vi.mock("@/lib/edition", () => ({ hasCredits: () => true }))

import { queryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { forgetUnpricedModels, getCachedModelCredits, isModelUnpriced, prefetchModelCreditCosts } from "../use-model-credit-cost"
import { seedanceHdDraftKey, seedanceHdQuoteKey } from "@/lib/seedance-hd-quote-key"

const PLANNED = { provider: "seedance-2-5", resolution: "480p", duration: 5, draft: true, referenceTaskType: "edit" as const, referenceVideoUrls: ["https://cdn.example/ref.mp4"] }
const KEY = seedanceHdQuoteKey(PLANNED)
const DRAFT_KEY = seedanceHdDraftKey("task-draft")

beforeEach(() => {
  queryClient.clear()
  forgetUnpricedModels()
  api.batch = []
  api.hd = []
  api.refuse = undefined
})

describe("a finalize of a draft not made yet", () => {
  it("asks the HD estimate with the planned draft, never the batch, and caches the answer for the run estimate", async () => {
    await prefetchModelCreditCosts([KEY, "seedance-2-5-hd:30s"])
    expect(api.hd).toEqual([{ plannedDraft: PLANNED }])
    expect(api.batch).toEqual([["seedance-2-5-hd:30s"]])
    expect(getCachedModelCredits(KEY)).toBe(4324)
    expect(getCachedModelCredits("seedance-2-5-hd:30s")).toBe(7)
    // Cached: not asked again.
    await prefetchModelCreditCosts([KEY])
    expect(api.hd).toHaveLength(1)
  })

  it("a clip the draft's run would refuse (video_too_long) is the lasting answer: not asked again, no figure", async () => {
    api.refuse = "video_too_long"
    await prefetchModelCreditCosts([KEY])
    expect(getCachedModelCredits(KEY)).toBeUndefined()
    expect(isModelUnpriced(KEY)).toBe(true)
    await prefetchModelCreditCosts([KEY])
    expect(api.hd).toHaveLength(1)
  })

  // Was: any failure remembered for the session, so a rate limit or a network
  // blip left the finalize on the bare 8 s row until reload.
  it.each<[string, string | null]>([
    ["a rate limit", "rate_limit_exceeded"],
    ["a sign-in failure", "unauthorized"],
    ["a network failure (no code)", null],
  ])("%s is not remembered: the next estimate asks again", async (_name, code) => {
    api.refuse = code
    await prefetchModelCreditCosts([KEY])
    expect(isModelUnpriced(KEY)).toBe(false)
    api.refuse = undefined
    await prefetchModelCreditCosts([KEY])
    expect(api.hd).toHaveLength(2)
    expect(getCachedModelCredits(KEY)).toBe(4324)
  })
})

describe("a finalize of a draft that exists", () => {
  it("asks the HD estimate for the draft's task, never the batch, into the query the node's pill reads", async () => {
    await prefetchModelCreditCosts([DRAFT_KEY])
    expect(api.hd).toEqual([{ taskId: "task-draft" }])
    expect(api.batch).toEqual([])
    expect(getCachedModelCredits(DRAFT_KEY)).toBe(4324)
    expect(queryClient.getQueryData(queryKeys.credits.seedanceHdDraft("task-draft"))).toEqual({ credits: 4324, minimum: false })
  })

  it("reads a price the pill already fetched without asking again", async () => {
    queryClient.setQueryData(queryKeys.credits.seedanceHdDraft("task-draft"), { credits: 5214, minimum: false })
    expect(getCachedModelCredits(DRAFT_KEY)).toBe(5214)
    await prefetchModelCreditCosts([DRAFT_KEY])
    expect(api.hd).toEqual([])
  })

  it.each([
    ["not a draft", "not_a_draft", true],
    ["another user's", "forbidden", true],
    ["still rendering", "draft_not_ready", false],
    ["a rate limit", "rate_limit_exceeded", false],
  ])("a draft the gate refuses as %s: remembered only when the answer lasts", async (_name, code, lasting) => {
    api.refuse = code
    await prefetchModelCreditCosts([DRAFT_KEY])
    expect(getCachedModelCredits(DRAFT_KEY)).toBeUndefined()
    expect(isModelUnpriced(DRAFT_KEY)).toBe(lasting)
  })
})
