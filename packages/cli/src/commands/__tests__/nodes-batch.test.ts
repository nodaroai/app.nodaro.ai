import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Command } from "commander"
import { nodesCommand } from "../nodes.js"

const mocks = {
  run: vi.fn(),
  getStatus: vi.fn(),
  getJob: vi.fn(),
}

vi.mock("../../client.js", () => ({
  buildClient: () => ({ nodes: { run: mocks.run }, jobs: { getStatus: mocks.getStatus, get: mocks.getJob } }),
  handleError: (err: unknown) => {
    throw err
  },
}))

const out = vi.hoisted(() => ({ emitted: [] as unknown[], lines: [] as string[] }))
vi.mock("../../output.js", async () => {
  const actual = await vi.importActual<typeof import("../../output.js")>("../../output.js")
  return {
    ...actual,
    emit: vi.fn((value: unknown) => { out.emitted.push(value) }),
    success: vi.fn((line: string) => { out.lines.push(line) }),
    info: vi.fn((line: string) => { out.lines.push(line) }),
    dim: vi.fn((line: string) => { out.lines.push(line) }),
    detail: vi.fn(),
    warn: vi.fn(),
  }
})

const BATCH = {
  jobId: "job-1",
  jobIds: ["job-1", "job-2", "job-3"],
  batchId: "6b1f7e2a-0c4d-5e8f-9a1b-2c3d4e5f6a7b",
  groups: [
    { model: "gpt-image-2", jobIds: ["job-1", "job-2"], credits: 120 },
    { model: "flux-2-max", jobIds: ["job-3"], credits: 90 },
  ],
  totalCredits: 210,
}

async function runCmd(...args: string[]): Promise<void> {
  const program = new Command().exitOverride()
  program.addCommand(nodesCommand())
  await program.parseAsync(["node", "test", ...args])
}

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset()
  out.emitted.length = 0
  out.lines.length = 0
})
afterEach(() => vi.restoreAllMocks())

describe("nodes run generate-image --count / --models", () => {
  it("--count goes on the body as a number", async () => {
    mocks.run.mockResolvedValueOnce(BATCH)
    await runCmd("nodes", "run", "generate-image", "--param", "prompt=a red car", "--count", "3", "--json")
    expect(mocks.run).toHaveBeenCalledWith("generate-image", { prompt: "a red car", count: 3 })
  })

  it("--models splits on commas and spaces", async () => {
    mocks.run.mockResolvedValueOnce(BATCH)
    await runCmd("nodes", "run", "generate-image", "--param", "prompt=a red car", "--models", "gpt-image-2,flux-2-max nano-banana-2-1", "--json")
    expect(mocks.run).toHaveBeenCalledWith("generate-image", { prompt: "a red car", models: ["gpt-image-2", "flux-2-max", "nano-banana-2-1"] })
  })

  it("the flags win over the same keys in --param / --params-file", async () => {
    mocks.run.mockResolvedValueOnce(BATCH)
    await runCmd("nodes", "run", "generate-image", "--param", "prompt=x", "--param", "count=1", "--count", "2", "--json")
    expect(mocks.run).toHaveBeenCalledWith("generate-image", { prompt: "x", count: 2 })
  })

  it.each([["0"], ["x"], ["2.5"]])("refuses --count %s before calling the API", async (value) => {
    await expect(runCmd("nodes", "run", "generate-image", "--param", "prompt=x", "--count", value)).rejects.toThrow(/--count/)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it("refuses the flags on another node type", async () => {
    await expect(runCmd("nodes", "run", "generate-video", "--param", "prompt=x", "--count", "2")).rejects.toThrow(/generate-image/)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it("--json without --watch emits the batch answer as is", async () => {
    mocks.run.mockResolvedValueOnce(BATCH)
    await runCmd("nodes", "run", "generate-image", "--param", "prompt=x", "--count", "2", "--json")
    expect(out.emitted).toEqual([BATCH])
  })

  it("prints every job id grouped by model, and the batch id", async () => {
    mocks.run.mockResolvedValueOnce(BATCH)
    await runCmd("nodes", "run", "generate-image", "--param", "prompt=x", "--models", "gpt-image-2,flux-2-max")
    const text = out.lines.join("\n")
    expect(text).toContain("3 jobs queued")
    expect(text).toContain(BATCH.batchId)
    expect(text).toContain("gpt-image-2: job-1, job-2")
    expect(text).toContain("flux-2-max: job-3")
  })

  it("--watch polls EVERY job of the batch until each one settles", async () => {
    mocks.run.mockResolvedValueOnce(BATCH)
    const polls = new Map<string, number>()
    mocks.getStatus.mockImplementation(async (id: string) => {
      const n = (polls.get(id) ?? 0) + 1
      polls.set(id, n)
      return { data: { id, status: n >= 2 ? "completed" : "processing", output_data: { imageUrl: `https://cdn.example/${id}.png` } } }
    })
    await runCmd("nodes", "run", "generate-image", "--param", "prompt=x", "--count", "3", "--watch", "--poll-interval", "1", "--json")
    expect([...polls.keys()].sort()).toEqual(["job-1", "job-2", "job-3"])
    const final = out.emitted.at(-1) as Array<{ id: string; status: string }>
    expect(final.map((j) => [j.id, j.status])).toEqual([["job-1", "completed"], ["job-2", "completed"], ["job-3", "completed"]])
  })

  it("--watch exits 2 when an image of the batch failed (after every job settled)", async () => {
    mocks.run.mockResolvedValueOnce(BATCH)
    mocks.getStatus.mockImplementation(async (id: string) => ({ data: { id, status: id === "job-2" ? "failed" : "completed" } }))
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => { throw new Error(`exit ${code}`) }) as never)
    await expect(runCmd("nodes", "run", "generate-image", "--param", "prompt=x", "--count", "3", "--watch", "--poll-interval", "1")).rejects.toThrow("exit 2")
    expect(mocks.getStatus).toHaveBeenCalledTimes(3)
    expect(exit).toHaveBeenCalledWith(2)
  })
})
