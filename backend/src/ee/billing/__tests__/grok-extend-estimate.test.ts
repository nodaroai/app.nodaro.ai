// @test-units-by-name prices the node types it names (generate-video, text-to-video, image-to-video, upload-video, extend-video)
import { describe, it, expect, vi } from "vitest"

/**
 * A Grok Extend node is quoted (the run estimate, the published-app listing,
 * the pre-run balance check) at the seconds it adds and its SOURCE's
 * resolution — known to a quote only when the graph says for sure: a Grok
 * Imagine node set to 480p wired in. Anything else is quoted at the dearer
 * 720p row, so the quote never falls below what the run is charged: the row
 * the source check answers for the job that node makes.
 */

/** The source job the check reads (`resolveGrokExtendSource`); every other table has no rows. */
const db = vi.hoisted(() => ({ source: null as Record<string, unknown> | null }))
vi.mock("../../../lib/supabase.js", () => {
  const empty = () => {
    const chain: Record<string, unknown> = {}
    for (const m of ["select", "eq", "order", "range", "limit", "in", "is", "not", "gt", "lt"]) chain[m] = () => chain
    chain.single = async () => ({ data: null, error: { code: "PGRST116", message: "no rows" } })
    chain.maybeSingle = async () => ({ data: null, error: null })
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null })
    return chain
  }
  const jobs = () => {
    const filters: Array<[string, unknown]> = []
    const q: Record<string, unknown> = {}
    q.select = () => q
    q.eq = (col: string, val: unknown) => { filters.push([col, val]); return q }
    // `.is(col, null)` (the Trash filter): a source that never set the column reads as NULL.
    const nullCols: string[] = []
    q.is = (col: string) => { nullCols.push(col); return q }
    q.limit = async () => ({
      data: db.source && filters.every(([c, v]) => db.source![c] === v) && nullCols.every((c) => db.source![c] == null) ? [db.source] : [],
      error: null,
    })
    return q
  }
  return { supabase: { from: (table: string) => (table === "jobs" ? jobs() : empty()), rpc: async () => ({ data: null, error: null }) } }
})
vi.mock("../../../providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../providers/video/ffmpeg-utils.js")>()),
  probeVideoSource: async () => ({ width: 854, height: 480, durationSeconds: 6.08, videoDurationSeconds: 6.041667 }),
}))
vi.mock("../../../lib/queue.js", () => ({ videoQueue: { add: vi.fn() }, redis: {} }))
vi.mock("../../../lib/app-settings.js", () => ({ getAppSettings: async () => ({ cost_markup_percent: 40 }) }))
vi.mock("../../../lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/config.js")>()),
  hasCredits: () => true,
}))

import { chargedCredits, estimateWorkflowCreditsDetailed, getChargedPriceTable } from "../credits.js"
import { resolveGrokExtendSource } from "../../../lib/grok-extend-source.js"
import { grokExtendCreditId } from "@nodaro/shared/credits"

const USER = "user-a"
const TASK = "task-grok-src"

type Node = { id: string; type: string; data: Record<string, unknown> }
const extend = (data: Record<string, unknown> = {}): Node => ({ id: "ext", type: "extend-video", data: { provider: "grok-extend", prompt: "she runs", ...data } })
const source = (type: string, provider: unknown, resolution?: string): Node => ({
  id: "src",
  type,
  data: { provider, prompt: "a fox in the snow", ...(resolution !== undefined ? { resolution } : {}) },
})
const wired = [{ id: "e1", source: "src", target: "ext", sourceHandle: "video", targetHandle: "video" }]

/** What the estimate quotes the extend node at. */
async function quoteOf(nodes: Node[], edges = wired): Promise<number> {
  return (await estimateWorkflowCreditsDetailed(nodes, edges)).perNode.ext!.credits
}

async function charged(id: string): Promise<number> {
  const credits = chargedCredits(await getChargedPriceTable(), id)
  if (credits === undefined) throw new Error(`${id} is not priced`)
  return credits
}

describe("the Grok Extend quote", () => {
  it("quotes the 480p row for a wired Grok Imagine node set to 480p, at the length the node adds", async () => {
    for (const duration of [6, 10]) {
      expect(await quoteOf([source("generate-video", "grok-i2v", "480p"), extend({ duration })]), String(duration)).toBe(await charged(`grok-extend:${duration}s:480p`))
    }
  })

  describe("a Grok node that already made a clip: the resolution its job recorded, not the node's setting", () => {
    /** The source node holding the take its task TASK names, which recorded `recorded` (none: undefined), set to `resolution`. */
    const made = (recorded: string | undefined, resolution?: string, extra: Record<string, unknown> = {}): Node => {
      const node = source("generate-video", "grok-i2v", resolution)
      const take = { url: "https://cdn.example/src.mp4", jobId: "j1", kieTaskId: TASK, ...(recorded !== undefined ? { recordedResolution: recorded } : {}) }
      return { ...node, data: { ...node.data, kieTaskId: TASK, generatedResults: [take], ...extra } }
    }
    /** The extend node's quote in a run of the extension alone (the source does not run again). */
    const extendOnly = async (nodes: Node[]) => (await estimateWorkflowCreditsDetailed(nodes, wired, { runNodeIds: new Set(["ext"]) })).perNode.ext!.credits

    it("recorded 720p, the node set to 480p since: quoted at 720p — the clip it extends", async () => {
      for (const duration of [6, 10]) {
        expect(await extendOnly([made("720p", "480p"), extend({ duration })]), String(duration)).toBe(await charged(`grok-extend:${duration}s:720p`))
      }
      // A frozen source does not run again either: the same.
      expect(await quoteOf([made("720p", "480p", { skipped: true }), extend()])).toBe(await charged("grok-extend:6s:720p"))
    })

    it("recorded 480p: quoted at 480p, even unset or set to 720p since", async () => {
      for (const resolution of ["480p", undefined, "720p"]) {
        expect(await extendOnly([made("480p", resolution), extend()]), String(resolution)).toBe(await charged("grok-extend:6s:480p"))
      }
    })

    it("no recorded resolution, or no take the task names (deleted, or from before takes recorded it): 720p", async () => {
      expect(await extendOnly([made(undefined, "480p"), extend()])).toBe(await charged("grok-extend:6s:720p"))
      const deleted = made("480p", "480p")
      const older = { ...deleted, data: { ...deleted.data, generatedResults: [{ url: "https://cdn.example/old.mp4", jobId: "j0", kieTaskId: "task-older", recordedResolution: "480p" }] } }
      expect(await extendOnly([older, extend()])).toBe(await charged("grok-extend:6s:720p"))
      const legacy = { ...deleted, data: { ...deleted.data, generatedResults: [{ url: "https://cdn.example/old.mp4", jobId: "j0", width: 854, height: 480 }] } }
      expect(await extendOnly([legacy, extend()])).toBe(await charged("grok-extend:6s:720p"))
    })

    it("reads the same fact the charge reads: never below what the source check charges for the job that made the take", async () => {
      for (const provider of ["grok", "grok-i2v"]) {
        for (const recorded of [undefined, "480p", "480P", "720p"]) {
          const label = `${provider} ${String(recorded)}`
          db.source = {
            id: "job-src", user_id: USER, status: "completed", provider_task_id: TASK, provider_kind: "kie-standard", relay_job_id: null,
            input_data: { provider, ...(recorded !== undefined ? { resolution: recorded } : {}) },
            output_data: { videoUrl: "https://cdn.example/src.mp4", kieTaskId: TASK },
          }
          const checked = await resolveGrokExtendSource({ taskId: TASK, userId: USER })
          if (!checked.ok) throw new Error(`${label}: refused`)
          const charge = await charged(grokExtendCreditId(6, checked.resolution))
          const node = made(recorded, "480p")
          const quote = await extendOnly([{ ...node, data: { ...node.data, provider } }, extend()])
          expect(quote, label).toBeGreaterThanOrEqual(charge)
          // A recorded resolution is quoted at exactly what is charged.
          if (recorded !== undefined) expect(quote, label).toBe(charge)
        }
      }
    })

    it("a source that makes a new clip in the run is quoted at its setting — the clip the run will extend", async () => {
      expect(await quoteOf([made("720p", "480p"), extend()])).toBe(await charged("grok-extend:6s:480p"))
      expect(await quoteOf([made("480p", "720p"), extend()])).toBe(await charged("grok-extend:6s:720p"))
    })

    it("a source that has not run: its setting, 480p as set, else 720p", async () => {
      expect(await extendOnly([source("generate-video", "grok", "480p"), extend()])).toBe(await charged("grok-extend:6s:480p"))
      expect(await extendOnly([source("generate-video", "grok"), extend()])).toBe(await charged("grok-extend:6s:720p"))
    })
  })

  it("quotes the dearer 720p row when the source is not known for sure: nothing wired, no resolution set, an upload, another model", async () => {
    const want = await charged("grok-extend:6s:720p")
    expect(await quoteOf([extend()], [])).toBe(want)
    expect(await quoteOf([source("generate-video", "grok-i2v"), extend()])).toBe(want)
    expect(await quoteOf([source("upload-video", undefined), extend()])).toBe(want)
    expect(await quoteOf([source("generate-video", "seedance-2-5", "480p"), extend()])).toBe(want)
    // A resolution the node names is never the price.
    expect(await quoteOf([extend({ resolution: "480p" })], [])).toBe(want)
  })

  it("is never below what the source check charges the run for the job that wired node makes", async () => {
    // Each Grok Imagine source the node can be set to, as its job records it (`input_data`), and the quote of
    // an extend wired to that node: the quote is the charge, or above it (never below).
    for (const type of ["generate-video", "text-to-video", "image-to-video"]) {
      for (const provider of ["grok", "grok-i2v"]) {
        for (const resolution of [undefined, "480p", "720p", "1080p"]) {
          for (const duration of [6, 10]) {
            const label = `${type} ${provider} ${String(resolution)} ${duration}s`
            db.source = {
              id: "job-src", user_id: USER, status: "completed", provider_task_id: TASK, provider_kind: "kie-standard", relay_job_id: null,
              input_data: { provider, ...(resolution !== undefined ? { resolution } : {}) },
              output_data: { videoUrl: "https://cdn.example/src.mp4", kieTaskId: TASK },
            }
            const checked = await resolveGrokExtendSource({ taskId: TASK, userId: USER })
            const quote = await quoteOf([source(type, provider, resolution), extend({ duration })])
            if (!checked.ok) {
              // A source the check refuses (1080p) is never charged; it is still quoted at the dearer row.
              expect(quote, label).toBe(await charged(grokExtendCreditId(duration)))
              continue
            }
            const charge = await charged(grokExtendCreditId(duration, checked.resolution))
            expect(quote, label).toBeGreaterThanOrEqual(charge)
            // Set to a resolution: quoted at exactly what is charged.
            if (resolution === "480p" || resolution === "720p") expect(quote, label).toBe(charge)
          }
        }
      }
    }
  })
})
