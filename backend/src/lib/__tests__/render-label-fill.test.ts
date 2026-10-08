import { describe, it, expect, vi, beforeEach } from "vitest"
import { RENDER_NODE_TYPE_IDS } from "@nodaro/shared"

/**
 * The Preview label for renders recorded BEFORE it was stored (decided
 * 2026-10-05). Two readers, ONE rule — `jobRowStamp` (canvas-result-ids.ts),
 * the same function migration 459 and the canvas reads apply:
 *
 *   - `fillJobRenderQuality`: a job read hands back the label the worker did not
 *     write, from the order's quality. Never written back.
 *   - `fillAssetRenderQuality`: a library list takes an Apply EDL file's label
 *     from the job that made it — ONE batched lookup per page, none when no
 *     file needs one.
 */

const jobsQuery = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  calls: [] as Array<{ select: string; ids: string[]; jobTypes: string[] | null }>,
}))

vi.mock("../supabase.js", () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table !== "jobs") throw new Error(`unexpected table ${table}`)
      const call = { select: "", ids: [] as string[], jobTypes: null as string[] | null }
      jobsQuery.calls.push(call)
      const chain: Record<string, unknown> = {}
      chain.select = (s: string) => { call.select = s; return chain }
      chain.in = (col: string, vals: string[]) => { if (col === "job_type") call.jobTypes = vals; else call.ids = vals; return chain }
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: jobsQuery.rows, error: null }).then(res)
      return chain
    }),
  },
}))

const { fillJobRenderQuality, fillJobsRenderQuality, fillAssetRenderQuality, ORDER_QUALITY_COLUMNS } = await import("../render-label-fill.js")
const { jobRowStamp, jobFactsFromRow } = await import("../canvas-result-ids.js")

beforeEach(() => {
  jobsQuery.rows = []
  jobsQuery.calls.length = 0
})

const render = (over: Record<string, unknown> = {}) => ({
  id: "j1",
  status: "completed",
  job_type: "apply-edl",
  input_data: { quality: "proxy" },
  output_data: { videoUrl: "https://cdn/a.mp4" },
  ...over,
})

describe("fillJobRenderQuality — a job read names its render's label", () => {
  it("fills a Preview from the order's quality when the worker wrote none", () => {
    const filled = fillJobRenderQuality(render())
    expect((filled.output_data as Record<string, unknown>).quality).toBe("proxy")
  })

  it("is exactly jobRowStamp's answer, for every order quality", () => {
    for (const quality of ["proxy", "final", undefined, "weird", ""]) {
      const row = render({ input_data: quality === undefined ? {} : { quality } })
      const expected = jobRowStamp(jobFactsFromRow(row)).quality
      expect((fillJobRenderQuality(row).output_data as Record<string, unknown>).quality).toBe(expected)
    }
  })

  it("keeps the worker's own label", () => {
    const row = render({ input_data: { quality: "proxy" }, output_data: { videoUrl: "v", quality: "final" } })
    expect(fillJobRenderQuality(row)).toBe(row)
  })

  it("never mutates the row it was given", () => {
    const row = render()
    const before = JSON.stringify(row)
    const filled = fillJobRenderQuality(row)
    expect(JSON.stringify(row)).toBe(before)
    expect(filled).not.toBe(row)
    expect(filled.output_data).not.toBe(row.output_data)
  })

  it("leaves every other node type alone (another node's quality is something else)", () => {
    const row = render({ job_type: "generate-image", input_data: { quality: "proxy" } })
    expect(fillJobRenderQuality(row)).toBe(row)
  })

  it("leaves a job with no output yet alone", () => {
    for (const row of [render({ output_data: null }), render({ status: "processing", output_data: {} })]) {
      expect(fillJobRenderQuality(row)).toBe(row)
    }
  })

  it("reads the order from the lean projection's input_quality, then drops it", () => {
    const lean = { id: "j1", status: "completed", job_type: "apply-edl", input_quality: "proxy", output_data: { videoUrl: "v" } }
    const filled = fillJobRenderQuality(lean) as Record<string, unknown>
    expect((filled.output_data as Record<string, unknown>).quality).toBe("proxy")
    expect("input_quality" in filled).toBe(false)
    expect(filled.job_type).toBe("apply-edl")
  })

  it("a lean route can drop job_type too, so it stays lean", () => {
    const lean = { id: "j1", status: "completed", job_type: "generate-image", input_quality: null, output_data: { imageUrl: "i" } }
    const out = fillJobRenderQuality(lean, { dropJobType: true }) as Record<string, unknown>
    expect("job_type" in out).toBe(false)
    expect("input_quality" in out).toBe(false)
    expect(out.output_data).toEqual({ imageUrl: "i" })
  })

  it("names the columns a lean route must add to its select", () => {
    expect(ORDER_QUALITY_COLUMNS).toBe("job_type, input_quality:input_data->>quality")
  })

  it("fills a list row by row", () => {
    const rows = [render({ id: "a" }), render({ id: "b", input_data: { quality: "final" } }), render({ id: "c", job_type: "generate-video" })]
    const out = fillJobsRenderQuality(rows)
    expect(out.map((r) => (r.output_data as Record<string, unknown>)?.quality)).toEqual(["proxy", "final", undefined])
  })
})

describe("fillAssetRenderQuality — a library page takes an old render's label from its job", () => {
  const asset = (over: Record<string, unknown> = {}) => ({
    id: "a1", type: "video", job_id: "j1", metadata: { thumbnail_url: "t" }, ...over,
  })

  it("makes ONE batched lookup for every file that needs a label", async () => {
    jobsQuery.rows = [
      { id: "j1", job_type: "apply-edl", input_quality: "proxy", out_quality: null },
      { id: "j2", job_type: "apply-edl", input_quality: "final", out_quality: null },
    ]
    const out = await fillAssetRenderQuality([
      asset(),
      asset({ id: "a2", job_id: "j2" }),
      asset({ id: "a3", job_id: "j1", type: "audio" }),
    ])
    expect(jobsQuery.calls).toHaveLength(1)
    expect([...jobsQuery.calls[0]!.ids].sort()).toEqual(["j1", "j2"])
    // Restricted to render jobs (RENDER_NODE_TYPES): Apply EDL today.
    expect(jobsQuery.calls[0]!.jobTypes).toEqual([...RENDER_NODE_TYPE_IDS])
    expect(out.map((a) => (a.metadata as Record<string, unknown>).quality)).toEqual(["proxy", "final", "proxy"])
    expect((out[0]!.metadata as Record<string, unknown>).thumbnail_url).toBe("t")
  })

  it("does no lookup when every file already has its label", async () => {
    const out = await fillAssetRenderQuality([
      asset({ metadata: { quality: "proxy" } }),
      asset({ id: "a2", metadata: { quality: "final" } }),
    ])
    expect(jobsQuery.calls).toHaveLength(0)
    expect(out).toHaveLength(2)
  })

  it("does no lookup for files that cannot be a render (images, uploads without a job)", async () => {
    await fillAssetRenderQuality([
      asset({ type: "image" }),
      asset({ id: "a2", job_id: null }),
      asset({ id: "a3", job_id: undefined }),
      asset({ id: "a4", metadata: null, job_id: null }),
    ])
    expect(jobsQuery.calls).toHaveLength(0)
  })

  it("does no lookup for an empty page", async () => {
    expect(await fillAssetRenderQuality([])).toEqual([])
    expect(jobsQuery.calls).toHaveLength(0)
  })

  it("asks once per distinct job, however many files it made", async () => {
    jobsQuery.rows = [{ id: "j1", job_type: "apply-edl", input_quality: "proxy", out_quality: null }]
    await fillAssetRenderQuality([asset(), asset({ id: "a2", type: "audio" })])
    expect(jobsQuery.calls[0]!.ids).toEqual(["j1"])
  })

  it("leaves a file whose job is not a render, or is gone, unlabelled", async () => {
    jobsQuery.rows = [] // the job filter matched nothing: not an Apply EDL job, or deleted
    const files = [asset(), asset({ id: "a2", job_id: "gone" })]
    const out = await fillAssetRenderQuality(files)
    expect(out.map((a) => (a.metadata as Record<string, unknown>).quality)).toEqual([undefined, undefined])
  })

  it("never overwrites a stored label, and keeps the rows it was given untouched", async () => {
    jobsQuery.rows = [{ id: "j1", job_type: "apply-edl", input_quality: "proxy", out_quality: null }]
    const labelled = asset({ id: "a9", job_id: "j1", metadata: { quality: "final" } })
    const bare = asset()
    const before = JSON.stringify([labelled, bare])
    const out = await fillAssetRenderQuality([labelled, bare])
    expect(JSON.stringify([labelled, bare])).toBe(before)
    expect((out[0]!.metadata as Record<string, unknown>).quality).toBe("final")
    expect((out[1]!.metadata as Record<string, unknown>).quality).toBe("proxy")
  })

  it("uses the worker's own label over the order's when the job has one", async () => {
    jobsQuery.rows = [{ id: "j1", job_type: "apply-edl", input_quality: "proxy", out_quality: "final" }]
    const [out] = await fillAssetRenderQuality([asset()])
    expect((out!.metadata as Record<string, unknown>).quality).toBe("final")
  })

  it("a failed lookup never fails the list: the files go out as stored", async () => {
    const { supabase } = await import("../supabase.js")
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.in = () => chain
      chain.eq = () => chain
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "boom" } }).then(res)
      return chain
    })
    const files = [asset()]
    const out = await fillAssetRenderQuality(files)
    expect(out).toEqual(files)
  })
})
