import { describe, it, expect, vi, beforeEach } from "vitest"
import { Command } from "commander"
import { sessionsCommand } from "../sessions.js"

const mocks = {
  list: vi.fn(),
  get: vi.fn(),
  items: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  importItems: vi.fn(),
  removeItem: vi.fn(),
  delete: vi.fn(),
}

vi.mock("../../client.js", () => ({
  buildClient: () => ({ sessions: mocks }),
  handleError: (err: unknown) => {
    throw err
  },
}))

vi.mock("../../output.js", async () => {
  const actual = await vi.importActual<typeof import("../../output.js")>("../../output.js")
  return { ...actual, emit: vi.fn(), success: vi.fn(), table: vi.fn(), dim: vi.fn(), detail: vi.fn() }
})

const SESSION = { id: "s1", projectId: null, title: "Beach", tool: "create-image", createdAt: "", updatedAt: "", archivedAt: null, itemCount: 0, previewUrls: [] }

async function runCmd(...args: string[]): Promise<void> {
  const program = new Command().exitOverride()
  program.addCommand(sessionsCommand())
  await program.parseAsync(["node", "test", ...args])
}

describe("sessions command", () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset()
  })

  it("list forwards the filters", async () => {
    mocks.list.mockResolvedValueOnce({ data: [], next: null })
    await runCmd("sessions", "list", "--project", "p1", "--tool", "create-image", "--archived", "--limit", "5", "--json")
    expect(mocks.list).toHaveBeenCalledWith({ projectId: "p1", tool: "create-image", includeArchived: true, limit: 5, cursor: undefined })
  })

  it("create sends the tool, project and title", async () => {
    mocks.create.mockResolvedValueOnce({ data: SESSION })
    await runCmd("sessions", "create", "--tool", "create-image", "--project", "p1", "--title", "Beach")
    expect(mocks.create).toHaveBeenCalledWith({ tool: "create-image", projectId: "p1", title: "Beach" })
  })

  it("update archives, and clears a title with --untitled", async () => {
    mocks.update.mockResolvedValue({ data: SESSION })
    await runCmd("sessions", "update", "s1", "--archive")
    expect(mocks.update).toHaveBeenLastCalledWith("s1", { title: undefined, archived: true, coverJobId: undefined })
    await runCmd("sessions", "update", "s1", "--untitled")
    expect(mocks.update).toHaveBeenLastCalledWith("s1", { title: null, archived: undefined, coverJobId: undefined })
  })

  it("update picks a cover with --cover, and goes back to automatic with --auto-cover", async () => {
    mocks.update.mockResolvedValue({ data: SESSION })
    await runCmd("sessions", "update", "s1", "--cover", "j1")
    expect(mocks.update).toHaveBeenLastCalledWith("s1", { title: undefined, archived: undefined, coverJobId: "j1" })
    await runCmd("sessions", "update", "s1", "--auto-cover")
    expect(mocks.update).toHaveBeenLastCalledWith("s1", { title: undefined, archived: undefined, coverJobId: null })
  })

  it("update with nothing to change refuses without calling the API", async () => {
    await expect(runCmd("sessions", "update", "s1")).rejects.toThrow(/nothing to update/)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("import splits the job list on commas and spaces", async () => {
    mocks.importItems.mockResolvedValueOnce({ data: { imported: 3, requested: 3 } })
    await runCmd("sessions", "import", "s1", "--jobs", "j1,j2 j3")
    expect(mocks.importItems).toHaveBeenCalledWith("s1", { jobIds: ["j1", "j2", "j3"] })
  })

  it("remove and delete call the API with the ids", async () => {
    mocks.removeItem.mockResolvedValueOnce({ success: true })
    mocks.delete.mockResolvedValueOnce({ success: true })
    await runCmd("sessions", "remove", "s1", "j1")
    await runCmd("sessions", "delete", "s1")
    expect(mocks.removeItem).toHaveBeenCalledWith("s1", "j1")
    expect(mocks.delete).toHaveBeenCalledWith("s1")
  })
})
