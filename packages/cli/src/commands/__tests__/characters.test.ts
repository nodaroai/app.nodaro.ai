import { describe, it, expect, vi, beforeEach } from "vitest"
import { Command } from "commander"
import { charactersCommand } from "../characters.js"

/**
 * `nodaro characters list` — the flags reach `client.characters.list` as the
 * SDK's params. `handleError` rethrows instead of exiting, so a refusal is a
 * normal rejection here.
 */
const mocks = { list: vi.fn() }

vi.mock("../../client.js", () => ({
  buildClient: () => ({ characters: { list: mocks.list } }),
  handleError: (err: unknown) => {
    throw err
  },
}))

vi.mock("../../output.js", async () => {
  const actual = await vi.importActual<typeof import("../../output.js")>("../../output.js")
  return { ...actual, emit: vi.fn(), success: vi.fn(), info: vi.fn(), dim: vi.fn(), warn: vi.fn(), table: vi.fn() }
})

async function runCmd(...args: string[]): Promise<void> {
  const program = new Command()
  program.addCommand(charactersCommand())
  // On every command, not just the root: a usage error (an option conflict)
  // is raised by the leaf command, which would otherwise call process.exit.
  const throwInsteadOfExit = (cmd: Command): void => {
    cmd.exitOverride()
    cmd.commands.forEach(throwInsteadOfExit)
  }
  throwInsteadOfExit(program)
  await program.parseAsync(["node", "test", ...args])
}

describe("characters list", () => {
  beforeEach(() => {
    mocks.list.mockReset()
    mocks.list.mockResolvedValue({ characters: [], nextCursor: null })
  })

  it("asks for the default list when no flag is given", async () => {
    await runCmd("characters", "list", "--json")
    expect(mocks.list).toHaveBeenCalledWith({ projectId: undefined, archived: undefined, q: undefined, limit: undefined })
  })

  it("--search forwards the text as q, beside the other flags", async () => {
    await runCmd("characters", "list", "--search", "Maya (v2)", "--project", "prj-1", "--archived", "--limit", "20", "--json")
    expect(mocks.list).toHaveBeenCalledWith({ projectId: "prj-1", archived: true, q: "Maya (v2)", limit: 20 })
  })

  it("--q is the same as --search (the spelling saved-posts, collections and community use)", async () => {
    await runCmd("characters", "list", "--q", "red car", "--json")
    expect(mocks.list).toHaveBeenCalledWith({ projectId: undefined, archived: undefined, q: "red car", limit: undefined })
  })

  it("refuses --search and --q together", async () => {
    await expect(runCmd("characters", "list", "--search", "a", "--q", "b", "--json")).rejects.toThrow(/cannot be used with/)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it("refuses a --limit that is not a positive integer", async () => {
    await expect(runCmd("characters", "list", "--limit", "0", "--json")).rejects.toThrow(/--limit/)
    expect(mocks.list).not.toHaveBeenCalled()
  })
})
