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
  run: vi.fn(),
}

vi.mock("../../client.js", () => ({
  buildClient: () => ({
    workflows: {
      setVisibility: mocks.setVisibility,
      move: mocks.move,
      sharedWithMe: mocks.sharedWithMe,
      run: mocks.run,
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

describe("workflows run — continuing an earlier execution", () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset()
    mocks.run.mockResolvedValue({ executionId: "ex-new", status: "pending" })
  })

  it("--continue-from --from-failed resumes the failed run; nodes may be left out", async () => {
    await runCmd("workflows", "run", "wf-1", "--continue-from", "ex-failed", "--from-failed", "--json")
    expect(mocks.run).toHaveBeenCalledWith("wf-1", { continueFromExecutionId: "ex-failed", continueMode: "from-failed" })
  })

  it("says where a continuation's states came from when the server built it on a later continuation", async () => {
    const { dim } = await import("../../output.js")
    mocks.run.mockResolvedValue({ executionId: "ex-new", status: "pending", continuedFrom: "ex-later" })
    await runCmd("workflows", "run", "wf-1", "--continue-from", "ex-failed", "--from-failed")
    expect(vi.mocked(dim)).toHaveBeenCalledWith(expect.stringContaining("continued from ex-later"))
    vi.mocked(dim).mockClear()
    mocks.run.mockResolvedValue({ executionId: "ex-new", status: "pending", continuedFrom: "ex-failed" })
    await runCmd("workflows", "run", "wf-1", "--continue-from", "ex-failed", "--from-failed")
    expect(vi.mocked(dim)).not.toHaveBeenCalledWith(expect.stringContaining("continued from"))
  })

  it("--from-failed keeps --node as the nodes to consider", async () => {
    await runCmd("workflows", "run", "wf-1", "--continue-from", "ex-failed", "--from-failed", "--node", "a", "b", "--json")
    expect(mocks.run).toHaveBeenCalledWith("wf-1", { nodeIds: ["a", "b"], continueFromExecutionId: "ex-failed", continueMode: "from-failed" })
  })

  it("--continue-from alone is a plain continuation of the named nodes", async () => {
    await runCmd("workflows", "run", "wf-1", "--continue-from", "ex-done", "--node", "cut", "--json")
    expect(mocks.run).toHaveBeenCalledWith("wf-1", { nodeIds: ["cut"], continueFromExecutionId: "ex-done" })
  })

  it("--idempotency-key is sent as the run's Idempotency-Key", async () => {
    await runCmd("workflows", "run", "wf-1", "--continue-from", "ex-failed", "--from-failed", "--idempotency-key", "retry-key-1", "--json")
    expect(mocks.run).toHaveBeenCalledWith("wf-1", { continueFromExecutionId: "ex-failed", continueMode: "from-failed" }, { idempotencyKey: "retry-key-1" })
  })

  it("an --idempotency-key shorter than the server reads is refused locally", async () => {
    await expect(runCmd("workflows", "run", "wf-1", "--idempotency-key", "short")).rejects.toThrow(/at least 8 characters/)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it("--from-failed without --continue-from is refused locally", async () => {
    await expect(runCmd("workflows", "run", "wf-1", "--from-failed")).rejects.toThrow(/--continue-from/)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it("a plain run sends nothing extra", async () => {
    await runCmd("workflows", "run", "wf-1", "--json")
    expect(mocks.run).toHaveBeenCalledWith("wf-1", {})
  })
})
