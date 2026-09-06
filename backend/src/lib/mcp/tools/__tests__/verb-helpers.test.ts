import { describe, it, expect, vi } from "vitest"
import { idempotencyHeaders, clientRequestIdSchema, GET_JOB_POLL_HINT } from "../_verb-helpers.js"

vi.mock("../../asset-resolver.js", () => ({
  resolveAssetId: vi.fn(async ({ assetId }: { assetId: string }) => {
    if (assetId === "known-asset") return "https://cdn.nodaro.ai/images/known-asset.png"
    // Production resolveAssetId THROWS for an unresolvable/unowned/wrong-kind
    // id (it returns null only for null/empty input). Mirror that here so a
    // future "be lenient, return null" refactor can't silently reintroduce
    // ref-dropping — which would make image_to_image behave like text2img.
    throw new Error("forbidden")
  }),
}))

const { coerceStringArray, resolveRefArray } = await import("../_verb-helpers.js")

describe("coerceStringArray", () => {
  it("passes a clean array through, trimming and dropping empties", () => {
    expect(coerceStringArray(["  https://a.png ", "", "https://b.png"], 14)).toEqual([
      "https://a.png",
      "https://b.png",
    ])
  })

  it("parses a JSON-stringified array (the MCP client serialization slip)", () => {
    expect(coerceStringArray('["https://a.png","https://b.png"]', 14)).toEqual([
      "https://a.png",
      "https://b.png",
    ])
  })

  it("wraps a lone bare string into a single-element array", () => {
    expect(coerceStringArray("https://a.png", 14)).toEqual(["https://a.png"])
  })

  it("treats an unparseable bracket-string as a single opaque item", () => {
    expect(coerceStringArray("[not json", 14)).toEqual(["[not json"])
  })

  it("filters non-string entries and enforces the cap", () => {
    expect(coerceStringArray(["a", 42, null, "b", "c"], 2)).toEqual(["a", "b"])
  })

  it("returns [] for undefined, empty string, and non-string/array values", () => {
    expect(coerceStringArray(undefined, 14)).toEqual([])
    expect(coerceStringArray("   ", 14)).toEqual([])
    expect(coerceStringArray(42, 14)).toEqual([])
    expect(coerceStringArray({ a: 1 }, 14)).toEqual([])
  })
})

describe("resolveRefArray", () => {
  it("passes URLs through and resolves known asset ids", async () => {
    const out = await resolveRefArray(
      ["https://cdn.nodaro.ai/uploads/x.png", "known-asset"],
      "u1",
      "image",
      14,
    )
    expect(out).toEqual([
      "https://cdn.nodaro.ai/uploads/x.png",
      "https://cdn.nodaro.ai/images/known-asset.png",
    ])
  })

  it("loud-fails (rejects) on an unresolvable asset id — never silently drops a required ref", async () => {
    await expect(
      resolveRefArray(
        ["https://cdn.nodaro.ai/uploads/x.png", "missing-asset"],
        "u1",
        "image",
        14,
      ),
    ).rejects.toThrow()
  })

  it("accepts the JSON-stringified form end-to-end", async () => {
    const out = await resolveRefArray('["https://cdn.nodaro.ai/uploads/x.png"]', "u1", "image", 14)
    expect(out).toEqual(["https://cdn.nodaro.ai/uploads/x.png"])
  })
})

// Audit 2026-09-06 fix #1 (D-2 / A-15 / B-3, open since June): no MCP-triggered
// spend carried an idempotency key, so a client retry after a timeout ran —
// and charged — the work twice. The route side already dedups on the
// `idempotency-key` header (`(user_id, idempotency_key)` unique, migration
// 163; `MIN_IDEMPOTENCY_KEY_LENGTH` = 8). The MCP layer forwards a client's
// `client_request_id` under an `mcp:` namespace; no key → no header → the
// route's documented "two clicks, two rows" behaviour.
describe("idempotencyHeaders / clientRequestIdSchema", () => {
  it("forwards a client_request_id as the mcp-namespaced idempotency-key header", () => {
    expect(idempotencyHeaders("retry-7f3a9c")).toEqual({ "idempotency-key": "mcp:retry-7f3a9c" })
  })

  it("sends no header when the client gave no id", () => {
    expect(idempotencyHeaders(undefined)).toEqual({})
    expect(idempotencyHeaders("")).toEqual({})
  })

  it("accepts 8–128 chars of [A-Za-z0-9_.:-] and rejects anything shorter, longer or with other characters", () => {
    expect(clientRequestIdSchema.safeParse("retry-7f3a9c").success).toBe(true)
    expect(clientRequestIdSchema.safeParse("a".repeat(128)).success).toBe(true)
    expect(clientRequestIdSchema.safeParse("short").success).toBe(false)
    expect(clientRequestIdSchema.safeParse("a".repeat(129)).success).toBe(false)
    expect(clientRequestIdSchema.safeParse("has space here").success).toBe(false)
  })
})

// Audit 2026-09-06 fix #2 (A-9): "poll get_job with this id" named no cadence
// and no expected duration, and never mentioned the blocking wait.
describe("GET_JOB_POLL_HINT — one cadence sentence", () => {
  it("names the cadence, the expected durations and the blocking alternative", () => {
    expect(GET_JOB_POLL_HINT).toContain("poll get_job with this id")
    expect(GET_JOB_POLL_HINT).toContain("every 5")
    expect(GET_JOB_POLL_HINT).toContain("wait_for_job")
  })
})
