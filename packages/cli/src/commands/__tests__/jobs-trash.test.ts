/**
 * `nodaro jobs delete | restore`, the session filters of `nodaro jobs list`,
 * and `nodaro trash` — each passes exactly what it was given to the SDK.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { Command } from "commander"
import { jobsCommand } from "../jobs.js"
import { trashCommand } from "../trash.js"

const jobs = { list: vi.fn(), delete: vi.fn(), restore: vi.fn() }
const trash = { list: vi.fn() }

vi.mock("../../client.js", () => ({
  buildClient: () => ({ jobs, trash }),
  handleError: (err: unknown) => {
    throw err
  },
}))

vi.mock("../../output.js", async () => {
  const actual = await vi.importActual<typeof import("../../output.js")>("../../output.js")
  return { ...actual, emit: vi.fn(), success: vi.fn(), table: vi.fn(), dim: vi.fn(), detail: vi.fn() }
})

const run = (...argv: string[]) => {
  const program = new Command().exitOverride()
  program.addCommand(jobsCommand())
  program.addCommand(trashCommand())
  return program.parseAsync(["node", "nodaro", ...argv])
}

beforeEach(() => {
  for (const m of [...Object.values(jobs), ...Object.values(trash)]) m.mockReset()
  jobs.list.mockResolvedValue({ data: [], next: null })
  trash.list.mockResolvedValue({ data: [], next: null })
})

describe("nodaro jobs", () => {
  it("delete sends a job to the Trash; --forever deletes it for good", async () => {
    jobs.delete.mockResolvedValue({ success: true })
    await run("jobs", "delete", "j1")
    expect(jobs.delete).toHaveBeenLastCalledWith("j1", { forever: undefined })
    await run("jobs", "delete", "j1", "--forever")
    expect(jobs.delete).toHaveBeenLastCalledWith("j1", { forever: true })
  })

  it("restore brings a job back", async () => {
    jobs.restore.mockResolvedValue({ success: true })
    await run("jobs", "restore", "j1")
    expect(jobs.restore).toHaveBeenCalledWith("j1")
  })

  it("list --project / --with-sessions reach the SDK", async () => {
    await run("jobs", "list", "--project", "none", "--with-sessions")
    expect(jobs.list).toHaveBeenCalledWith(expect.objectContaining({ projectId: "none", withSessions: true, inSession: undefined }))
  })

  it("list --no-in-session asks for General, --in-session for jobs in a session", async () => {
    await run("jobs", "list", "--no-in-session")
    expect(jobs.list).toHaveBeenLastCalledWith(expect.objectContaining({ inSession: false }))
    await run("jobs", "list", "--in-session")
    expect(jobs.list).toHaveBeenLastCalledWith(expect.objectContaining({ inSession: true }))
  })

  it("list without the flags sends none of them", async () => {
    await run("jobs", "list")
    expect(jobs.list).toHaveBeenCalledWith(expect.objectContaining({ projectId: undefined, inSession: undefined, withSessions: undefined }))
  })
})

describe("nodaro trash", () => {
  it("lists the Trash with its scope", async () => {
    await run("trash", "--project", "p1", "--tool", "create-image", "--type", "generate-image")
    expect(trash.list).toHaveBeenCalledWith({ projectId: "p1", tool: "create-image", type: "generate-image", limit: undefined, cursor: undefined })
  })

  it("`trash list` is the same command", async () => {
    await run("trash", "list", "--limit", "5")
    expect(trash.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 5 }))
  })
})
