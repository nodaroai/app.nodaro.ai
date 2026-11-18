// `nodaro edit podcast-pack` (decided 2026-11-18): several podcast tools on one recording, for
// one price. The harness of edit-use-case.test.ts, kept to what these tests call.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Command } from "commander"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { editCommand } from "../edit.js"
import { dim, emit, success, warn } from "../../output.js"

const mocks = {
  podcastPack: vi.fn(),
  estimatePodcastPack: vi.fn(),
  startPodcastPackTool: vi.fn(),
}

vi.mock("../../client.js", () => ({
  buildClient: () => ({
    edit: { podcastPack: mocks.podcastPack, estimatePodcastPack: mocks.estimatePodcastPack, startPodcastPackTool: mocks.startPodcastPackTool },
    jobs: { getStatus: vi.fn() },
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

const tmpDirs: string[] = []
function fixture(name: string, value: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "edit-pack-cli-"))
  tmpDirs.push(dir)
  const path = join(dir, name)
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value), "utf8")
  return path
}

let exitSpy: ReturnType<typeof vi.spyOn>
let logSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset()
  for (const f of [emit, success, dim, warn]) vi.mocked(f).mockClear()
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code ?? 0})`)
  }) as never)
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
})
afterEach(() => {
  exitSpy.mockRestore()
  logSpy.mockRestore()
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true })
})

const MEDIA = ["--media", "https://r2/ep.mp4"]
const STARTED = {
  jobId: "pack-1",
  tools: [
    { tool: "tighten-episode", jobId: "job-t", executionId: "exec-t" },
    { tool: "clip-pack", jobId: "job-c", executionId: "exec-c" },
  ],
  durationSec: 512,
  units: 35,
}

describe("edit podcast-pack", () => {
  it("maps --media and the tools (repeated and comma-separated) to client.edit.podcastPack, each with its defaults", async () => {
    mocks.podcastPack.mockResolvedValueOnce(STARTED)
    await runCmd("edit", "podcast-pack", ...MEDIA, "--tool", "tighten-episode,episode-chapters", "--tool", "clip-pack", "--json")
    expect(mocks.podcastPack).toHaveBeenCalledWith(
      { mediaUrl: "https://r2/ep.mp4", tools: { "tighten-episode": {}, "episode-chapters": {}, "clip-pack": {} } },
      undefined,
    )
    expect(vi.mocked(emit)).toHaveBeenCalledWith(STARTED, expect.anything())
  })

  it("gives a tool its settings from inline JSON or a file, and sends the recordings flags, the speakers' names and the key", async () => {
    mocks.podcastPack.mockResolvedValueOnce(STARTED)
    const settings = fixture("layout.json", { targetAspect: "1:1", layout: "grid" })
    const names = fixture("names.json", { speaker_0: "Dana" })
    await runCmd(
      "edit", "podcast-pack",
      "--media", "https://r2/a.mp4", "--media", "https://r2/b.mp4",
      "--master-audio", "https://r2/m.wav", "--wide-camera", "2",
      "--tool", `clip-pack={"count":5,"captions":false}`,
      "--tool", `speaker-layout=${settings}`,
      "--speaker-names", names,
      "--idempotency-key", "pack-key-1",
      "--json",
    )
    expect(mocks.podcastPack).toHaveBeenCalledWith(
      {
        mediaUrls: ["https://r2/a.mp4", "https://r2/b.mp4"],
        masterAudioUrl: "https://r2/m.wav",
        cameras: { wide: 2 },
        speakerNames: { speaker_0: "Dana" },
        tools: { "clip-pack": { count: 5, captions: false }, "speaker-layout": { targetAspect: "1:1", layout: "grid" } },
      },
      { idempotencyKey: "pack-key-1" },
    )
  })

  it("prints the pack, each tool's job and the tools that did not start", async () => {
    mocks.podcastPack.mockResolvedValueOnce({
      ...STARTED,
      tools: [STARTED.tools[0]],
      notStarted: [{ tool: "clip-pack", error: { code: "internal_error", message: "clip-pack: failed to start", tool: "clip-pack" } }],
    })
    await runCmd("edit", "podcast-pack", ...MEDIA, "--tool", "tighten-episode,clip-pack")
    expect(vi.mocked(success)).toHaveBeenCalledWith("podcast pack pack-1 started (35 units; the recording is 8 min 32 s)")
    expect(logSpy.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      "tighten-episode  job-t",
      "clip-pack  did not start: clip-pack: failed to start (internal_error)",
    ])
    const hints = vi.mocked(dim).mock.calls.map((c) => String(c[0]))
    expect(hints.some((h) => h.includes("nodaro edit continue-use-case <jobId> --mode from-failed"))).toBe(true)
    // A tool that did not start: how to start it later, free and once.
    expect(hints.at(-1)).toContain("nodaro edit podcast-pack-start pack-1 <tool>")
  })

  it("a keyed retry says the pack was already started", async () => {
    mocks.podcastPack.mockResolvedValueOnce({ jobId: "pack-1", deduped: true })
    await runCmd("edit", "podcast-pack", ...MEDIA, "--tool", "episode-chapters", "--idempotency-key", "pack-key-1")
    expect(vi.mocked(success)).toHaveBeenCalledWith("podcast pack pack-1 was already started with this key")
    expect(logSpy).not.toHaveBeenCalled()
  })

  it.each([
    [["--tool", "trailer"], `--tool must be tighten-episode, episode-chapters, episode-trailer, clip-pack, speaker-layout (got "trailer")`],
    [["--tool", ","], "--tool names no tool: choose at least one of tighten-episode, episode-chapters, episode-trailer, clip-pack, speaker-layout"],
    [["--tool", "clip-pack", "--tool", "clip-pack={}"], "--tool names clip-pack twice"],
    [["--tool", "clip-pack={count"], "--tool clip-pack: the settings are not a JSON object"],
    [["--tool", "clip-pack=[1]"], "--tool clip-pack: the settings are not a JSON object"],
    [["--tool", `clip-pack={"mediaUrls":["https://r2/x.mp4"]}`], "--tool clip-pack: mediaUrls belongs to the pack"],
    [["--tool", `tighten-episode={"speakerNames":{}}`], "--tool tighten-episode: speakerNames belongs to the pack"],
    [["--tool", "clip-pack,speaker-layout={}"], "--tool <tool>=<settings> names one tool"],
  ])("refuses %j before any request", async (flags, message) => {
    await expect(runCmd("edit", "podcast-pack", ...MEDIA, ...flags)).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn).mock.calls[0]![0]).toContain(message)
    expect(mocks.podcastPack).not.toHaveBeenCalled()
  })

  it("settings that are not an object are refused", async () => {
    await expect(runCmd("edit", "podcast-pack", ...MEDIA, "--tool", `clip-pack=${fixture("n.json", "5")}`)).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith("--tool clip-pack: the settings must be a JSON object")
  })

  it("--tool is required", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    try {
      await expect(runCmd("edit", "podcast-pack", ...MEDIA)).rejects.toThrow("process.exit(1)")
      expect(stderr.mock.calls.map((c) => String(c[0])).join("")).toContain("required option '--tool <tool[=settings]>' not specified")
    } finally {
      stderr.mockRestore()
    }
    expect(mocks.podcastPack).not.toHaveBeenCalled()
  })
})

describe("edit podcast-pack --estimate", () => {
  const QUOTE = { tools: ["tighten-episode", "clip-pack"], durationSec: 512, units: 35, credits: 770 }

  it("asks for the quote with the same input instead of the run, and prints it", async () => {
    mocks.estimatePodcastPack.mockResolvedValueOnce({ data: QUOTE })
    await runCmd("edit", "podcast-pack", ...MEDIA, "--tool", "tighten-episode", "--tool", `clip-pack={"count":3}`, "--estimate")
    expect(mocks.estimatePodcastPack).toHaveBeenCalledWith({ mediaUrl: "https://r2/ep.mp4", tools: { "tighten-episode": {}, "clip-pack": { count: 3 } } })
    expect(mocks.podcastPack).not.toHaveBeenCalled()
    expect(vi.mocked(success)).toHaveBeenCalledWith("Podcast pack is 770 credits (35 units of 15 seconds, every tool included)")
    expect(vi.mocked(dim)).toHaveBeenCalledWith("the recording is 8 min 32 s; tools: tighten-episode, clip-pack")
    expect(vi.mocked(dim)).toHaveBeenCalledWith("nothing was created or charged")
  })

  it("--json prints the route's figures as they are", async () => {
    mocks.estimatePodcastPack.mockResolvedValueOnce({ data: QUOTE })
    await runCmd("edit", "podcast-pack", ...MEDIA, "--tool", "tighten-episode", "--estimate", "--json")
    expect(vi.mocked(emit)).toHaveBeenCalledWith(QUOTE, expect.anything())
  })

  it("says so on an edition without credits, and when the server has no price", async () => {
    mocks.estimatePodcastPack.mockResolvedValueOnce({ data: { ...QUOTE, credits: 0 } })
    await runCmd("edit", "podcast-pack", ...MEDIA, "--tool", "tighten-episode", "--estimate")
    expect(vi.mocked(success)).toHaveBeenCalledWith("Podcast pack: not billed in credits on this edition")
    mocks.estimatePodcastPack.mockResolvedValueOnce({ data: { ...QUOTE, units: 1, credits: null } })
    await runCmd("edit", "podcast-pack", ...MEDIA, "--tool", "tighten-episode", "--estimate")
    expect(vi.mocked(success)).toHaveBeenCalledWith("Podcast pack: this server has no price for it")
  })
})

describe("edit podcast-pack-start", () => {
  it("starts a tool that did not start, under its pack", async () => {
    mocks.startPodcastPackTool.mockResolvedValue({ jobId: "job-clips", executionId: "exec-clips", tool: "clip-pack" })
    await runCmd("edit", "podcast-pack-start", "pack-1", "clip-pack")
    expect(mocks.startPodcastPackTool).toHaveBeenCalledWith("pack-1", "clip-pack")
    expect(vi.mocked(success).mock.calls[0]![0]).toMatch(/clip-pack started under its pack: job-clips/)
  })

  it("an unknown tool exits 1 before any request", async () => {
    await expect(runCmd("edit", "podcast-pack-start", "pack-1", "generate-image")).rejects.toThrow("process.exit(1)")
    expect(mocks.startPodcastPackTool).not.toHaveBeenCalled()
  })
})
