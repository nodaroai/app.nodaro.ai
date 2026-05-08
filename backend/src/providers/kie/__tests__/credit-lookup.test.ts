/**
 * KIE credit-lookup tests.
 *
 * credit-lookup.ts powers the batch pricing audit — it queries KIE's
 * undocumented dashboard endpoints to learn the actual credits consumed per
 * task, so we can detect mismatches with our hardcoded `STATIC_CREDIT_COSTS`.
 *
 * The interesting logic is `normalizeRecord` — it has to fold 20+ KIE
 * response shapes into one canonical `KieLogRecord`. Each model-specific
 * endpoint uses different field names: taskId/uuid/task_id/id,
 * consumeCredits/creditsConsumed/credits, state/successFlag/status, etc.
 * One missed alias = silent zero in the audit, hiding real KIE charges.
 *
 * `fetchKieLogs` and `fetchAllKieLogs` are tested via mocked global.fetch
 * — covering 401 expiry, HTTP errors, multiple response shapes, pagination,
 * deduplication, and per-endpoint error collection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/config.js", () => ({
  config: {
    KIE_UNIQUE_ID: "test-unique-id",
    EDITION: "cloud",
  },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

import {
  normalizeRecord,
  fetchKieLogs,
  fetchAllKieLogs,
} from "../credit-lookup.js"

// ===========================================================================
// 1) normalizeRecord — field aliasing & state derivation
// ===========================================================================

describe("normalizeRecord — taskId aliases", () => {
  it("prefers taskId", () => {
    const r = normalizeRecord({ taskId: "abc" }, "src")
    expect(r.taskId).toBe("abc")
  })

  it("falls through to uuid", () => {
    const r = normalizeRecord({ uuid: "u1" }, "src")
    expect(r.taskId).toBe("u1")
  })

  it("falls through to task_id (snake_case)", () => {
    const r = normalizeRecord({ task_id: "tk" }, "src")
    expect(r.taskId).toBe("tk")
  })

  it("falls through to numeric id (toString)", () => {
    const r = normalizeRecord({ id: 12345 }, "src")
    expect(r.taskId).toBe("12345")
  })

  it("returns empty string when no id present", () => {
    const r = normalizeRecord({}, "src")
    expect(r.taskId).toBe("")
  })

  it("taskId takes precedence over uuid", () => {
    const r = normalizeRecord({ taskId: "primary", uuid: "secondary" }, "src")
    expect(r.taskId).toBe("primary")
  })
})

describe("normalizeRecord — consumeCredits aliases", () => {
  it("prefers consumeCredits", () => {
    expect(normalizeRecord({ consumeCredits: 10 }, "x").consumeCredits).toBe(10)
  })

  it("falls through to creditsConsumed", () => {
    expect(normalizeRecord({ creditsConsumed: 5 }, "x").consumeCredits).toBe(5)
  })

  it("falls through to credits_consumed", () => {
    expect(normalizeRecord({ credits_consumed: 3 }, "x").consumeCredits).toBe(3)
  })

  it("falls through to credits", () => {
    expect(normalizeRecord({ credits: 7 }, "x").consumeCredits).toBe(7)
  })

  it("defaults to 0 when missing", () => {
    expect(normalizeRecord({}, "x").consumeCredits).toBe(0)
  })

  it("respects 0 as a real value (not falsy fallback)", () => {
    // ?? coalesces only on null/undefined, so 0 is preserved.
    expect(normalizeRecord({ consumeCredits: 0, credits: 99 }, "x").consumeCredits).toBe(0)
  })
})

describe("normalizeRecord — model fallback chain", () => {
  it("uses model when present", () => {
    expect(normalizeRecord({ model: "veo3" }, "src").model).toBe("veo3")
  })

  it("falls through to type", () => {
    expect(normalizeRecord({ type: "kling" }, "src").model).toBe("kling")
  })

  it("falls through to modelName", () => {
    expect(normalizeRecord({ modelName: "flux" }, "src").model).toBe("flux")
  })

  it("falls through to model_name (snake_case)", () => {
    expect(normalizeRecord({ model_name: "imagen4" }, "src").model).toBe("imagen4")
  })

  it("falls through to operationType", () => {
    expect(normalizeRecord({ operationType: "extend" }, "src").model).toBe("extend")
  })

  it("uses sourceLabel as final fallback", () => {
    expect(normalizeRecord({}, "suno-cover").model).toBe("suno-cover")
  })

  it("priority: model > type", () => {
    expect(normalizeRecord({ model: "a", type: "b" }, "src").model).toBe("a")
  })
})

describe("normalizeRecord — state derivation", () => {
  it("uses explicit state field", () => {
    expect(normalizeRecord({ state: "success" }, "x").state).toBe("success")
  })

  it("derives success from successFlag === 200", () => {
    expect(normalizeRecord({ successFlag: 200 }, "x").state).toBe("success")
  })

  it("derives success from successFlag === 1", () => {
    expect(normalizeRecord({ successFlag: 1 }, "x").state).toBe("success")
  })

  it("derives fail from successFlag === 2 (VEO 'failed')", () => {
    expect(normalizeRecord({ successFlag: 2 }, "x").state).toBe("fail")
  })

  it("derives fail from successFlag === 3 (VEO 'generation failed')", () => {
    expect(normalizeRecord({ successFlag: 3 }, "x").state).toBe("fail")
  })

  it("derives fail from successFlag === 0 (VEO 'generating')", () => {
    // Treated as fail per implementation — the audit needs a binary outcome.
    expect(normalizeRecord({ successFlag: 0 }, "x").state).toBe("fail")
  })

  it("handles successFlag as string (e.g., '1')", () => {
    expect(normalizeRecord({ successFlag: "1" }, "x").state).toBe("success")
  })

  it("handles successFlag as string '200'", () => {
    expect(normalizeRecord({ successFlag: "200" }, "x").state).toBe("success")
  })

  it("derives success from status: 'success'", () => {
    expect(normalizeRecord({ status: "success" }, "x").state).toBe("success")
  })

  it("derives success from status: 'completed'", () => {
    expect(normalizeRecord({ status: "completed" }, "x").state).toBe("success")
  })

  it("derives success from status: 'done'", () => {
    expect(normalizeRecord({ status: "done" }, "x").state).toBe("success")
  })

  it("derives success from status: '1'", () => {
    expect(normalizeRecord({ status: "1" }, "x").state).toBe("success")
  })

  it("derives success from uppercase status: 'SUCCESS'", () => {
    expect(normalizeRecord({ status: "SUCCESS" }, "x").state).toBe("success")
  })

  it("derives fail from unknown status", () => {
    expect(normalizeRecord({ status: "pending" }, "x").state).toBe("fail")
  })

  it("explicit state takes precedence over successFlag", () => {
    expect(
      normalizeRecord({ state: "queuing", successFlag: 1 }, "x").state,
    ).toBe("queuing")
  })

  it("successFlag takes precedence over status", () => {
    // Per impl: state derivation tries successFlag before status, both are
    // fallbacks for missing `state`.
    expect(
      normalizeRecord({ successFlag: 1, status: "fail" }, "x").state,
    ).toBe("success")
  })

  it("returns empty string when none of state/successFlag/status set", () => {
    expect(normalizeRecord({}, "x").state).toBe("")
  })
})

describe("normalizeRecord — param + timestamp aliases", () => {
  it("prefers param", () => {
    expect(normalizeRecord({ param: "p1" }, "x").param).toBe("p1")
  })

  it("falls through to paramJson", () => {
    expect(normalizeRecord({ paramJson: "{}" }, "x").param).toBe("{}")
  })

  it("falls through to params", () => {
    expect(normalizeRecord({ params: "x=1" }, "x").param).toBe("x=1")
  })

  it("returns undefined when missing", () => {
    expect(normalizeRecord({}, "x").param).toBeUndefined()
  })

  it("uses createTime camelCase", () => {
    expect(normalizeRecord({ createTime: 12345 }, "x").createTime).toBe(12345)
  })

  it("falls through to create_time snake_case", () => {
    expect(normalizeRecord({ create_time: 67890 }, "x").createTime).toBe(67890)
  })

  it("defaults timestamps to 0", () => {
    const r = normalizeRecord({}, "x")
    expect(r.createTime).toBe(0)
    expect(r.completeTime).toBe(0)
    expect(r.costTime).toBe(0)
  })
})

describe("normalizeRecord — _source tagging", () => {
  it("attaches sourceLabel as _source", () => {
    expect(normalizeRecord({}, "suno-cover")._source).toBe("suno-cover")
  })
})

// ===========================================================================
// 2) fetchKieLogs — public single-endpoint wrapper
// ===========================================================================

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

describe("fetchKieLogs", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns normalized records from a successful single-page response", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        code: 200,
        data: {
          records: [
            { taskId: "t1", consumeCredits: 5, model: "veo3", state: "success" },
            { taskId: "t2", consumeCredits: 3, model: "kling", state: "fail" },
          ],
          pages: 1,
        },
      }),
    )

    const records = await fetchKieLogs("session-token", 1000, 2000)

    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({ taskId: "t1", consumeCredits: 5, model: "veo3" })
    expect(records[1]).toMatchObject({ taskId: "t2", consumeCredits: 3, model: "kling" })
  })

  it("paginates across multiple pages until totalPages reached", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        code: 200,
        data: { records: [{ taskId: "p1" }], pages: 2 },
      }))
      .mockResolvedValueOnce(jsonResponse({
        code: 200,
        data: { records: [{ taskId: "p2" }], pages: 2 },
      }))

    const records = await fetchKieLogs("token", 0, 100)

    expect(records.map((r) => r.taskId)).toEqual(["p1", "p2"])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("stops paginating when records array is empty", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        code: 200,
        data: { records: [{ taskId: "first" }], pages: 100 },
      }))
      .mockResolvedValueOnce(jsonResponse({
        code: 200,
        data: { records: [], pages: 100 },
      }))

    const records = await fetchKieLogs("token", 0, 100)

    expect(records.map((r) => r.taskId)).toEqual(["first"])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("throws on 401 when no records collected (session expired)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 401))

    await expect(fetchKieLogs("expired-token", 0, 100)).rejects.toThrow(
      /401.*session token expired/,
    )
  })

  it("throws on code: 401 in response body (session expired)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 401 }))

    await expect(fetchKieLogs("expired-token", 0, 100)).rejects.toThrow(
      /code 401.*session token expired/,
    )
  })

  it("throws on non-200 HTTP error when no records collected", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 500))

    await expect(fetchKieLogs("token", 0, 100)).rejects.toThrow(/HTTP 500/)
  })

  it("throws on unexpected response code on page 1", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 999, data: {} }))

    await expect(fetchKieLogs("token", 0, 100)).rejects.toThrow(/Unexpected code: 999/)
  })

  it("accepts code: 0 as success (some model-specific endpoints)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      code: 0,
      data: { records: [{ taskId: "ok" }], pages: 1 },
    }))

    const records = await fetchKieLogs("token", 0, 100)
    expect(records).toHaveLength(1)
  })

  it("accepts success: true shape", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      success: true,
      data: { list: [{ taskId: "alt" }], total: 1 },
    }))

    const records = await fetchKieLogs("token", 0, 100)
    expect(records).toHaveLength(1)
    expect(records[0].taskId).toBe("alt")
  })

  it("does not throw when KIE_UNIQUE_ID is configured (smoke test)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      code: 200,
      data: { records: [], pages: 0 },
    }))

    await expect(fetchKieLogs("token", 0, 100)).resolves.toBeDefined()
  })
})

// ===========================================================================
// 3) fetchAllKieLogs — multi-endpoint fan-out + dedupe
// ===========================================================================

describe("fetchAllKieLogs", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("fans out to all 21 endpoints (1 generic + 20 model-specific)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      code: 200,
      data: { records: [], pages: 0 },
    }))

    await fetchAllKieLogs("token", 0, 100)

    // 21 fetches, one per endpoint, all on page 1 (since records are empty).
    // The 20 model-specific endpoints in USER_RECORD_ENDPOINTS span image
    // (gpt-4o, flux-kontext, midjourney), video (4 VEO variants, aleph,
    // modify, runway), and 11 Suno variants — plus the 1 generic.
    expect(fetchMock).toHaveBeenCalledTimes(21)
  })

  it("deduplicates records by taskId across endpoints", async () => {
    // The same task may appear in both the generic feed and a model-specific
    // feed (e.g., Suno records). Dedupe ensures we count it once.
    fetchMock.mockImplementation(async (url: unknown) => {
      const u = String(url)
      if (u.includes("playground")) {
        return jsonResponse({
          code: 200,
          data: { records: [{ taskId: "shared", consumeCredits: 5 }], pages: 1 },
        })
      }
      if (u.includes("suno-record")) {
        return jsonResponse({
          code: 200,
          data: { records: [{ taskId: "shared", consumeCredits: 5 }, { uuid: "suno-only" }], pages: 1 },
        })
      }
      return jsonResponse({ code: 200, data: { records: [], pages: 0 } })
    })

    const result = await fetchAllKieLogs("token", 0, 100)

    const taskIds = result.records.map((r) => r.taskId)
    expect(taskIds).toContain("shared")
    expect(taskIds).toContain("suno-only")
    // "shared" should appear exactly once even though it's in both feeds
    expect(taskIds.filter((t) => t === "shared")).toHaveLength(1)
  })

  it("counts records per source label", async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      const u = String(url)
      if (u.includes("playground")) {
        return jsonResponse({
          code: 200,
          data: { records: [{ taskId: "g1" }, { taskId: "g2" }], pages: 1 },
        })
      }
      if (u.includes("suno-record")) {
        return jsonResponse({
          code: 200,
          data: { records: [{ taskId: "s1" }], pages: 1 },
        })
      }
      return jsonResponse({ code: 200, data: { records: [], pages: 0 } })
    })

    const result = await fetchAllKieLogs("token", 0, 100)

    expect(result.sources.generic).toBe(2)
    expect(result.sources["suno-audio"]).toBe(1)
  })

  it("collects per-endpoint errors without failing the whole call", async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      const u = String(url)
      if (u.includes("playground")) {
        return jsonResponse({}, 401) // session expired on generic
      }
      if (u.includes("aleph")) {
        return jsonResponse({}, 500) // 500 on aleph
      }
      return jsonResponse({ code: 200, data: { records: [], pages: 0 } })
    })

    const result = await fetchAllKieLogs("token", 0, 100)

    expect(result.errors.generic).toMatch(/401/)
    expect(result.errors["runway-aleph"]).toMatch(/HTTP 500/)
    // Other endpoints succeeded — the call doesn't throw.
    expect(result.records).toBeDefined()
  })

  it("tolerates Promise rejection (fetch throws synchronously)", async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      const u = String(url)
      if (u.includes("playground")) {
        throw new Error("network down")
      }
      return jsonResponse({ code: 200, data: { records: [], pages: 0 } })
    })

    const result = await fetchAllKieLogs("token", 0, 100)

    expect(result.errors.generic).toMatch(/network down/)
    // Non-rejected endpoints still aggregate.
    expect(result.records).toEqual([])
  })

  it("captures rawSamples on first page for debugging", async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      const u = String(url)
      if (u.includes("playground")) {
        return jsonResponse({
          code: 200,
          data: { records: [{ taskId: "g1" }, { taskId: "g2" }], pages: 1 },
        })
      }
      return jsonResponse({ code: 200, data: { records: [], pages: 0 } })
    })

    const result = await fetchAllKieLogs("token", 0, 100)

    expect(result.rawSamples.generic).toBeDefined()
    // Records should be truncated to first item with _recordsTruncated marker
    const sample = result.rawSamples.generic as { data: { records: unknown[]; _recordsTruncated?: boolean } }
    expect(sample.data.records).toHaveLength(1)
    expect(sample.data._recordsTruncated).toBe(true)
  })

  it("attaches _source label to each record", async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      const u = String(url)
      if (u.includes("playground")) {
        return jsonResponse({
          code: 200,
          data: { records: [{ taskId: "g1" }], pages: 1 },
        })
      }
      if (u.includes("suno-record")) {
        return jsonResponse({
          code: 200,
          data: { records: [{ taskId: "s1" }], pages: 1 },
        })
      }
      return jsonResponse({ code: 200, data: { records: [], pages: 0 } })
    })

    const result = await fetchAllKieLogs("token", 0, 100)

    const generic = result.records.find((r) => r.taskId === "g1")
    const suno = result.records.find((r) => r.taskId === "s1")
    expect(generic?._source).toBe("generic")
    expect(suno?._source).toBe("suno-audio")
  })

  it("passes extraBody fields per endpoint (e.g. veo-generate sends model:'generate')", async () => {
    const calls: Record<string, unknown> = {}
    fetchMock.mockImplementation(async (url: unknown, init: unknown) => {
      const u = String(url)
      if (u.includes("veo-record/page")) {
        const body = JSON.parse((init as { body: string }).body) as Record<string, unknown>
        calls.veoRecord = body
      }
      if (u.includes("veo1080p/page")) {
        const body = JSON.parse((init as { body: string }).body) as Record<string, unknown>
        calls.veo1080p = body
      }
      return jsonResponse({ code: 200, data: { records: [], pages: 0 } })
    })

    await fetchAllKieLogs("token", 1000, 2000)

    expect(calls.veoRecord).toMatchObject({ model: "generate", beginTime: 1000, endTime: 2000 })
    expect(calls.veo1080p).toMatchObject({ model: "video1080p", beginTime: 1000, endTime: 2000 })
  })

  it("sends auth + uniqueid headers on every request", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ code: 200, data: { records: [], pages: 0 } }),
    )

    await fetchAllKieLogs("my-session-token", 0, 100)

    for (const call of fetchMock.mock.calls) {
      const init = call[1] as { headers: Record<string, string> }
      expect(init.headers["authorization"]).toBe("my-session-token")
      expect(init.headers["uniqueid"]).toBe("test-unique-id")
      expect(init.headers["Content-Type"]).toBe("application/json")
    }
  })
})

// ===========================================================================
// 4) KIE_UNIQUE_ID guard
// ===========================================================================

describe("KIE_UNIQUE_ID guard", () => {
  it("fetchKieLogs throws when KIE_UNIQUE_ID is unset", async () => {
    vi.resetModules()
    vi.doMock("@/lib/config.js", () => ({
      config: { KIE_UNIQUE_ID: undefined, EDITION: "cloud" },
      hasCredits: () => true,
      isCloud: () => true,
      isCommunity: () => false,
      isBusiness: () => false,
      hasAdmin: () => true,
    }))

    const mod = await import("../credit-lookup.js")
    await expect(mod.fetchKieLogs("token", 0, 100)).rejects.toThrow(
      /KIE_UNIQUE_ID env var not configured/,
    )
    vi.doUnmock("@/lib/config.js")
  })

  it("fetchAllKieLogs throws when KIE_UNIQUE_ID is unset", async () => {
    vi.resetModules()
    vi.doMock("@/lib/config.js", () => ({
      config: { KIE_UNIQUE_ID: "", EDITION: "cloud" },
      hasCredits: () => true,
      isCloud: () => true,
      isCommunity: () => false,
      isBusiness: () => false,
      hasAdmin: () => true,
    }))

    const mod = await import("../credit-lookup.js")
    await expect(mod.fetchAllKieLogs("token", 0, 100)).rejects.toThrow(
      /KIE_UNIQUE_ID env var not configured/,
    )
    vi.doUnmock("@/lib/config.js")
  })
})
