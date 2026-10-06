import { describe, it, expect, vi } from "vitest"

vi.mock("../supabase.js", () => ({ supabase: {} }))

import {
  jobFactsFromRow,
  resolveRunStateStamps,
  type CanvasResultQuery,
  type FetchJobFacts,
  type JobFacts,
  type RunStateLike,
} from "../canvas-result-ids.js"

/**
 * An earlier execution's node states, handed to a CONTINUED run as its seeds
 * (A6.2). A render that execution made before renders were labelled carries a
 * real job id and no `quality`, so the stop rule would read a preview it hands
 * on as a final. The rule `resolveCanvasResultIds` applies to a saved canvas
 * applies here too — exact and unique, never positional: a state's job, by id,
 * whose output URL is the result's URL.
 */

const OWNER = "00000000-0000-4000-8000-0000000e9001"
const OTHER = "00000000-0000-4000-8000-0000000e9002"
const id = (n: string) => `f0000000-0000-4000-8000-0000000e9${n}`

const render = (
  n: string,
  url: string,
  extra: { user?: string; type?: string; input?: Record<string, unknown>; output?: Record<string, unknown> } = {},
): JobFacts =>
  jobFactsFromRow({
    id: id(n),
    user_id: extra.user ?? OWNER,
    status: "completed",
    job_type: extra.type ?? "apply-edl",
    input_data: { node_id: "cut", ...(extra.input ?? {}) },
    output_data: { videoUrl: url, ...(extra.output ?? {}) },
  })

function fetcher(jobs: readonly JobFacts[]): { fetch: FetchJobFacts; calls: CanvasResultQuery[] } {
  const calls: CanvasResultQuery[] = []
  return {
    calls,
    fetch: async (owner, query) => {
      calls.push(query)
      return jobs.filter((j) => j.userId === owner && query.jobIds.includes(j.id))
    },
  }
}

const isRender = (nodeId: string) => nodeId === "cut"

describe("resolveRunStateStamps: an unlabelled render in an earlier run's states", () => {
  it("stamps a single take from its job: the order's quality when the worker wrote none", async () => {
    const { fetch } = fetcher([render("001", "https://r2/p.mp4", { input: { quality: "proxy" } })])
    const states: Record<string, RunStateLike> = { cut: { status: "completed", jobId: id("001"), output: { videoUrl: "https://r2/p.mp4" } } }
    const out = await resolveRunStateStamps(states, isRender, OWNER, { fetchJobs: fetch })
    expect(out.cut.output).toEqual({ videoUrl: "https://r2/p.mp4", quality: "proxy" })
  })

  it("stamps each row of a batch by its own URL, never by position", async () => {
    const { fetch } = fetcher([
      render("001", "https://r2/a.mp4", { output: { quality: "final", clipKey: "0-4000" } }),
      render("002", "https://r2/b.mp4", { input: { quality: "proxy" } }),
    ])
    const states: Record<string, RunStateLike> = {
      cut: {
        status: "completed",
        jobId: id("001"),
        // creation order, not row order
        jobIds: [id("002"), id("001")],
        output: { videoUrl: "https://r2/a.mp4", listResults: ["https://r2/a.mp4", "", "https://r2/b.mp4"] },
      },
    }
    const out = await resolveRunStateStamps(states, isRender, OWNER, { fetchJobs: fetch })
    expect(out.cut.output?.quality).toBe("final")
    expect(out.cut.output?.listResultStamps).toEqual([
      { jobId: id("001"), quality: "final", clipKey: "0-4000" },
      {},
      { jobId: id("002"), quality: "proxy" },
    ])
  })

  it("asks nothing when every render already carries its stamp", async () => {
    const { fetch, calls } = fetcher([])
    const states: Record<string, RunStateLike> = {
      cut: { status: "completed", jobId: id("001"), output: { videoUrl: "https://r2/p.mp4", quality: "proxy" } },
      plan: { status: "completed", jobId: id("009"), output: { json: {} } as RunStateLike["output"] },
    }
    const out = await resolveRunStateStamps(states, isRender, OWNER, { fetchJobs: fetch })
    expect(calls).toEqual([])
    expect(out).toBe(states)
  })

  it("leaves a result as it is when the URL is not that job's output, or the job is not the owner's render", async () => {
    const { fetch } = fetcher([
      render("001", "https://r2/other.mp4", { input: { quality: "proxy" } }),
      render("002", "https://r2/p2.mp4", { user: OTHER, input: { quality: "proxy" } }),
      render("003", "https://r2/p3.mp4", { type: "combine-videos" }),
    ])
    for (const [n, url] of [["001", "https://r2/p.mp4"], ["002", "https://r2/p2.mp4"], ["003", "https://r2/p3.mp4"]] as const) {
      const states: Record<string, RunStateLike> = { cut: { status: "completed", jobId: id(n), output: { videoUrl: url } } }
      const out = await resolveRunStateStamps(states, isRender, OWNER, { fetchJobs: fetch })
      expect(out.cut.output?.quality).toBeUndefined()
    }
  })

  it("a failed lookup never fails the run: the states go on as stored", async () => {
    const states: Record<string, RunStateLike> = { cut: { status: "completed", jobId: id("001"), output: { videoUrl: "https://r2/p.mp4" } } }
    const out = await resolveRunStateStamps(states, isRender, OWNER, {
      fetchJobs: async () => {
        throw new Error("down")
      },
    })
    expect(out).toBe(states)
  })
})
