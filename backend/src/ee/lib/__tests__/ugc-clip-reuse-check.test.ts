/**
 * The server's check of the clips a run of UGC Clip expects back (`verifiedReusedClips`): a clip is
 * free only when it is the caller's own finished UGC Clip job of exactly that ticket at the Re-render
 * count the run sends, and the clip route would stop at it. The jobs table is an in-memory stand-in
 * that applies the query's own filters, so a read that forgets `user_id` reads another user's rows.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

type Row = { id: string; user_id: string; status: string; idempotency_key: string | null; input_data: Record<string, unknown> }
const h = vi.hoisted(() => ({ rows: [] as Row[], error: null as { message: string } | null, filters: [] as string[][] }))

vi.mock("../../../lib/supabase.js", () => {
  const query = () => {
    const eqs: Array<[string, unknown]> = []
    const ins: Array<[string, unknown[]]> = []
    const filters: string[] = []
    const run = () => {
      h.filters.push(filters)
      if (h.error) return { data: null, error: h.error }
      const data = h.rows
        .filter((r) => eqs.every(([c, v]) => (r as unknown as Record<string, unknown>)[c] === v))
        .filter((r) => ins.every(([c, vs]) => vs.includes((r as unknown as Record<string, unknown>)[c])))
        .map((r) => ({ id: r.id, status: r.status, idempotency_key: r.idempotency_key, type: (r.input_data.type as string) ?? null }))
      return { data, error: null }
    }
    const chain = {
      select: () => chain,
      eq: (c: string, v: unknown) => (eqs.push([c, v]), filters.push(`eq:${c}`), chain),
      in: (c: string, vs: unknown[]) => (ins.push([c, vs]), filters.push(`in:${c}`), chain),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
    }
    return chain
  }
  return { supabase: { from: (table: string) => (table === "jobs" ? query() : (() => { throw new Error(`unexpected table ${table}`) })()) } }
})

import { ugcClipContentKey, verifiedReusedClips } from "../ugc-clip-reuse-check.js"

/** A ticket as the clip route admits it. */
const TICKET = {
  v: 1, index: 1, clipCount: 3, lane: "prompt-quoted", language: "en", gender: "woman", durationSec: 8, startSec: 7.5,
  spokenText: "This is the line.", creatorImage: "https://cdn.example.com/creator.png",
  video: { tool: "generate_video", args: { model: "seedance-2", duration: 8, aspect_ratio: "9:16", resolution: "720p", prompt: "A creator says the line.", reference_image_urls: ["https://cdn.example.com/creator.png"] } },
  videoFallback: null, speech: null,
  frameCheck: { times: [1, 6], screen: "none", heldProduct: false },
}
const OTHER = { ...TICKET, index: 0, spokenText: "Another line." }
const TICKETS = [OTHER, TICKET]
const JOB = "00000000-0000-4000-8000-0000000000aa"
const keyOf = (nonce: number) => ugcClipContentKey(TICKET, nonce)
const clipJob = (over: Partial<Row> = {}): Row => ({
  id: JOB, user_id: "u1", status: "completed", idempotency_key: `${keyOf(0)}:0`, input_data: { type: "ugc-clip", clip: 2 }, ...over,
})
const claim = (over: Partial<{ clip: number; jobId: string; nonce: number }> = {}) => [{ clip: 2, jobId: JOB, nonce: 0, ...over }]

beforeEach(() => {
  h.rows = []
  h.error = null
  h.filters = []
})

describe("the clip route's content key, as the app computes it", () => {
  // Expected values computed with the clip route's own function (the plugin's clip-ticket.ts), for this ticket.
  it("matches the route's key: the ticket without startSec and clipCount, the nonce and the run key", () => {
    expect(ugcClipContentKey(TICKET, 0)).toBe("ugc-clip:f6c0e0d07946138aa48fe198aa3d66dc31cd119658dcd8b994715a74c16eaa18")
    expect(ugcClipContentKey(TICKET, 2)).toBe("ugc-clip:7a327541be84a203e866debf81839bd0c8f6673096652956f26beebc0c9ee733")
    expect(ugcClipContentKey({ ...TICKET, startSec: 99, clipCount: 9 }, 0)).toBe(ugcClipContentKey(TICKET, 0))
    expect(ugcClipContentKey(TICKET, 0, "exec-root")).toBe("ugc-clip:2ae1378af4fe5a2f7008bc3e8bfc25ea66113584cbf48a6a9f0772b04136ecc9")
  })
  it("reads the keys in any order: the wire's own order is not the key", () => {
    const reordered = Object.fromEntries(Object.entries(TICKET).reverse())
    expect(ugcClipContentKey(reordered, 0)).toBe(ugcClipContentKey(TICKET, 0))
  })
})

describe("a claimed clip is free only when it is the caller's own take of exactly that clip", () => {
  it("the caller's own finished take, same ticket, same Re-render count: free", async () => {
    h.rows = [clipJob()]
    expect(await verifiedReusedClips("u1", TICKETS, claim())).toEqual(new Set([2]))
    // The ticket as a wire (the editor's saved string) reads the same.
    expect(await verifiedReusedClips("u1", [JSON.stringify(OTHER), JSON.stringify(TICKET)], claim())).toEqual(new Set([2]))
    // Every read is the caller's own jobs.
    expect(h.filters.every((f) => f.includes("eq:user_id"))).toBe(true)
  })

  it("another user's batch (a shared or copied workflow): full price", async () => {
    h.rows = [clipJob({ user_id: "u2" })]
    expect(await verifiedReusedClips("u1", TICKETS, claim())).toEqual(new Set())
  })

  it("a deleted job: full price", async () => {
    h.rows = []
    expect(await verifiedReusedClips("u1", TICKETS, claim())).toEqual(new Set())
  })

  it("the Re-render count moved since the take (the run sends another nonce): full price", async () => {
    h.rows = [clipJob()]
    expect(await verifiedReusedClips("u1", TICKETS, claim({ nonce: 1 }))).toEqual(new Set())
  })

  it("a take of another ticket (a changed line), a job that is no clip, or one not finished: full price", async () => {
    h.rows = [clipJob({ idempotency_key: `${ugcClipContentKey(OTHER, 0)}:0` })]
    expect(await verifiedReusedClips("u1", TICKETS, claim())).toEqual(new Set())
    h.rows = [clipJob({ input_data: { type: "generate-video" } })]
    expect(await verifiedReusedClips("u1", TICKETS, claim())).toEqual(new Set())
    for (const status of ["failed", "processing", "pending", "cancelled"]) {
      h.rows = [clipJob({ status })]
      expect(await verifiedReusedClips("u1", TICKETS, claim())).toEqual(new Set())
    }
    // A run key the editor's run does not send (an app run's take): another key.
    h.rows = [clipJob({ idempotency_key: `${ugcClipContentKey(TICKET, 0, "exec-root")}:0` })]
    expect(await verifiedReusedClips("u1", TICKETS, claim())).toEqual(new Set())
  })

  it("a later attempt: free only when the route, walking the earlier ones, reaches a finished take", async () => {
    const later = clipJob({ idempotency_key: `${keyOf(0)}:2` })
    const attempt = (i: number, status: string): Row => ({ id: `job-${i}`, user_id: "u1", status, idempotency_key: `${keyOf(0)}:${i}`, input_data: { type: "ugc-clip" } })
    h.rows = [later, attempt(0, "failed"), attempt(1, "cancelled")]
    expect(await verifiedReusedClips("u1", TICKETS, claim())).toEqual(new Set([2]))
    // An earlier attempt still pending is admitted again (and charged) before the finished one is reached.
    h.rows = [later, attempt(0, "failed"), attempt(1, "pending")]
    expect(await verifiedReusedClips("u1", TICKETS, claim())).toEqual(new Set())
    // One missing: the route admits a new attempt there.
    h.rows = [later, attempt(1, "failed")]
    expect(await verifiedReusedClips("u1", TICKETS, claim())).toEqual(new Set())
    // An earlier one another user holds is not the caller's: missing to the route.
    h.rows = [later, { ...attempt(0, "failed"), user_id: "u2" }, attempt(1, "failed")]
    expect(await verifiedReusedClips("u1", TICKETS, claim())).toEqual(new Set())
  })

  it("a read that fails: every clip priced in full, never an error", async () => {
    h.rows = [clipJob()]
    h.error = { message: "connection reset" }
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(await verifiedReusedClips("u1", TICKETS, claim())).toEqual(new Set())
    warn.mockRestore()
  })

  it("only the claims that hold: the others in the same quote are priced", async () => {
    const otherJob = "00000000-0000-4000-8000-0000000000bb"
    h.rows = [clipJob(), { ...clipJob(), id: otherJob, user_id: "u2", idempotency_key: `${ugcClipContentKey(OTHER, 0)}:0` }]
    const claims = [{ clip: 1, jobId: otherJob, nonce: 0 }, ...claim()]
    expect(await verifiedReusedClips("u1", TICKETS, claims)).toEqual(new Set([2]))
  })
})
