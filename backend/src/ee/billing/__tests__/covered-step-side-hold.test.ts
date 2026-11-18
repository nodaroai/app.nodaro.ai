// @test-units-by-name names no node type: it reserves LLM side holds for a job id
/**
 * A side hold on a covered job (lib/covered-step.ts) is refused before
 * anything is priced or reserved: its podcast pack paid for the job, and a
 * side hold would charge it again. A job whose hold cannot be read is refused
 * too; an ordinary job goes on to its credit check as before.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const JOB = "11111111-1111-4111-8111-111111111111"
const USER = "44444444-4444-4444-8444-444444444444"
const LOG = "22222222-2222-4222-8222-222222222222"

const h = vi.hoisted(() => {
  const rows = new Map<string, { data: unknown; error: unknown }>()
  const chain = (table: string) => {
    const obj: Record<string, unknown> = {}
    for (const m of ["select", "eq", "is", "in", "order", "limit"]) obj[m] = vi.fn(() => obj)
    const answer = () => Promise.resolve(rows.get(table) ?? { data: null, error: null })
    obj.single = vi.fn(answer)
    obj.maybeSingle = vi.fn(answer)
    obj.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => answer().then(resolve, reject)
    return obj
  }
  return { rows, from: vi.fn((table: string) => chain(table)), rpc: vi.fn() }
})

vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: h.from, rpc: h.rpc } }))

const reserveCredits = vi.fn()
const checkCredits = vi.fn()
vi.mock("../credits.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../credits.js")>()
  return {
    ...actual,
    CreditsService: { ...actual.CreditsService, reserveCredits: (...a: unknown[]) => reserveCredits(...a), checkCredits: (...a: unknown[]) => checkCredits(...a) },
  }
})

const { reserveLlmSideHoldImpl } = await import("../llm-side-hold-impl.js")

const args = {
  jobId: JOB,
  userId: USER,
  key: "reading-1",
  feature: "generate-script",
  calls: [{ modelId: "gemini-3.8-flash", inputTokens: 1000, outputTokens: 1000 }],
} as unknown as Parameters<typeof reserveLlmSideHoldImpl>[0]

beforeEach(() => {
  vi.clearAllMocks()
  h.rows.clear()
  h.rows.set("jobs", { data: { usage_log_id: LOG }, error: null })
})

describe("a side hold on a covered job", () => {
  it("is refused, and nothing is checked or reserved", async () => {
    h.rows.set("usage_logs", { data: { metadata: { covered: { by: "pack-1", credits: 40 } } }, error: null })
    const result = await reserveLlmSideHoldImpl(args)
    expect(result).toMatchObject({ ok: false, code: "conflict" })
    expect(checkCredits).not.toHaveBeenCalled()
    expect(reserveCredits).not.toHaveBeenCalled()
  })

  it("is refused when the job's hold cannot be read", async () => {
    h.rows.set("usage_logs", { data: null, error: { message: "boom" } })
    expect(await reserveLlmSideHoldImpl(args)).toMatchObject({ ok: false, code: "reservation_failed" })
    expect(reserveCredits).not.toHaveBeenCalled()
  })

  it("an ordinary job goes on past the cover check (to pricing its calls)", async () => {
    h.rows.set("usage_logs", { data: { metadata: { status: "reserved" } }, error: null })
    const result = await reserveLlmSideHoldImpl(args)
    // The planned calls here carry no request, so pricing them refuses — after the cover check let it by.
    expect(result).toMatchObject({ ok: false, code: "invalid_request" })
    expect(h.from).toHaveBeenCalledWith("usage_logs")
  })
})
