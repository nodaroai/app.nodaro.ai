import { describe, it, expect, vi, beforeEach } from "vitest"

const insert = vi.fn()
vi.mock("../supabase.js", () => ({
  supabase: { from: () => ({ insert: (row: unknown) => insert(row) }) },
}))

import { RAW_SAMPLE_MAX_CHARS, logCreditAudit, truncateRawSample } from "../credit-audit.js"

const big = () => ({
  code: 200,
  data: { items: Array.from({ length: 60 }, (_, i) => ({ id: i, note: "x".repeat(20), url: `https://example.com/${i}` })) },
})

describe("truncateRawSample", () => {
  it("returns a small sample untouched", () => {
    const small = { code: 200, data: { taskId: "abc" } }
    expect(truncateRawSample(small)).toBe(small)
  })

  it("turns an oversized sample into a small valid object that says it was cut", () => {
    const sample = big()
    const json = JSON.stringify(sample)
    expect(json.length).toBeGreaterThan(RAW_SAMPLE_MAX_CHARS)
    const out = truncateRawSample(sample) as { truncated: boolean; originalLength: number; head: string }
    expect(out.truncated).toBe(true)
    expect(out.originalLength).toBe(json.length)
    expect(out.head).toBe(json.substring(0, RAW_SAMPLE_MAX_CHARS))
    expect(() => JSON.parse(JSON.stringify(out))).not.toThrow()
  })
})

describe("logCreditAudit with an oversized sample", () => {
  beforeEach(() => {
    insert.mockReset()
    insert.mockResolvedValue({ error: null })
  })

  it("still writes the row, with the cut sample, and does not warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await logCreditAudit({ modelKey: "kling-3.0", expectedKieCredits: 10, actualKieCredits: 12, rawResponseSample: big() })
    expect(warn).not.toHaveBeenCalled()
    expect(insert).toHaveBeenCalledTimes(1)
    const row = insert.mock.calls[0][0] as { model_key: string; mismatch: boolean; raw_response_sample: { truncated: boolean } }
    expect(row.model_key).toBe("kling-3.0")
    expect(row.mismatch).toBe(true)
    expect(row.raw_response_sample.truncated).toBe(true)
    warn.mockRestore()
  })

  it("writes a small sample as it is", async () => {
    const sample = { code: 200 }
    await logCreditAudit({ modelKey: "m", rawResponseSample: sample })
    expect((insert.mock.calls[0][0] as { raw_response_sample: unknown }).raw_response_sample).toBe(sample)
  })
})
