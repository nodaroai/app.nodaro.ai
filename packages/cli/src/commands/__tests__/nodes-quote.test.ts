/**
 * `nodaro nodes quote <type>` asks the price of a run with the inputs
 * `nodes run` takes, prints it as a person reads it, and starts nothing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { Command } from "commander"
import { nodesCommand, quoteLines } from "../nodes.js"

const mocks = { run: vi.fn(), quote: vi.fn() }

vi.mock("../../client.js", () => ({
  buildClient: () => ({ nodes: { run: mocks.run, quote: mocks.quote } }),
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
    info: vi.fn((line: string) => { out.lines.push(line) }),
    dim: vi.fn((line: string) => { out.lines.push(line) }),
    warn: vi.fn(),
  }
})

const EDIT_QUOTE = {
  identifier: "edit-video-pro",
  reserve: 172,
  adjustments: [],
  warnings: [{ code: "settles_to_actual", message: "This is the most the edit can cost: the run is charged for what it generates and the rest of the hold is released." }],
}

async function run(args: string[]): Promise<void> {
  const program = new Command().exitOverride()
  program.addCommand(nodesCommand())
  await program.parseAsync(["node", "nodaro", "nodes", ...args])
}

beforeEach(() => {
  vi.clearAllMocks()
  out.emitted.length = 0
  out.lines.length = 0
})

describe("nodaro nodes quote", () => {
  it("sends the run's inputs to the quote, prints the price and starts nothing", async () => {
    mocks.quote.mockResolvedValue(EDIT_QUOTE)
    await run(["quote", "edit-video-pro", "--param", "videoUrl=https://cdn.test/clip.mp4", "--param", "spanStart=5", "--param", "spanEnd=13", "--param", "prompt=the dog jumps"])
    expect(mocks.quote).toHaveBeenCalledWith("edit-video-pro", { videoUrl: "https://cdn.test/clip.mp4", spanStart: 5, spanEnd: 13, prompt: "the dog jumps" })
    expect(mocks.run).not.toHaveBeenCalled()
    expect(out.lines[0]).toBe("edit-video-pro: at most 172 credits")
    expect(out.lines[1]).toContain("the most the edit can cost")
    expect(out.lines.at(-1)).toContain("nothing was started")
  })

  it("--json prints the quote as it came", async () => {
    mocks.quote.mockResolvedValue(EDIT_QUOTE)
    await run(["quote", "switchx", "--param", "videoUrl=https://cdn.test/clip.mp4", "--param", "alphaMode=auto", "--json"])
    expect(out.emitted).toEqual([EDIT_QUOTE])
    expect(out.lines).toEqual([])
  })

  it("words each kind of quote: an exact price, an expected charge under its hold, and its notes", () => {
    expect(quoteLines("switchx", { identifier: "x", reserve: 90, adjustments: [], warnings: [] })).toEqual(["switchx: 90 credits"])
    expect(quoteLines("video-to-video", { identifier: "x", reserve: 480, expected: 300, adjustments: [{ code: "params_adjusted", message: "Resolution set to 720p." }], warnings: [] })).toEqual([
      "video-to-video: about 300 credits (480 held while it runs)",
      "  Resolution set to 720p.",
    ])
  })
})
