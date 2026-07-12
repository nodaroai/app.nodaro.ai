/**
 * Task 8 unit coverage for the generate-video-pro toolkit members that carry
 * real logic (not just a direct re-export or a one-line positional wrap):
 * `jobs.clearReconcileSentinel`, `jobs.updateJobCheckpoint`,
 * `jobs.readJobCheckpoint`, `http.insertJobWithIdempotencyKey`.
 *
 * Mocking convention mirrors `toolkit.test.ts` in this same directory: mock
 * `@/lib/supabase.js` (the alias resolves to the SAME physical module both
 * `toolkit.ts`'s `../supabase.js` import and `lib/idempotent-insert.ts`'s
 * `./supabase.js` import resolve to, so one mock covers both call paths),
 * leave the rest of the module graph real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mockFrom } }))

import { buildToolkit } from "../toolkit.js"
import type { PluginToolkit } from "../types.js"

// ---------------------------------------------------------------------------
// Minimal chainable Supabase-postgrest-like builder stub. Every builder
// method returns the SAME chain object so arbitrary `.select().eq().single()`
// / `.update().eq()` / `.upsert().select()` sequences all resolve — `.single()`
// resolves explicitly, and the chain is ALSO directly thenable (via `.then`)
// so a chain ending without `.single()` (e.g. `.update().eq()`,
// `.upsert().select()`) still resolves correctly when awaited.
// ---------------------------------------------------------------------------
interface Terminal {
  data: unknown
  error: { message: string } | null
}

function makeChain(terminal: Terminal) {
  const chain = {
    select: vi.fn(() => chain),
    update: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    upsert: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve(terminal)),
    then: (onFulfilled: (v: Terminal) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(terminal).then(onFulfilled, onRejected),
  }
  return chain
}

describe("toolkit.ts — generate-video-pro members", () => {
  let tk: PluginToolkit

  beforeEach(() => {
    mockFrom.mockReset()
    tk = buildToolkit()
  })

  describe("jobs.clearReconcileSentinel", () => {
    it("issues exactly the two-field null update, scoped by job id", async () => {
      const chain = makeChain({ data: null, error: null })
      mockFrom.mockReturnValue(chain)

      await tk.jobs.clearReconcileSentinel("job-123")

      expect(mockFrom).toHaveBeenCalledWith("jobs")
      expect(chain.update).toHaveBeenCalledTimes(1)
      expect(chain.update).toHaveBeenCalledWith({
        provider_kind: null,
        provider_call_started_at: null,
      })
      expect(chain.eq).toHaveBeenCalledWith("id", "job-123")
    })
  })

  describe("jobs.updateJobCheckpoint", () => {
    it("shallow-merges the patch into existing output_data — patch keys win, others survive", async () => {
      const readChain = makeChain({ data: { output_data: { foo: "old", keep: 1 } }, error: null })
      const writeChain = makeChain({ data: null, error: null })
      mockFrom.mockReturnValueOnce(readChain).mockReturnValueOnce(writeChain)

      await tk.jobs.updateJobCheckpoint("job-1", { foo: "new", added: 2 })

      expect(writeChain.update).toHaveBeenCalledWith({
        output_data: { foo: "new", keep: 1, added: 2 },
      })
      expect(writeChain.eq).toHaveBeenCalledWith("id", "job-1")
    })

    it("treats a null existing output_data as an empty object (no crash, patch wins wholesale)", async () => {
      const readChain = makeChain({ data: { output_data: null }, error: null })
      const writeChain = makeChain({ data: null, error: null })
      mockFrom.mockReturnValueOnce(readChain).mockReturnValueOnce(writeChain)

      await tk.jobs.updateJobCheckpoint("job-2", { a: 1 })

      expect(writeChain.update).toHaveBeenCalledWith({ output_data: { a: 1 } })
    })
  })

  describe("jobs.readJobCheckpoint", () => {
    it("returns output_data when present", async () => {
      mockFrom.mockReturnValue(makeChain({ data: { output_data: { a: 1, b: "x" } }, error: null }))

      await expect(tk.jobs.readJobCheckpoint("job-1")).resolves.toEqual({ a: 1, b: "x" })
    })

    it("returns null when output_data is null", async () => {
      mockFrom.mockReturnValue(makeChain({ data: { output_data: null }, error: null }))

      await expect(tk.jobs.readJobCheckpoint("job-1")).resolves.toBeNull()
    })

    it("returns null when the row itself is missing", async () => {
      mockFrom.mockReturnValue(makeChain({ data: null, error: null }))

      await expect(tk.jobs.readJobCheckpoint("job-1")).resolves.toBeNull()
    })
  })

  describe("http.insertJobWithIdempotencyKey", () => {
    it("maps a fresh insert (no idempotency key) to {id, created: true}", async () => {
      mockFrom.mockReturnValue(makeChain({ data: { id: "row-1" }, error: null }))

      await expect(tk.http.insertJobWithIdempotencyKey({ user_id: "u1" }, null)).resolves.toEqual({
        id: "row-1",
        created: true,
      })
    })

    it("maps a fresh insert (idempotency key, no prior row) to {id, created: true}", async () => {
      // upsert().select() resolves to the newly-inserted row (non-empty array).
      mockFrom.mockReturnValue(makeChain({ data: [{ id: "row-2" }], error: null }))

      await expect(
        tk.http.insertJobWithIdempotencyKey({ user_id: "u1" }, "key-1"),
      ).resolves.toEqual({ id: "row-2", created: true })
    })

    it("maps a dedup hit (conflict on the idempotency key) to {id, created: false}", async () => {
      // upsert().select() resolves EMPTY (ignoreDuplicates conflict), then the
      // fallback select().eq().eq().single() resolves the winner's row.
      const upsertChain = makeChain({ data: [], error: null })
      const selectChain = makeChain({ data: { id: "winner" }, error: null })
      mockFrom.mockReturnValueOnce(upsertChain).mockReturnValueOnce(selectChain)

      await expect(
        tk.http.insertJobWithIdempotencyKey({ user_id: "u1" }, "key-1"),
      ).resolves.toEqual({ id: "winner", created: false })
    })
  })
})
