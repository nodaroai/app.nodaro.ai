import { describe, it, expect, vi } from "vitest"

vi.mock("../supabase.js", () => ({ supabase: {} }))

import {
  jobFactsFromRow,
  parsePlaceholder,
  resolveCanvasResultIds,
  scanCanvasResults,
  withResolvedResultIds,
  type CanvasResultQuery,
  type FetchJobFacts,
  type JobFacts,
} from "../canvas-result-ids.js"

/**
 * A saved canvas's placeholder `exec-…` job ids and unlabelled Apply EDL takes,
 * resolved on read and on save by the rule a since-deleted canvas backfill
 * migration used to apply to the stored rows (decided 2026-10-05): exact and
 * unique, never positional.
 */

const OWNER = "00000000-0000-4000-8000-0000000e9001"
const COLLAB = "00000000-0000-4000-8000-0000000e9002"
const id = (n: string) => `f0000000-0000-4000-8000-0000000e9${n}`

const job = (
  n: string,
  type: string,
  nodeId: string,
  output: Record<string, unknown>,
  extra: { user?: string; status?: string; input?: Record<string, unknown> } = {},
): JobFacts =>
  jobFactsFromRow({
    id: id(n),
    user_id: extra.user ?? OWNER,
    status: extra.status ?? "completed",
    job_type: type,
    input_data: { type, node_id: nodeId, ...(extra.input ?? {}) },
    output_data: output,
  })

/** The jobs table: the fake answers a query the way the real one is asked —
 *  the owner's completed jobs on those nodes or with those ids. */
const JOBS: JobFacts[] = [
  job("010", "generate-image", "gen", { imageUrl: "https://m.test/a0.png", thumbnailUrl: "https://m.test/a0-t.png" }),
  job("011", "generate-image", "gen", { imageUrl: "", videoUrl: "https://m.test/r1.png", thumbnailUrl: "https://m.test/r1-t.png" }),
  job("012", "generate-image", "gen", { imageUrl: "https://m.test/r2.png" }),
  job("013", "generate-image", "gen", { imageUrl: "https://m.test/r2.png" }),
  job("014", "suno-music", "suno", { audioUrl: "https://m.test/s0.mp3", audioUrls: ["https://m.test/s0.mp3", "https://m.test/s1.mp3"] }),
  job("015", "suno-music", "suno", { audioUrl: "https://m.test/s1.mp3" }),
  job("016", "generate-image", "pasted", { imageUrl: "https://m.test/p0.png" }),
  job("017", "generate-image", "collab", { imageUrl: "https://m.test/c0.png" }, { user: COLLAB }),
  job("018", "generate-video", "failed", { videoUrl: "https://m.test/q0.mp4" }, { status: "failed" }),
  job("019", "save-to-storage", "store", { url: "https://m.test/g0.png", type: "image" }),
  // Apply EDL: a pre-label proxy render (a placeholder take), a pre-label final
  // render landed with its real id, a labelled one, and one whose URL is not
  // the take's.
  job("020", "apply-edl", "render", { videoUrl: "https://m.test/e0.mp4", thumbnailUrl: "https://m.test/e0.jpg" }, { input: { quality: "proxy" } }),
  job("021", "apply-edl", "render", { videoUrl: "https://m.test/e1.mp4" }, { input: { quality: "final" } }),
  job("022", "apply-edl", "render", { videoUrl: "https://m.test/e2.mp4", quality: "proxy", clipKey: "0-1000" }, { input: { quality: "proxy" } }),
  job("023", "apply-edl", "render", { videoUrl: "https://m.test/elsewhere.mp4" }, { input: { quality: "proxy" } }),
]

function fakeJobs() {
  const calls: Array<{ owner: string; query: CanvasResultQuery }> = []
  const fetchJobs: FetchJobFacts = async (owner, query) => {
    calls.push({ owner, query })
    return JOBS.filter((j) => j.userId === owner && j.status === "completed"
      && ((j.nodeId !== null && query.nodeIds.includes(j.nodeId)) || query.jobIds.includes(j.id)))
  }
  return { calls, fetchJobs }
}

const results = (nodes: unknown, nodeId: string) =>
  ((nodes as Array<{ id: string; data?: { generatedResults?: unknown[] } }>).find((n) => n.id === nodeId)?.data?.generatedResults ?? []) as Array<Record<string, unknown>>

const CANVAS = [
  { id: "gen", type: "generate-image", position: { x: 1, y: 2 }, data: { label: "Gen", activeResultIndex: 0, generatedResults: [
    { url: "https://m.test/a0.png", jobId: "exec-gen", timestamp: "2026-09-01T00:00:00Z", thumbnailUrl: "https://m.test/own-thumb.png" },
    { url: "https://m.test/r1.png", jobId: "exec-gen-0", timestamp: "2026-09-01T00:00:01Z" },
    { url: "https://m.test/r2.png", jobId: "exec-gen-1" },
    { url: "https://m.test/r3.png", jobId: "exec-gen-2" },
    { url: "https://m.test/r4.png", jobId: id("099") },
    { text: "a caption", jobId: "exec-gen" },
  ] } },
  { id: "suno", type: "suno-music", data: { generatedResults: [
    { url: "https://m.test/s0.mp3", jobId: "exec-suno", sunoTrackId: "t0" },
    { url: "https://m.test/s1.mp3", jobId: "exec-suno-v1", sunoTrackId: "t1" },
  ] } },
  { id: "pasted", type: "generate-image", data: { generatedResults: [{ url: "https://m.test/p0.png", jobId: "exec-orig-0" }] } },
  { id: "collab", type: "generate-image", data: { generatedResults: [{ url: "https://m.test/c0.png", jobId: "exec-collab" }] } },
  { id: "failed", type: "generate-video", data: { generatedResults: [{ url: "https://m.test/q0.mp4", jobId: "exec-failed" }] } },
  { id: "store", type: "save-to-storage", data: { generatedResults: [{ url: "https://m.test/g0.png", jobId: "exec-store" }] } },
  { id: "render", type: "apply-edl", data: { quality: "final", generatedResults: [
    { url: "https://m.test/e0.mp4", jobId: "exec-render-0" },
    { url: "https://m.test/e1.mp4", jobId: id("021") },
    { url: "https://m.test/e2.mp4", jobId: id("022") },
    { url: "https://m.test/e3.mp4", jobId: id("023") },
    { url: "https://m.test/e4.mp4", jobId: id("024"), quality: "final" },
  ] } },
  { id: "empty", type: "generate-image", data: { generatedResults: [] } },
  { id: "note", type: "sticky-note" },
]

describe("parsePlaceholder", () => {
  it("reads the three forms relative to the node's OWN id, and nothing else", () => {
    expect(parsePlaceholder("gen", "exec-gen")).toEqual({ kind: "take" })
    expect(parsePlaceholder("gen", "exec-gen-3")).toEqual({ kind: "row" })
    expect(parsePlaceholder("gen", "exec-gen-v2")).toEqual({ kind: "variant", variant: 2 })
    // A node whose id extends another's: its own take, not the other's row.
    expect(parsePlaceholder("gen-3", "exec-gen-3")).toEqual({ kind: "take" })
    expect(parsePlaceholder("gen", "exec-orig-0")).toBeNull()
    expect(parsePlaceholder("gen", "exec-gen-v0")).toBeNull()
    expect(parsePlaceholder("gen", "exec-gen-x")).toBeNull()
    expect(parsePlaceholder("gen", id("010"))).toBeNull()
  })
})

describe("resolveCanvasResultIds", () => {
  it("asks NOTHING of the jobs table when no result holds a placeholder or an unlabelled render", async () => {
    const { calls, fetchJobs } = fakeJobs()
    const clean = [
      { id: "gen", type: "generate-image", data: { generatedResults: [{ url: "https://m.test/a0.png", jobId: id("010") }] } },
      { id: "render", type: "apply-edl", data: { generatedResults: [{ url: "https://m.test/e2.mp4", jobId: id("022"), quality: "proxy" }] } },
      { id: "llm", type: "llm-chat", data: { generatedResults: [{ text: "hi", jobId: "exec-llm" }] } },
    ]
    const out = await resolveCanvasResultIds(clean, OWNER, { fetchJobs })
    expect(out).toBe(clean)
    expect(calls).toHaveLength(0)
  })

  it("asks ONE batched query for every node with a placeholder and every unlabelled render", async () => {
    const { calls, fetchJobs } = fakeJobs()
    await resolveCanvasResultIds(CANVAS, OWNER, { fetchJobs })
    expect(calls).toHaveLength(1)
    expect(calls[0].owner).toBe(OWNER)
    expect([...calls[0].query.nodeIds].sort()).toEqual(["collab", "failed", "gen", "render", "store", "suno"])
    // Only bare job ids of an apply-edl node without a render quality.
    expect([...calls[0].query.jobIds].sort()).toEqual([id("021"), id("022"), id("023")])
  })

  it("renames a take, a fan-out row, a variant set and a Save to Storage take exactly", async () => {
    const { fetchJobs } = fakeJobs()
    const out = await resolveCanvasResultIds(CANVAS, OWNER, { fetchJobs })
    const gen = results(out, "gen")
    // The take: its job id, and every other field kept — its OWN thumbnail too.
    expect(gen[0]).toEqual({ url: "https://m.test/a0.png", jobId: id("010"), timestamp: "2026-09-01T00:00:00Z", thumbnailUrl: "https://m.test/own-thumb.png" })
    // The row (an empty imageUrl is absent): its job id and the job's thumbnail.
    expect(gen[1]).toEqual({ url: "https://m.test/r1.png", jobId: id("011"), timestamp: "2026-09-01T00:00:01Z", thumbnailUrl: "https://m.test/r1-t.png" })
    expect(results(out, "suno")).toEqual([
      { url: "https://m.test/s0.mp3", jobId: id("014"), sunoTrackId: "t0" },
      // Variant 1 reads only slot 1 — not job 015, whose primary URL it also is.
      { url: "https://m.test/s1.mp3", jobId: `${id("014")}-v1`, sunoTrackId: "t1" },
    ])
    expect(results(out, "store")).toEqual([{ url: "https://m.test/g0.png", jobId: id("019") }])
  })

  it("leaves alone what no single job of the owner made for that node", async () => {
    const { fetchJobs } = fakeJobs()
    const out = await resolveCanvasResultIds(CANVAS, OWNER, { fetchJobs })
    const gen = results(out, "gen")
    expect(gen[2].jobId).toBe("exec-gen-1") // two jobs made that URL
    expect(gen[3].jobId).toBe("exec-gen-2") // no job made it
    expect(gen[4]).toEqual({ url: "https://m.test/r4.png", jobId: id("099") }) // a real id, not a render
    expect(gen[5]).toEqual({ text: "a caption", jobId: "exec-gen" }) // a text result has no URL
    expect(results(out, "pasted")[0].jobId).toBe("exec-orig-0") // names another node
    expect(results(out, "collab")[0].jobId).toBe("exec-collab") // a collaborator's job
    expect(results(out, "failed")[0].jobId).toBe("exec-failed") // never completed
  })

  it("labels a pre-label Apply EDL take by the quality it was ordered at, placeholder or real id", async () => {
    const { fetchJobs } = fakeJobs()
    const out = await resolveCanvasResultIds(CANVAS, OWNER, { fetchJobs })
    expect(results(out, "render")).toEqual([
      // A placeholder row: its job, its thumbnail, and "proxy" from the order.
      { url: "https://m.test/e0.mp4", jobId: id("020"), thumbnailUrl: "https://m.test/e0.jpg", quality: "proxy" },
      // A real id with no label: "final" from the order.
      { url: "https://m.test/e1.mp4", jobId: id("021"), quality: "final" },
      // A real id whose render wrote its own label: the worker's quality and clip.
      { url: "https://m.test/e2.mp4", jobId: id("022"), quality: "proxy", clipKey: "0-1000" },
      // A real id whose job made another URL: untouched.
      { url: "https://m.test/e3.mp4", jobId: id("023") },
      { url: "https://m.test/e4.mp4", jobId: id("024"), quality: "final" },
    ])
    // The node's own `quality` setting is never a result's.
    const render = (out as Array<{ id: string; data: Record<string, unknown> }>).find((n) => n.id === "render")
    expect(render?.data.quality).toBe("final")
  })

  it("changes nothing else, never edits the input, and is idempotent", async () => {
    const { fetchJobs } = fakeJobs()
    const before = JSON.stringify(CANVAS)
    const out = await resolveCanvasResultIds(CANVAS, OWNER, { fetchJobs })
    expect(JSON.stringify(CANVAS)).toBe(before)
    const byId = (nodes: unknown, nodeId: string) => (nodes as Array<{ id: string }>).find((n) => n.id === nodeId)
    for (const untouched of ["pasted", "collab", "failed", "empty", "note"]) {
      expect(byId(out, untouched)).toBe(byId(CANVAS, untouched))
    }
    const gen = byId(out, "gen") as unknown as { position: unknown; data: Record<string, unknown> }
    expect(gen.position).toEqual({ x: 1, y: 2 })
    expect(gen.data.label).toBe("Gen")
    expect(gen.data.activeResultIndex).toBe(0)
    const again = await resolveCanvasResultIds(out, OWNER, { fetchJobs })
    expect(again).toBe(out)
  })

  it("never touches a codec-owned (Studio) document", async () => {
    const { calls, fetchJobs } = fakeJobs()
    const studio = [{ id: "gen", type: "generate-image", data: { keyframeId: "k1", generatedResults: [{ url: "https://m.test/a0.png", jobId: "exec-gen" }] } }]
    expect(await resolveCanvasResultIds(studio, OWNER, { fetchJobs })).toBe(studio)
    const bySettings = [{ id: "gen", type: "generate-image", data: { generatedResults: [{ url: "https://m.test/a0.png", jobId: "exec-gen" }] } }]
    expect(await resolveCanvasResultIds(bySettings, OWNER, { fetchJobs, settings: { studio: { keyframes: [] } } })).toBe(bySettings)
    expect(calls).toHaveLength(0)
  })

  it("hands the nodes back as stored when the lookup fails, or the owner is unknown", async () => {
    const failing: FetchJobFacts = async () => { throw new Error("db down") }
    expect(await resolveCanvasResultIds(CANVAS, OWNER, { fetchJobs: failing })).toBe(CANVAS)
    const { calls, fetchJobs } = fakeJobs()
    expect(await resolveCanvasResultIds(CANVAS, null, { fetchJobs })).toBe(CANVAS)
    expect(calls).toHaveLength(0)
  })
})

describe("withResolvedResultIds", () => {
  it("resolves a row by its own user_id and settings, and returns the SAME row when nothing changed", async () => {
    const { fetchJobs } = fakeJobs()
    const row = { id: "wf", user_id: OWNER, settings: {}, nodes: CANVAS }
    const out = await withResolvedResultIds(row, { fetchJobs })
    expect(out).not.toBe(row)
    expect(results(out.nodes, "gen")[0].jobId).toBe(id("010"))
    const studioRow = { id: "wf", user_id: OWNER, settings: { studio: { sequences: [] } }, nodes: CANVAS }
    expect(await withResolvedResultIds(studioRow, { fetchJobs })).toBe(studioRow)
    const noNodes = { id: "wf", user_id: OWNER }
    expect(await withResolvedResultIds(noNodes, { fetchJobs })).toBe(noNodes)
  })

  it("leaves a row whose settings were not selected as it is — codec ownership is never judged on the nodes alone", async () => {
    const { calls, fetchJobs } = fakeJobs()
    const nodesOnly = { id: "wf", user_id: OWNER, nodes: CANVAS }
    expect(await withResolvedResultIds(nodesOnly, { fetchJobs })).toBe(nodesOnly)
    expect(calls).toHaveLength(0)
    // Selected and empty is an answer: such a row is resolved.
    const nullSettings = { id: "wf", user_id: OWNER, settings: null, nodes: CANVAS }
    expect(await withResolvedResultIds(nullSettings, { fetchJobs })).not.toBe(nullSettings)
  })

  it("scans only what it can resolve", () => {
    expect(scanCanvasResults(null)).toEqual({ nodeIds: [], jobIds: [] })
    expect(scanCanvasResults([{ id: "x", data: { generatedResults: [{ url: "", jobId: "exec-x" }] } }])).toEqual({ nodeIds: [], jobIds: [] })
  })
})
