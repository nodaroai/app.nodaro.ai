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

const mocks = { get: vi.fn() }
vi.mock("../../client.js", () => ({
  buildClient: () => ({ jobs: { get: mocks.get } }),
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
