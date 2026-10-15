import { describe, it, expect, vi, beforeEach } from "vitest"
import { Command } from "commander"
import { charactersCommand } from "../characters.js"
import { emit, success } from "../../output.js"

/**
 * `nodaro characters …` — the flags reach the SDK as its params. `handleError`
 * rethrows instead of exiting, so a refusal is a normal rejection here.
 *
 * `list`: the search flags reach `client.characters.list` as `q`.
 * Character training (Nodaro Cloud): `train`, `training` and `delete-lora` are
 * thin wrappers over the SDK. These pin the wiring that lives only in the CLI —
 * repeated `--image` flags shaped into `selectedImageUrls`, which status a
 * `--watch` follows, and what `--json` prints.
 */
const characters = {
  list: vi.fn(),
  train: vi.fn(),
  trainingStatus: vi.fn(),
  deleteLora: vi.fn(),
}
const jobs = { get: vi.fn() }

vi.mock("../../client.js", () => ({
  buildClient: () => ({ characters, jobs }),
  handleError: (err: unknown) => {
    throw err
  },
}))

vi.mock("../../output.js", async () => {
  const actual = await vi.importActual<typeof import("../../output.js")>("../../output.js")
  return {
    ...actual,
    emit: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    dim: vi.fn(),
    warn: vi.fn(),
    detail: vi.fn(),
    table: vi.fn(),
  }
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
    characters.list.mockReset()
    characters.list.mockResolvedValue({ characters: [], nextCursor: null })
  })

  it("asks for the default list when no flag is given", async () => {
    await runCmd("characters", "list", "--json")
    expect(characters.list).toHaveBeenCalledWith({ projectId: undefined, archived: undefined, q: undefined, limit: undefined })
  })

  it("--search forwards the text as q, beside the other flags", async () => {
    await runCmd("characters", "list", "--search", "Maya (v2)", "--project", "prj-1", "--archived", "--limit", "20", "--json")
    expect(characters.list).toHaveBeenCalledWith({ projectId: "prj-1", archived: true, q: "Maya (v2)", limit: 20 })
  })

  it("--q is the same as --search (the spelling saved-posts, collections and community use)", async () => {
    await runCmd("characters", "list", "--q", "red car", "--json")
    expect(characters.list).toHaveBeenCalledWith({ projectId: undefined, archived: undefined, q: "red car", limit: undefined })
  })

  it("refuses --search and --q together", async () => {
    await expect(runCmd("characters", "list", "--search", "a", "--q", "b", "--json")).rejects.toThrow(/cannot be used with/)
    expect(characters.list).not.toHaveBeenCalled()
  })

  it("refuses a --limit that is not a positive integer", async () => {
    await expect(runCmd("characters", "list", "--limit", "0", "--json")).rejects.toThrow(/--limit/)
    expect(characters.list).not.toHaveBeenCalled()
  })
})

const STARTED = { jobId: "job-1", trainingId: "rep-1", triggerWord: "TOK_kira_a1b2c3" }

describe("characters train", () => {
  beforeEach(() => {
    for (const m of [...Object.values(characters), jobs.get]) m.mockReset()
    vi.mocked(emit).mockReset()
    vi.mocked(success).mockReset()
  })

  it("trains on every eligible image when no --image is given", async () => {
    characters.train.mockResolvedValueOnce(STARTED)
    await runCmd("characters", "train", "c1")
    expect(characters.train).toHaveBeenCalledWith("c1", {})
    expect(vi.mocked(success).mock.calls[0]?.[0]).toContain("job-1")
  })

  it("repeated --image flags become selectedImageUrls, in order", async () => {
    characters.train.mockResolvedValueOnce(STARTED)
    await runCmd("characters", "train", "c1", "--image", "https://r2/a.png", "--image", "https://r2/b.png")
    expect(characters.train).toHaveBeenCalledWith("c1", { selectedImageUrls: ["https://r2/a.png", "https://r2/b.png"] })
  })

  it("--json prints the SDK result as is", async () => {
    characters.train.mockResolvedValueOnce(STARTED)
    await runCmd("characters", "train", "c1", "--json")
    expect(emit).toHaveBeenCalledWith(STARTED, expect.objectContaining({ json: true }))
  })

  it("--watch follows the training's job until it settles", async () => {
    characters.train.mockResolvedValueOnce(STARTED)
    jobs.get
      .mockResolvedValueOnce({ data: { status: "processing" } })
      .mockResolvedValueOnce({ data: { status: "completed" } })
    await runCmd("characters", "train", "c1", "--watch", "--poll-interval", "1")
    expect(jobs.get).toHaveBeenCalledTimes(2)
    expect(jobs.get).toHaveBeenCalledWith("job-1")
  })
})

describe("characters training", () => {
  beforeEach(() => {
    for (const m of [...Object.values(characters), jobs.get]) m.mockReset()
    vi.mocked(emit).mockReset()
  })

  const record = (status: string) => ({
    status,
    trainingId: "rep-1",
    error: null,
    trainedAt: null,
    version: null,
    triggerWord: "TOK_kira_a1b2c3",
    imageCount: 12,
  })

  it("--json prints the training record", async () => {
    characters.trainingStatus.mockResolvedValueOnce(record("training"))
    await runCmd("characters", "training", "c1", "--json")
    expect(characters.trainingStatus).toHaveBeenCalledWith("c1")
    expect(emit).toHaveBeenCalledWith(record("training"), expect.objectContaining({ json: true }))
  })

  it("--watch polls the training status until it stops moving", async () => {
    characters.trainingStatus
      .mockResolvedValueOnce(record("queued"))
      .mockResolvedValueOnce(record("training"))
      .mockResolvedValueOnce(record("succeeded"))
    await runCmd("characters", "training", "c1", "--watch", "--poll-interval", "1")
    expect(characters.trainingStatus).toHaveBeenCalledTimes(3)
    expect(jobs.get).not.toHaveBeenCalled()
  })
})

describe("characters delete-lora", () => {
  beforeEach(() => {
    characters.deleteLora.mockReset()
    vi.mocked(emit).mockReset()
    vi.mocked(success).mockReset()
  })

  it("removes the trained model", async () => {
    characters.deleteLora.mockResolvedValueOnce(undefined)
    await runCmd("characters", "delete-lora", "c1")
    expect(characters.deleteLora).toHaveBeenCalledWith("c1")
    expect(vi.mocked(success).mock.calls[0]?.[0]).toContain("c1")
  })

  it("--json prints { ok: true }", async () => {
    characters.deleteLora.mockResolvedValueOnce(undefined)
    await runCmd("characters", "delete-lora", "c1", "--json")
    expect(emit).toHaveBeenCalledWith({ ok: true }, expect.objectContaining({ json: true }))
  })
})
