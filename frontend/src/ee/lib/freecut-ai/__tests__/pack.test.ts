import { beforeEach, describe, expect, it, vi } from "vitest"

const api = vi.hoisted(() => ({
  answer: { jobId: "job-pack", tools: [] as Array<{ tool: string; jobId: string; executionId: string | null }>, notStarted: undefined as undefined | Array<{ tool: string; error: { code: string; message: string } }> },
  executionStatus: 403 as number | null,
}))

vi.mock("@/lib/api", () => ({
  podcastPack: vi.fn(async () => api.answer),
  getWorkflowExecution: vi.fn(async () => {
    throw Object.assign(new Error("forbidden"), { status: api.executionStatus })
  }),
  getJobStatusLean: vi.fn(async () => ({ status: "completed", output_data: { plan: { version: 1, chapters: [{ startMs: 0, title: "Start" }] } } })),
  cancelJob: vi.fn(),
  InsufficientCreditsError: class extends Error {},
}))

import { podcastPack } from "@/lib/api"
import { JobFailed } from "../run/jobs"
import { packUnits, startPack } from "../run/pack"
import type { RunContext } from "../run/context"

const ctx = () => ({ signal: new AbortController().signal }) as unknown as RunContext

beforeEach(() => {
  vi.clearAllMocks()
  api.answer = { jobId: "job-pack", tools: [], notStarted: undefined }
})

describe("the podcast pack behind Edit with AI", () => {
  it("counts every started 15 seconds, at least one, as the server does", () => {
    expect(packUnits(1)).toBe(1)
    expect(packUnits(15)).toBe(1)
    expect(packUnits(60)).toBe(4)
    expect(packUnits(60.000000001)).toBe(4)
    expect(packUnits(61)).toBe(5)
  })

  it("starts nothing when nothing is asked", () => {
    expect(startPack(ctx(), "https://cdn.example.com/v.mp4", { trailer: false, chapters: false })).toEqual({})
    expect(podcastPack).not.toHaveBeenCalled()
  })

  it("reads a tool's plan from its job when its run cannot be read", async () => {
    api.answer.tools = [{ tool: "episode-chapters", jobId: "job-ch", executionId: "exec-ch" }]
    const plans = startPack(ctx(), "https://cdn.example.com/v.mp4", { chapters: true })
    await expect(plans.chapters).resolves.toMatchObject({ chapters: [{ title: "Start" }] })
  })

  it("fails only a tool the pack could not start, with the server's reason", async () => {
    api.answer.tools = [{ tool: "episode-chapters", jobId: "job-ch", executionId: null }]
    api.answer.notStarted = [{ tool: "episode-trailer", error: { code: "tool_refused", message: "Trailer: needs a picture" } }]
    const plans = startPack(ctx(), "https://cdn.example.com/v.mp4", { trailer: true, chapters: true })
    await expect(plans.trailer).rejects.toBeInstanceOf(JobFailed)
    await expect(plans.trailer).rejects.toThrow("Trailer: needs a picture")
    await expect(plans.chapters).resolves.toBeTruthy()
  })
})
