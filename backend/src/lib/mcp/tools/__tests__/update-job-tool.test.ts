/**
 * MCP `update_job` (decided 2026-11-23): rename a result and/or set its cover,
 * through the same rules as `PATCH /v1/jobs/:id`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({ update: vi.fn() }))
vi.mock("../../../job-update.js", () => ({ updateJobOwnerFields: h.update }))

import { registerUpdateJob } from "../job-update-tool.js"

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>
let handler: Handler
registerUpdateJob({ registerTool: (_n: string, _c: unknown, fn: Handler) => { handler = fn } } as never, { userId: "user-1" } as never)

const JOB = "00000000-0000-4000-8000-0000000000c1"

beforeEach(() => {
  h.update.mockReset().mockResolvedValue({ kind: "ok", coverUrl: "https://cdn.test/c.png" })
})

describe("update_job", () => {
  it("sets a cover by asset id or address, clears it, and renames — the owner's own job", async () => {
    await handler({ job_id: JOB, cover_asset_id: "00000000-0000-4000-8000-0000000000aa" })
    expect(h.update).toHaveBeenLastCalledWith("user-1", JOB, { cover: { assetId: "00000000-0000-4000-8000-0000000000aa" } })
    await handler({ job_id: JOB, cover_url: "https://cdn.test/a.png", title: " Mine " })
    expect(h.update).toHaveBeenLastCalledWith("user-1", JOB, { title: "Mine", cover: { url: "https://cdn.test/a.png" } })
    const cleared = await handler({ job_id: JOB, clear_cover: true })
    expect(h.update).toHaveBeenLastCalledWith("user-1", JOB, { cover: null })
    expect(JSON.parse(cleared.content[0]!.text)).toEqual({ data: { jobId: JOB, coverUrl: "https://cdn.test/c.png" } })
  })

  it("refuses nothing to change, two covers at once, and a bad id — nothing is written", async () => {
    expect((await handler({ job_id: JOB })).isError).toBe(true)
    expect((await handler({ job_id: JOB, cover_url: "https://cdn.test/a.png", clear_cover: true })).isError).toBe(true)
    expect((await handler({ job_id: "nope", clear_cover: true })).isError).toBe(true)
    expect(h.update).not.toHaveBeenCalled()
  })

  it("answers a refused picture's reason, and not found for another user's job", async () => {
    h.update.mockResolvedValueOnce({ kind: "invalid_cover", problem: "wrong_format" })
    expect((await handler({ job_id: JOB, cover_url: "https://cdn.test/a.svg" })).content[0]!.text).toContain("cover must be")
    h.update.mockResolvedValueOnce({ kind: "not_found" })
    expect((await handler({ job_id: JOB, clear_cover: true })).content[0]!.text).toContain("not found")
  })

  it("a change that lost the race to another cover change says so", async () => {
    h.update.mockResolvedValueOnce({ kind: "conflict" })
    const out = await handler({ job_id: JOB, clear_cover: true })
    expect(out.isError).toBe(true)
    expect(out.content[0]!.text).toContain("landed first")
  })

  it("the cover's own limit applies here too (it lives in the shared update), and says when to retry", async () => {
    h.update.mockResolvedValueOnce({ kind: "rate_limited", retryAfterSec: 12 })
    const out = await handler({ job_id: JOB, clear_cover: true })
    expect(out.isError).toBe(true)
    expect(out.content[0]!.text).toContain("12s")
  })

  it("the cover address takes the route's own rule: a web address of at most 2048 characters", () => {
    let schema: Record<string, { safeParse(v: unknown): { success: boolean } }> = {}
    registerUpdateJob({ registerTool: (_n: string, c: { inputSchema: typeof schema }) => { schema = c.inputSchema } } as never, { userId: "user-1" } as never)
    expect(schema.cover_url!.safeParse("https://cdn.test/a.png").success).toBe(true)
    expect(schema.cover_url!.safeParse(`https://cdn.test/${"a".repeat(2050)}.png`).success).toBe(false)
    expect(schema.cover_url!.safeParse("ftp://cdn.test/a.png").success).toBe(false)
  })

  it("a failure is logged on the server's logger, and answered as a retryable error", async () => {
    const log = { error: vi.fn() }
    let logged: Handler = handler
    registerUpdateJob({ registerTool: (_n: string, _c: unknown, fn: Handler) => { logged = fn } } as never, { userId: "user-1" } as never, log)
    h.update.mockRejectedValueOnce(new Error("db down"))
    const out = await logged({ job_id: JOB, clear_cover: true })
    expect(out.isError).toBe(true)
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ jobId: JOB, err: expect.any(Error) }), expect.stringContaining("update_job"))
  })
})
