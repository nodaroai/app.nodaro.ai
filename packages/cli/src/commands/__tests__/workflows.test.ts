import { describe, it, expect, vi, beforeEach } from "vitest"
import { Command } from "commander"
import { workflowsCommand } from "../workflows.js"

/**
 * P11 CLI subcommands — share / move / shared-with-me / collaborators. The
 * commands are thin wrappers over the (separately tested) SDK, so these tests
 * pin the wiring that lives ONLY in the CLI: argument shaping and the two
 * local validations (exactly-one-of user/email, and the role/visibility enums).
 */
const mocks = {
  setVisibility: vi.fn(),
  move: vi.fn(),
  sharedWithMe: vi.fn(),
  collabList: vi.fn(),
  collabAdd: vi.fn(),
  collabUpdate: vi.fn(),
  collabRemove: vi.fn(),
}

vi.mock("../../client.js", () => ({
  buildClient: () => ({
    workflows: {
      setVisibility: mocks.setVisibility,
      move: mocks.move,
      sharedWithMe: mocks.sharedWithMe,
      collaborators: {
        list: mocks.collabList,
        add: mocks.collabAdd,
        update: mocks.collabUpdate,
        remove: mocks.collabRemove,
      },
    },
  }),
  handleError: (err: unknown) => {
    throw err
  },
}))

vi.mock("../../output.js", async () => {
  const actual = await vi.importActual<typeof import("../../output.js")>("../../output.js")
  return { ...actual, emit: vi.fn(), success: vi.fn(), info: vi.fn(), dim: vi.fn(), warn: vi.fn(), table: vi.fn() }
})

async function runCmd(...args: string[]): Promise<void> {
  const program = new Command().exitOverride()
  program.addCommand(workflowsCommand())
  await program.parseAsync(["node", "test", ...args])
}

describe("workflows command — P11 subcommands", () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset()
  })

  it("share defaults to workspace visibility", async () => {
    mocks.setVisibility.mockResolvedValueOnce({ data: { id: "wf-1" } })
    await runCmd("workflows", "share", "wf-1", "--json")
    expect(mocks.setVisibility).toHaveBeenCalledWith("wf-1", "workspace")
  })

  it("share --visibility private is forwarded", async () => {
    mocks.setVisibility.mockResolvedValueOnce({ data: { id: "wf-1" } })
    await runCmd("workflows", "share", "wf-1", "--visibility", "private", "--json")
    expect(mocks.setVisibility).toHaveBeenCalledWith("wf-1", "private")
  })

  it("share rejects an unknown visibility", async () => {
    await expect(runCmd("workflows", "share", "wf-1", "--visibility", "public")).rejects.toThrow(/workspace.*private/)
    expect(mocks.setVisibility).not.toHaveBeenCalled()
  })

  it("move forwards the destination project", async () => {
    mocks.move.mockResolvedValueOnce({ data: { id: "wf-1" }, droppedCollaborators: [] })
    await runCmd("workflows", "move", "wf-1", "--project", "proj-2", "--json")
    expect(mocks.move).toHaveBeenCalledWith("wf-1", { projectId: "proj-2" })
  })

  it("shared-with-me calls the SDK", async () => {
    mocks.sharedWithMe.mockResolvedValueOnce({ data: [] })
    await runCmd("workflows", "shared-with-me", "--json")
    expect(mocks.sharedWithMe).toHaveBeenCalledTimes(1)
  })

  it("collaborators add by email forwards email + role", async () => {
    mocks.collabAdd.mockResolvedValueOnce({ data: { userId: "u2", role: "editor" } })
    await runCmd("workflows", "collaborators", "add", "wf-1", "--email", "dana@example.com", "--role", "editor", "--json")
    expect(mocks.collabAdd).toHaveBeenCalledWith("wf-1", { email: "dana@example.com", role: "editor" })
  })

  it("collaborators add rejects giving BOTH user and email", async () => {
    await expect(
      runCmd("workflows", "collaborators", "add", "wf-1", "--user", "u2", "--email", "d@e.com", "--role", "editor"),
    ).rejects.toThrow(/exactly one/)
    expect(mocks.collabAdd).not.toHaveBeenCalled()
  })

  it("collaborators add rejects an unknown role", async () => {
    await expect(
      runCmd("workflows", "collaborators", "add", "wf-1", "--user", "u2", "--role", "owner"),
    ).rejects.toThrow(/viewer.*editor/)
    expect(mocks.collabAdd).not.toHaveBeenCalled()
  })

  it("collaborators update forwards the per-user role", async () => {
    mocks.collabUpdate.mockResolvedValueOnce({ data: { userId: "u2", role: "viewer" } })
    await runCmd("workflows", "collaborators", "update", "wf-1", "u2", "--role", "viewer", "--json")
    expect(mocks.collabUpdate).toHaveBeenCalledWith("wf-1", "u2", { role: "viewer" })
  })

  it("collaborators remove forwards workflow + user", async () => {
    mocks.collabRemove.mockResolvedValueOnce({ success: true })
    await runCmd("workflows", "collaborators", "remove", "wf-1", "u2", "--json")
    expect(mocks.collabRemove).toHaveBeenCalledWith("wf-1", "u2")
  })
})
