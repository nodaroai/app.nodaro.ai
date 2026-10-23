/**
 * `nodaro jobs get` is the CLI's job reader for EVERY node type — it prints
 * the settled row verbatim rather than a per-node summary, which is why a new
 * output field reaches the CLI without a new command.
 *
 * This test exists so that stays true: the day someone shapes or allowlists
 * the printed output, a 3D Render Pro caller stops seeing the shot stills, and
 * this fails instead of the user finding out.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Command } from "commander"
import { jobsCommand } from "../jobs.js"

const mocks = { get: vi.fn(), list: vi.fn(), rate: vi.fn() }
vi.mock("../../client.js", () => ({
  buildClient: () => ({ jobs: { get: mocks.get, list: mocks.list, rate: mocks.rate } }),
  handleError: (err: unknown) => { throw err },
}))

const SHOT_STILLS = [
  { shotIndex: 0, frame: 0, assetId: "still-0", url: "https://cdn.example/still-0.png" },
  { shotIndex: 1, frame: 360, assetId: "still-1", url: "https://cdn.example/still-1.png" },
]

let printed: string[]
beforeEach(() => {
  vi.clearAllMocks()
  printed = []
  vi.spyOn(console, "log").mockImplementation((line: unknown) => { printed.push(String(line)) })
  // `--json` writes straight to stdout; the human path goes through console.log.
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => { printed.push(String(chunk)); return true })
  mocks.get.mockResolvedValue({ data: {
    id: "pro-job", status: "completed", job_type: "pro-3d-render",
    output_data: { videoUrl: "https://cdn.example/pro.mp4", shotStills: SHOT_STILLS },
  } })
})
afterEach(() => { vi.restoreAllMocks() })

const run = (argv: string[]) =>
  new Command().addCommand(jobsCommand()).parseAsync(["node", "nodaro", ...argv])

describe("nodaro jobs get", () => {
  it("prints a 3D Render Pro result's shot stills, in shot order", async () => {
    await run(["jobs", "get", "pro-job"])
    const parsed = JSON.parse(printed.join("\n"))
    expect(parsed.output_data.shotStills).toEqual(SHOT_STILLS)
  })

  it("prints the same stills in --json mode", async () => {
    await run(["jobs", "get", "pro-job", "--json"])
    expect(JSON.parse(printed.join("\n")).output_data.shotStills).toEqual(SHOT_STILLS)
  })
})

describe("nodaro jobs list", () => {
  const PAGE = {
    data: [
      { id: "j1", status: "completed", input_data: { type: "generate-image" }, favorited: true, rating: "good", created_at: "2026-10-15T00:00:01Z" },
      { id: "j2", status: "failed", input_data: { type: "generate-video" }, favorited: false, rating: null, created_at: "2026-10-15T00:00:00Z" },
    ],
    next: "2026-10-15T00:00:00Z",
  }

  it("forwards every filter, splitting status and type lists on commas", async () => {
    mocks.list.mockResolvedValueOnce(PAGE)
    await run([
      "jobs", "list",
      "--status", "failed,cancelled",
      "--type", "generate-image, generate-video",
      "--origin", "studio",
      "--source", "mcp, cli",
      "--favorited",
      "--rating", "unrated",
      "--limit", "10",
      "--cursor", "2026-10-14T00:00:00Z",
      "--json",
    ])
    expect(mocks.list).toHaveBeenCalledWith({
      status: ["failed", "cancelled"],
      type: ["generate-image", "generate-video"],
      origin: "studio",
      source: ["mcp", "cli"],
      favorited: true,
      rating: "unrated",
      limit: 10,
      cursor: "2026-10-14T00:00:00Z",
    })
    expect(JSON.parse(printed.join("\n"))).toEqual(PAGE)
  })

  it("sends no filter it was not given", async () => {
    mocks.list.mockResolvedValueOnce({ data: [], next: null })
    await run(["jobs", "list", "--json"])
    expect(mocks.list).toHaveBeenCalledWith({
      status: undefined,
      type: undefined,
      origin: undefined,
      source: undefined,
      favorited: undefined,
      rating: undefined,
      limit: undefined,
      cursor: undefined,
    })
  })

  it("--no-favorited asks for the jobs you did NOT favorite, and --favorited for the ones you did", async () => {
    mocks.list.mockResolvedValue({ data: [], next: null })
    await run(["jobs", "list", "--no-favorited", "--json"])
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ favorited: false }))
    await run(["jobs", "list", "--favorited", "--json"])
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ favorited: true }))
  })

  it("prints a table with each job's type, favorite and rating, and the next cursor", async () => {
    mocks.list.mockResolvedValueOnce(PAGE)
    await run(["jobs", "list"])
    const out = printed.join("\n")
    expect(out).toContain("j1")
    expect(out).toContain("generate-video")
    expect(out).toContain("good")
    expect(out).toContain("--cursor 2026-10-15T00:00:00Z")
  })

  it("refuses an unknown rating filter before calling the API", async () => {
    await expect(run(["jobs", "list", "--rating", "meh"])).rejects.toThrow(/--rating/)
    expect(mocks.list).not.toHaveBeenCalled()
  })
})

describe("nodaro jobs rate", () => {
  it("rates good or bad, and clear sends null", async () => {
    mocks.rate.mockResolvedValue({ data: { jobId: "j1", rating: "good" } })
    await run(["jobs", "rate", "j1", "good"])
    expect(mocks.rate).toHaveBeenLastCalledWith("j1", "good")
    await run(["jobs", "rate", "j1", "bad"])
    expect(mocks.rate).toHaveBeenLastCalledWith("j1", "bad")
    await run(["jobs", "rate", "j1", "clear"])
    expect(mocks.rate).toHaveBeenLastCalledWith("j1", null)
  })

  it("refuses anything but good, bad or clear, without calling the API", async () => {
    await expect(run(["jobs", "rate", "j1", "meh"])).rejects.toThrow(/good, bad or clear/)
    expect(mocks.rate).not.toHaveBeenCalled()
  })

  it("prints the result in --json mode", async () => {
    mocks.rate.mockResolvedValueOnce({ data: { jobId: "j1", rating: null } })
    await run(["jobs", "rate", "j1", "clear", "--json"])
    expect(JSON.parse(printed.join("\n"))).toEqual({ data: { jobId: "j1", rating: null } })
  })
})
