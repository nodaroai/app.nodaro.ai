import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `POST /v1/video-remake/:jobId/side-by-side` (and its /v1/cast-swap alias):
 *
 *  - the owner's run, or any run for an administrator; another person's run
 *    is absent (404), and so is a run in the Trash or restricted (the read
 *    filters both);
 *  - a recorded file answers 200 at once, without starting anything;
 *  - otherwise the job is started (202 making / waiting), with the run's
 *    stretch and its OWNER (an administrator's ask counts against the run's
 *    owner, whose row records the file);
 *  - a run with no side by side is refused (409 with its reason), a failed
 *    render is 500.
 */
const db = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  admin: false,
  filters: [] as Array<Array<[string, string, unknown]>>,
}))

vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: () => {
      const filters: Array<[string, string, unknown]> = []
      db.filters.push(filters)
      const chain = {
        select: () => chain,
        eq: (col: string, v: unknown) => (filters.push(["eq", col, v]), chain),
        is: (col: string, v: unknown) => (filters.push(["is", col, v]), chain),
        maybeSingle: async () => {
          const id = filters.find(([op, c]) => op === "eq" && c === "id")?.[2] as string
          const owner = filters.find(([op, c]) => op === "eq" && c === "user_id")?.[2]
          const row = db.rows.get(id)
          return { data: row && (owner === undefined || row.user_id === owner) ? row : null, error: null }
        },
      }
      return chain
    },
  },
}))
vi.mock("../../../lib/admin-check.js", () => ({ checkIsAdmin: async () => db.admin }))

const { videoRemakeSideBySideRoutes } = await import("../video-remake-side-by-side.js")
const { SIDE_BY_SIDE_FIELD, SIDE_BY_SIDE_RECIPE } = await import("../../lib/video-remake-side-by-side.js")
type Job = import("../../lib/video-remake-side-by-side-job.js").SideBySideJob

const OWNER = "11111111-1111-4111-8111-111111111111"
const OTHER = "22222222-2222-4222-8222-222222222222"
const RUN = "61c80648-e2e6-487c-8b04-2a865f6a0e63"
const DRAFT = "96fadc16-d4fc-4e87-88d3-c0c9e7f2a1af"
const CLIP = "https://cdn.nodaro.ai/uploads/videos/clip.mp4"

const runRow = (over: Record<string, unknown> = {}) => ({
  id: RUN,
  user_id: OWNER,
  status: "completed",
  job_type: "cast-swap",
  input_data: { type: "cast-swap", videoUrl: CLIP, preview: true, previewStart: 2 },
  output_data: { videoUrl: `https://cdn.nodaro.ai/videos/${RUN}.mp4`, durationSec: 4.042, __castSwapClipSec: 4 },
  ...over,
})

let app: FastifyInstance
let caller = OWNER
const start = vi.fn<Job["start"]>()

beforeEach(async () => {
  db.rows.clear()
  db.admin = false
  db.filters = []
  caller = OWNER
  start.mockReset()
  start.mockResolvedValue({ status: "making" })
  app = Fastify()
  app.addHook("onRequest", async (req) => {
    req.userId = caller
  })
  await app.register(videoRemakeSideBySideRoutes, { job: { start, poll: vi.fn() } })
})

afterEach(async () => {
  await app.close()
})

const ask = (jobId = RUN, prefix = "/v1/video-remake") => app.inject({ method: "POST", url: `${prefix}/${jobId}/side-by-side` })

describe("POST /v1/video-remake/:jobId/side-by-side", () => {
  it("starts the owner's render with the run's stretch, and answers 202 while it is made", async () => {
    db.rows.set(RUN, runRow())
    const res = await ask()
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ data: { status: "making" } })
    expect(start).toHaveBeenCalledWith({
      jobId: RUN,
      ownerId: OWNER,
      resultUrl: `https://cdn.nodaro.ai/videos/${RUN}.mp4`,
      source: { originalUrl: CLIP, startSec: 2, lengthSec: 4 },
    })
  })

  it("answers at the /v1/cast-swap alias too", async () => {
    db.rows.set(RUN, runRow())
    expect((await ask(RUN, "/v1/cast-swap")).statusCode).toBe(202)
  })

  it("says waiting while another of the account's runs is rendered", async () => {
    db.rows.set(RUN, runRow())
    start.mockResolvedValue({ status: "waiting" })
    expect((await ask()).json()).toEqual({ data: { status: "waiting" } })
  })

  it("answers a recorded file at once, starting nothing", async () => {
    const record = { v: SIDE_BY_SIDE_RECIPE, url: "https://cdn.nodaro.ai/videos/x.mp4", width: 1440, height: 1280, layout: "side" }
    db.rows.set(RUN, runRow({ output_data: { videoUrl: "https://cdn.nodaro.ai/videos/r.mp4", [SIDE_BY_SIDE_FIELD]: record } }))
    const res = await ask()
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { status: "ready", url: record.url, fileName: "nodaro-remake-side-by-side-61c80648.mp4", width: 1440, height: 1280, layout: "side" } })
    expect(start).not.toHaveBeenCalled()
  })

  it("never answers a recorded file to a runner the run is refused to (an administrator's render of a trend run)", async () => {
    const record = { v: SIDE_BY_SIDE_RECIPE, url: "https://cdn.nodaro.ai/videos/t.mp4", width: 1440, height: 1280, layout: "side" }
    db.rows.set(RUN, runRow({ input_data: { type: "cast-swap", trend: { slug: "t" }, __videoUrl: CLIP, preview: true }, output_data: { videoUrl: "https://cdn.nodaro.ai/videos/r.mp4", [SIDE_BY_SIDE_FIELD]: record } }))
    const res = await ask()
    expect(res.statusCode).toBe(409)
    expect(res.json().error.reason).toBe("trend_run")
    db.admin = true
    expect((await ask()).statusCode).toBe(200)
  })

  it("answers 200 when the job has the file", async () => {
    db.rows.set(RUN, runRow())
    start.mockResolvedValue({ status: "ready", record: { v: SIDE_BY_SIDE_RECIPE, url: "https://cdn.nodaro.ai/videos/y.mp4", width: 1280, height: 1440, layout: "stack" } })
    const res = await ask()
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ status: "ready", url: "https://cdn.nodaro.ai/videos/y.mp4", layout: "stack" })
  })

  it("is absent for another person's run; an administrator's ask renders it as its owner's", async () => {
    db.rows.set(RUN, runRow())
    caller = OTHER
    expect((await ask()).statusCode).toBe(404)
    expect(start).not.toHaveBeenCalled()
    db.admin = true
    expect((await ask()).statusCode).toBe(202)
    expect(start.mock.calls[0]![0].ownerId).toBe(OWNER)
  })

  it("reads only runs out of the Trash and not restricted", async () => {
    db.rows.set(RUN, runRow())
    await ask()
    expect(db.filters[0]).toEqual(expect.arrayContaining([["is", "deleted_at", null], ["is", "restricted_at", null]]))
  })

  it("reads a Full Quality's stretch from its draft, the same owner's", async () => {
    db.rows.set(RUN, runRow({ job_type: "cast-swap-full-quality", input_data: { type: "cast-swap", fullQualityOf: DRAFT, preview: false } }))
    db.rows.set(DRAFT, runRow({ id: DRAFT, input_data: { type: "cast-swap", videoUrl: CLIP, preview: true, previewStart: 6 } }))
    await ask()
    expect(start.mock.calls[0]![0].source).toEqual({ originalUrl: CLIP, startSec: 6, lengthSec: 4 })
    expect(db.filters[1]).toEqual(expect.arrayContaining([["eq", "user_id", OWNER], ["is", "deleted_at", null], ["is", "restricted_at", null]]))
  })

  it("refuses a run with no side by side, saying why", async () => {
    db.rows.set(RUN, runRow({ status: "processing" }))
    const res = await ask()
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatchObject({ code: "side_by_side_unavailable", reason: "not_finished" })
    db.rows.set(RUN, runRow({ input_data: { type: "cast-swap", trend: { slug: "t" }, __videoUrl: CLIP, preview: true } }))
    expect((await ask()).json().error.reason).toBe("trend_run")
  })

  it("is 500 when the render failed", async () => {
    db.rows.set(RUN, runRow())
    start.mockResolvedValue({ status: "failed" })
    const res = await ask()
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("side_by_side_failed")
  })

  it("asks for a signed-in caller and a run id", async () => {
    caller = undefined as unknown as string
    expect((await ask()).statusCode).toBe(401)
    caller = OWNER
    expect((await ask("not-a-uuid")).statusCode).toBe(400)
  })
})
