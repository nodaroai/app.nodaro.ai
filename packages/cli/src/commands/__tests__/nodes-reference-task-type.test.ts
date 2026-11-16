import { describe, it, expect, vi, beforeEach } from "vitest"
import { Command } from "commander"
import { SEEDANCE_REFERENCE_TASK_TYPES } from "@nodaro/shared/models"
import { nodesCommand } from "../nodes.js"

const mocks = { run: vi.fn() }

vi.mock("../../client.js", () => ({
  buildClient: () => ({ nodes: { run: mocks.run }, jobs: {} }),
  handleError: (err: unknown) => {
    throw err
  },
}))

vi.mock("../../output.js", async () => {
  const actual = await vi.importActual<typeof import("../../output.js")>("../../output.js")
  return { ...actual, emit: vi.fn(), success: vi.fn(), info: vi.fn(), dim: vi.fn(), detail: vi.fn(), warn: vi.fn() }
})

async function runCmd(...args: string[]): Promise<void> {
  const program = new Command().exitOverride()
  program.addCommand(nodesCommand())
  await program.parseAsync(["node", "test", ...args])
}

beforeEach(() => {
  mocks.run.mockReset()
  mocks.run.mockResolvedValue({ jobId: "job-1" })
})

describe("nodes run --reference-task-type", () => {
  it.each([["generate-video"], ["text-to-video"]])("%s: the value goes on the body as referenceTaskType", async (type) => {
    await runCmd("nodes", "run", type, "--param", "prompt=a fox", "--reference-task-type", "extend", "--json")
    expect(mocks.run).toHaveBeenCalledWith(type, { prompt: "a fox", referenceTaskType: "extend" })
  })

  it.each(SEEDANCE_REFERENCE_TASK_TYPES.map((v) => [v]))("takes %s", async (value) => {
    await runCmd("nodes", "run", "generate-video", "--param", "prompt=x", "--reference-task-type", value, "--json")
    expect(mocks.run).toHaveBeenCalledWith("generate-video", { prompt: "x", referenceTaskType: value })
  })

  it("the flag wins over referenceTaskType in --param", async () => {
    await runCmd("nodes", "run", "generate-video", "--param", "prompt=x", "--param", "referenceTaskType=reference", "--reference-task-type", "edit", "--json")
    expect(mocks.run).toHaveBeenCalledWith("generate-video", { prompt: "x", referenceTaskType: "edit" })
  })

  it("without the flag, --param referenceTaskType still goes through as is", async () => {
    await runCmd("nodes", "run", "text-to-video", "--param", "prompt=x", "--param", "referenceTaskType=reference", "--json")
    expect(mocks.run).toHaveBeenCalledWith("text-to-video", { prompt: "x", referenceTaskType: "reference" })
  })

  it.each([["Edit"], ["remix"], [""]])("refuses %j before calling the API", async (value) => {
    await expect(runCmd("nodes", "run", "generate-video", "--param", "prompt=x", "--reference-task-type", value)).rejects.toThrow(/--reference-task-type must be one of auto, reference, edit, extend/)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it("refuses video-to-video: an edit always runs as an edit", async () => {
    await expect(runCmd("nodes", "run", "video-to-video", "--param", "prompt=x", "--reference-task-type", "edit")).rejects.toThrow(/always runs as an edit/)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it.each([["generate-image"], ["image-to-video"], ["text-to-speech"]])("refuses it on %s", async (type) => {
    await expect(runCmd("nodes", "run", type, "--param", "prompt=x", "--reference-task-type", "auto")).rejects.toThrow(/generate-video \/ text-to-video option/)
    expect(mocks.run).not.toHaveBeenCalled()
  })
})
