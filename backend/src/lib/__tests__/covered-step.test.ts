import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => {
  const state = { answer: { data: null as unknown, error: null as unknown }, answers: [] as Array<{ data: unknown; error: unknown }>, filters: [] as Array<[string, unknown]> }
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn((col: string, val: unknown) => {
    state.filters.push([col, val])
    return chain
  })
  chain.maybeSingle = vi.fn(async () => state.answers.shift() ?? state.answer)
  return { state, from: vi.fn(() => chain) }
})
vi.mock("../supabase.js", () => ({ supabase: { from: h.from } }))

const { coveredMarkOf, coveredByOf, wrapperCoverOf, CoverUnreadableError } = await import("../covered-step.js")

beforeEach(() => {
  h.state.answer = { data: null, error: null }
  h.state.answers = []
  h.state.filters.length = 0
})

describe("coveredMarkOf", () => {
  it("reads the pack and the step's own price", () => {
    expect(coveredMarkOf({ status: "reserved", covered: { by: "pack-1", credits: 40 } })).toEqual({ by: "pack-1", credits: 40 })
  })
  it("an ordinary hold, or a malformed mark, is no cover", () => {
    expect(coveredMarkOf({ status: "reserved" })).toBeNull()
    expect(coveredMarkOf(null)).toBeNull()
    expect(coveredMarkOf({ covered: { by: "" } })).toBeNull()
    expect(coveredMarkOf({ covered: "pack-1" })).toBeNull()
  })
  it("a mark without a readable price still covers (its price reads 0)", () => {
    expect(coveredMarkOf({ covered: { by: "pack-1" } })).toEqual({ by: "pack-1", credits: 0 })
  })
})

describe("coveredByOf", () => {
  it("reads the wrapper's pack", () => {
    expect(coveredByOf({ type: "clip-pack", _coveredBy: "pack-1" })).toBe("pack-1")
    expect(coveredByOf({ type: "clip-pack" })).toBeNull()
    expect(coveredByOf(undefined)).toBeNull()
  })
})

describe("wrapperCoverOf", () => {
  const wrapper = (by?: string) => ({ data: { input_data: by ? { _coveredBy: by } : { type: "clip-pack" } }, error: null })
  const pack = (status: string, provider = "podcast-pack") => ({ data: { provider, status }, error: null })

  it("covered while its pack stands, both read owner-scoped", async () => {
    for (const status of ["processing", "completed"]) {
      h.state.answers = [wrapper("pack-1"), pack(status)]
      h.state.filters.length = 0
      expect(await wrapperCoverOf("wrap-1", "user-1")).toEqual({ kind: "covered", packId: "pack-1" })
      expect(h.state.filters).toEqual([["id", "wrap-1"], ["user_id", "user-1"], ["id", "pack-1"], ["user_id", "user-1"]])
    }
  })
  it("a pack that failed, or is not a pack, voids the run", async () => {
    for (const row of [pack("failed"), pack("cancelled"), pack("completed", "use-case"), { data: null, error: null }]) {
      h.state.answers = [wrapper("pack-1"), row]
      expect(await wrapperCoverOf("wrap-1", "user-1")).toEqual({ kind: "void", packId: "pack-1", reason: "did_not_go_ahead" })
    }
  })
  it("a pack held for review stops its runs (suspected abuse: everything stops)", async () => {
    h.state.answers = [wrapper("pack-1"), pack("pending_review")]
    expect(await wrapperCoverOf("wrap-1", "user-1")).toEqual({ kind: "void", packId: "pack-1", reason: "held" })
  })
  it("a run no pack covers, or a missing wrapper, is not covered", async () => {
    h.state.answers = [wrapper()]
    expect(await wrapperCoverOf("wrap-1", "user-1")).toEqual({ kind: "none" })
    h.state.answers = [{ data: null, error: null }]
    expect(await wrapperCoverOf("wrap-1", "user-1")).toEqual({ kind: "none" })
  })
  it("a failed read throws: never read as not covered", async () => {
    h.state.answers = [{ data: null, error: { message: "boom" } }]
    await expect(wrapperCoverOf("wrap-1", "user-1")).rejects.toBeInstanceOf(CoverUnreadableError)
    h.state.answers = [wrapper("pack-1"), { data: null, error: { message: "boom" } }]
    await expect(wrapperCoverOf("wrap-1", "user-1")).rejects.toBeInstanceOf(CoverUnreadableError)
  })
})
