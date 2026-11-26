/**
 * `nodaro nodes run video-to-video` with a Video Remake engine answers a price
 * quote: the CLI says so, and never that the node completed or was queued.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { Command } from "commander"
import { nodesCommand } from "../nodes.js"

const mocks = { run: vi.fn(), getStatus: vi.fn() }

vi.mock("../../client.js", () => ({
  buildClient: () => ({ nodes: { run: mocks.run }, jobs: { getStatus: mocks.getStatus } }),
  handleError: (err: unknown) => {
    throw err
  },
}))

const out = vi.hoisted(() => ({ emitted: [] as unknown[], lines: [] as string[], details: [] as unknown[] }))
vi.mock("../../output.js", async () => {
  const actual = await vi.importActual<typeof import("../../output.js")>("../../output.js")
  return {
    ...actual,
    emit: vi.fn((value: unknown) => { out.emitted.push(value) }),
    success: vi.fn((line: string) => { out.lines.push(line) }),
    info: vi.fn((line: string) => { out.lines.push(line) }),
    dim: vi.fn((line: string) => { out.lines.push(line) }),
    detail: vi.fn((value: unknown) => { out.details.push(value) }),
    warn: vi.fn(),
  }
})

const RUN_BODY = { videoUrl: "https://cdn.test/clip.mp4", roles: [], postPrompt: "make it night", engine: "nodaro-prism" }
const QUOTE = {
  quoteOnly: true,
  message: "m",
  videoRemake: {
    quote: { engine: "nodaro-prism", engineName: "Nodaro Prism", totalCredits: 480, expectedCredits: 300, breakdown: {}, settlesLower: true },
    run: { method: "POST", path: "/v1/video-remake", body: RUN_BODY },
  },
}

async function runCli(...args: string[]): Promise<void> {
  const program = new Command()
  program.exitOverride()
  program.addCommand(nodesCommand())
  await program.parseAsync(["node", "nodaro", "nodes", "run", "video-to-video", "--param", "provider=nodaro-prism", ...args])
}

describe("nodes run video-to-video with a Video Remake engine", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    out.emitted = []
    out.lines = []
    out.details = []
    mocks.run.mockResolvedValue(QUOTE)
  })

  it.each([[[]], [["--watch"]]])("says it is a quote and that nothing started (%j)", async (flags) => {
    await runCli(...flags)
    const text = out.lines.join("\n")
    expect(text).toContain("Nodaro Prism quote")
    expect(text).toContain("300 credits")
    expect(text).toContain("480 held")
    expect(text).toContain("Nothing was started")
    expect(text).toContain("/v1/video-remake")
    expect(text).not.toMatch(/completed|queued/)
    expect(out.details).toEqual([RUN_BODY])
    expect(mocks.getStatus).not.toHaveBeenCalled()
  })

  it("names the size the run delivers where the quote answers it, 4K as people write it", async () => {
    mocks.run.mockResolvedValue({ ...QUOTE, videoRemake: { ...QUOTE.videoRemake, quote: { ...QUOTE.videoRemake.quote, resolution: "4k" } } })
    await runCli("--param", "resolution=4k")
    expect(mocks.run.mock.calls[0]![1]).toMatchObject({ provider: "nodaro-prism", resolution: "4k" })
    const text = out.lines.join("\n")
    expect(text).toContain("delivered at 4K")
    expect(text.toLowerCase()).not.toContain("upscale")
  })

  it("--json emits the answer as it is, with --watch too", async () => {
    await runCli("--json", "--watch")
    expect(out.emitted).toEqual([QUOTE])
    expect(mocks.getStatus).not.toHaveBeenCalled()
  })
})
