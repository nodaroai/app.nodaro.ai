/**
 * `nodaro jobs rename <id> <title>` and `--clear`: the CLI's way to the one
 * SDK call, with the same shape the SDK test pins (a name, or null to clear).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Command } from "commander"
import { jobsCommand } from "../jobs.js"

const mocks = { rename: vi.fn() }
vi.mock("../../client.js", () => ({
  buildClient: () => ({ jobs: { rename: mocks.rename } }),
  handleError: (err: unknown) => { throw err },
}))

let printed: string[]
beforeEach(() => {
  vi.clearAllMocks()
  printed = []
  vi.spyOn(console, "log").mockImplementation((line: unknown) => { printed.push(String(line)) })
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => { printed.push(String(chunk)); return true })
})
afterEach(() => { vi.restoreAllMocks() })

const run = (argv: string[]) =>
  new Command().exitOverride().addCommand(jobsCommand()).parseAsync(["node", "nodaro", ...argv])

describe("nodaro jobs rename", () => {
  it("sends the name and says what the job is called now", async () => {
    mocks.rename.mockResolvedValue({ data: { jobId: "job-1", title: "Hero shot v2" } })
    await run(["jobs", "rename", "job-1", "Hero shot v2"])
    expect(mocks.rename).toHaveBeenCalledWith("job-1", "Hero shot v2")
    expect(printed.join("\n")).toContain("Hero shot v2")
  })

  it("--clear sends null", async () => {
    mocks.rename.mockResolvedValue({ data: { jobId: "job-1", title: null } })
    await run(["jobs", "rename", "job-1", "--clear"])
    expect(mocks.rename).toHaveBeenCalledWith("job-1", null)
    expect(printed.join("\n")).toContain("cleared")
  })

  it("--json prints the answer as sent", async () => {
    mocks.rename.mockResolvedValue({ data: { jobId: "job-1", title: "Hero shot v2" } })
    await run(["jobs", "rename", "job-1", "Hero shot v2", "--json"])
    expect(JSON.parse(printed.join("\n"))).toEqual({ data: { jobId: "job-1", title: "Hero shot v2" } })
  })

  it("refuses a call with neither a name nor --clear, before any request", async () => {
    await expect(run(["jobs", "rename", "job-1"])).rejects.toThrow("--clear")
    expect(mocks.rename).not.toHaveBeenCalled()
  })
})
