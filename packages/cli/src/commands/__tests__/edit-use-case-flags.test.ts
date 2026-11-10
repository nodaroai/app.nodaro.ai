// `nodaro edit`'s use-case commands, the flags added after edit-use-case.test.ts reached its
// size: `--estimate` on each run command (the same flags, the type's /estimate route instead
// of the run) and tighten-episode's own flags for the idempotency key, the style guide, the
// caption style and the music duck. The harness of edit-use-case.test.ts, kept to what these
// tests call.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Command } from "commander"
import { editCommand } from "../edit.js"
import { dim, emit, success, warn } from "../../output.js"

const mocks = {
  tightenEpisode: vi.fn(),
  estimateTightenEpisode: vi.fn(),
  episodeChapters: vi.fn(),
  estimateEpisodeChapters: vi.fn(),
  episodeTrailer: vi.fn(),
  estimateEpisodeTrailer: vi.fn(),
  clipPack: vi.fn(),
  estimateClipPack: vi.fn(),
  speakerLayout: vi.fn(),
  estimateSpeakerLayout: vi.fn(),
  jobsGetStatus: vi.fn(),
}

vi.mock("../../client.js", () => ({
  buildClient: () => ({
    edit: {
      tightenEpisode: mocks.tightenEpisode,
      estimateTightenEpisode: mocks.estimateTightenEpisode,
      episodeChapters: mocks.episodeChapters,
      estimateEpisodeChapters: mocks.estimateEpisodeChapters,
      episodeTrailer: mocks.episodeTrailer,
      estimateEpisodeTrailer: mocks.estimateEpisodeTrailer,
      clipPack: mocks.clipPack,
      estimateClipPack: mocks.estimateClipPack,
      speakerLayout: mocks.speakerLayout,
      estimateSpeakerLayout: mocks.estimateSpeakerLayout,
    },
    jobs: { getStatus: mocks.jobsGetStatus },
  }),
  handleError: (err: unknown) => {
    throw err
  },
}))

vi.mock("../../output.js", async () => {
  const actual = await vi.importActual<typeof import("../../output.js")>("../../output.js")
  return { ...actual, emit: vi.fn(), success: vi.fn(), info: vi.fn(), dim: vi.fn(), warn: vi.fn(), detail: vi.fn(), table: vi.fn() }
})

async function runCmd(...args: string[]): Promise<void> {
  const program = new Command().exitOverride()
  program.addCommand(editCommand())
  await program.parseAsync(["node", "test", ...args])
}

let exitSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset()
  for (const f of [emit, success, dim, warn]) vi.mocked(f).mockClear()
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code ?? 0})`)
  }) as never)
})
afterEach(() => exitSpy.mockRestore())

const QUOTE = { totalCredits: 846, stepsCredits: 835, feeCredits: 11, durationSec: 3600 }
const MEDIA = ["--media", "https://r2/ep.mp4"]

// Each command, the run it would start and the quote it asks for instead, with flags of its own.
const COMMANDS = [
  {
    command: "tighten-episode",
    label: "Tighten Episode",
    flags: ["--output", "audio", "--plan-tier", "premium", "--idempotency-key", "k-1"],
    input: { mediaUrl: "https://r2/ep.mp4", output: "audio", planTier: "premium" },
    run: mocks.tightenEpisode,
    estimate: mocks.estimateTightenEpisode,
  },
  {
    command: "episode-chapters",
    label: "Chapters",
    flags: ["--instructions", "5 to 8 chapters", "--idempotency-key", "k-1"],
    input: { mediaUrl: "https://r2/ep.mp4", instructions: "5 to 8 chapters" },
    run: mocks.episodeChapters,
    estimate: mocks.estimateEpisodeChapters,
  },
  {
    command: "episode-trailer",
    label: "Trailer",
    flags: ["--formats", "9:16,16:9", "--idempotency-key", "k-1"],
    input: { mediaUrl: "https://r2/ep.mp4", formats: ["9:16", "16:9"] },
    run: mocks.episodeTrailer,
    estimate: mocks.estimateEpisodeTrailer,
  },
  {
    command: "clip-pack",
    label: "Clip Pack",
    flags: ["--count", "4", "--framing", "none", "--idempotency-key", "k-1"],
    input: { mediaUrl: "https://r2/ep.mp4", count: 4, framing: null },
    run: mocks.clipPack,
    estimate: mocks.estimateClipPack,
  },
  {
    command: "speaker-layout",
    label: "Speaker Layout",
    flags: ["--aspect", "1:1", "--layout", "grid", "--idempotency-key", "k-1"],
    input: { mediaUrl: "https://r2/ep.mp4", targetAspect: "1:1", layout: "grid" },
    run: mocks.speakerLayout,
    estimate: mocks.estimateSpeakerLayout,
  },
] as const

describe("edit <use-case> --estimate", () => {
  it.each(COMMANDS.map((c) => [c.command, c] as const))("%s: quotes exactly the run its flags would start, and starts nothing", async (_name, c) => {
    c.estimate.mockResolvedValueOnce({ data: QUOTE })
    await runCmd("edit", c.command, ...MEDIA, ...c.flags, "--estimate", "--json")
    expect(c.estimate).toHaveBeenCalledWith(c.input)
    expect(c.run).not.toHaveBeenCalled()
    expect(vi.mocked(emit)).toHaveBeenCalledWith(QUOTE, expect.anything())
  })

  it.each(COMMANDS.map((c) => [c.command, c] as const))("%s: without --estimate, the run takes the same input (and the key)", async (_name, c) => {
    c.run.mockResolvedValueOnce({ jobId: "job-1" })
    await runCmd("edit", c.command, ...MEDIA, ...c.flags, "--json")
    expect(c.run).toHaveBeenCalledWith(c.input, { idempotencyKey: "k-1" })
    expect(c.estimate).not.toHaveBeenCalled()
  })

  it("prints the quote in one line, ≈ when a step is a metered estimate, and the recording's length", async () => {
    mocks.estimateTightenEpisode.mockResolvedValueOnce({ data: { ...QUOTE, estimate: true } })
    await runCmd("edit", "tighten-episode", ...MEDIA, "--estimate")
    expect(vi.mocked(success)).toHaveBeenCalledWith("Tighten Episode is estimated at ≈846 credits (its steps ≈835 + the per-run fee 11)")
    expect(vi.mocked(dim).mock.calls.map((c) => c[0])).toEqual(["the recording is 1 h 00 min", "nothing was created or charged"])
  })

  it("an unreadable length and an edition without credits are said, not quoted", async () => {
    mocks.estimateSpeakerLayout.mockResolvedValueOnce({ data: { totalCredits: 0, stepsCredits: 0, feeCredits: 0, durationSec: null } })
    await runCmd("edit", "speaker-layout", ...MEDIA, "--estimate")
    expect(vi.mocked(success)).toHaveBeenCalledWith("Speaker Layout: not billed in credits on this edition")
    expect(vi.mocked(dim).mock.calls[0]?.[0]).toBe("the recording's length could not be read")
  })

  it("a flag the run would refuse is refused with --estimate too, before any request", async () => {
    await expect(runCmd("edit", "episode-trailer", ...MEDIA, "--formats", "3:2", "--estimate")).rejects.toThrow("process.exit(1)")
    expect(mocks.estimateEpisodeTrailer).not.toHaveBeenCalled()
  })
})

describe("edit tighten-episode: idempotency key, style guide, caption style, music duck", () => {
  it("sends each to the run, the key as Idempotency-Key", async () => {
    mocks.tightenEpisode.mockResolvedValueOnce({ jobId: "job-1" })
    await runCmd(
      "edit", "tighten-episode", ...MEDIA,
      "--music", "https://r2/bed.mp3", "--music-duck-amount", "60.5",
      "--caption-style", "karaoke",
      "--style-guide", "Keep the jokes",
      "--idempotency-key", "key-12345",
      "--json",
    )
    expect(mocks.tightenEpisode).toHaveBeenCalledWith(
      { mediaUrl: "https://r2/ep.mp4", musicUrl: "https://r2/bed.mp3", musicDuckAmount: 60.5, captionStyle: "karaoke", styleGuide: "Keep the jokes" },
      { idempotencyKey: "key-12345" },
    )
  })

  it("takes the ends of the duck's range", async () => {
    for (const amount of ["0", "100"]) {
      mocks.tightenEpisode.mockResolvedValueOnce({ jobId: "job-1" })
      await runCmd("edit", "tighten-episode", ...MEDIA, "--music", "https://r2/bed.mp3", "--music-duck-amount", amount, "--json")
      expect(mocks.tightenEpisode).toHaveBeenLastCalledWith(expect.objectContaining({ musicDuckAmount: Number(amount) }), undefined)
    }
  })

  it.each([
    [["--music", "https://r2/bed.mp3", "--music-duck-amount", "101"], /^--music-duck-amount must be a number from 0 to 100/],
    [["--music", "https://r2/bed.mp3", "--music-duck-amount", "-1"], /^--music-duck-amount must be a number from 0 to 100/],
    [["--music", "https://r2/bed.mp3", "--music-duck-amount", "loud"], /^--music-duck-amount must be a number from 0 to 100/],
    [["--music-duck-amount", "50"], /^--music-duck-amount applies with --music only/],
    [["--caption-style", "neon"], /^--caption-style must be/],
    [["--no-captions", "--caption-style", "karaoke"], /^--caption-style applies with captions on/],
    [["--style-guide", "x".repeat(4001)], /^--style-guide is at most 4000 characters/],
  ])("refuses %j before any request", async (flags, message) => {
    await expect(runCmd("edit", "tighten-episode", ...MEDIA, ...flags)).rejects.toThrow("process.exit(1)")
    expect(mocks.tightenEpisode).not.toHaveBeenCalled()
    expect(vi.mocked(warn).mock.calls[0]?.[0]).toMatch(message)
  })
})
