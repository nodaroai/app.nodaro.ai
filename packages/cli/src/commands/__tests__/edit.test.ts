import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Command } from "commander"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { editCommand } from "../edit.js"
import { warn, emit, success } from "../../output.js"
import { ContinuationRefusedError, NodaroError } from "@nodaro/sdk/errors"
import { USE_CASE_NODE_TYPES } from "@nodaro/shared/nodes"

const mocks = {
  silenceDetect: vi.fn(),
  audioSync: vi.fn(),
  applyEdl: vi.fn(),
  editPlan: vi.fn(),
  tightenEpisode: vi.fn(),
  episodeChapters: vi.fn(),
  episodeTrailer: vi.fn(),
  continueUseCase: vi.fn(),
  jobsGetStatus: vi.fn(),
}

vi.mock("../../client.js", () => ({
  buildClient: () => ({
    edit: {
      silenceDetect: mocks.silenceDetect,
      audioSync: mocks.audioSync,
      applyEdl: mocks.applyEdl,
      editPlan: mocks.editPlan,
      tightenEpisode: mocks.tightenEpisode,
      episodeChapters: mocks.episodeChapters,
      episodeTrailer: mocks.episodeTrailer,
      continueUseCase: mocks.continueUseCase,
    },
    jobs: { getStatus: mocks.jobsGetStatus },
  }),
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
  const program = new Command().exitOverride()
  program.addCommand(editCommand())
  await program.parseAsync(["node", "test", ...args])
}

/** Temp dirs created by `fixture`, cleaned up in afterEach. */
const tmpDirs: string[] = []

/** Write a JSON fixture to a temp file and return its path. */
function fixture(name: string, value: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "edit-cli-"))
  tmpDirs.push(dir)
  const path = join(dir, name)
  writeFileSync(path, JSON.stringify(value), "utf8")
  return path
}

const EDL = {
  version: 1,
  clock: "master",
  sources: [{ id: "master", url: "https://x/m.mp4", kind: "video", role: "master-audio" }],
  segments: [{ id: "s0", inMs: 0, outMs: 5000, video: "master" }],
}
const TRANSCRIPT = { version: 1, words: [{ text: "hi", startMs: 0, endMs: 400 }] }

let exitSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset()
  vi.mocked(warn).mockClear()
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code ?? 0})`)
  }) as never)
})
afterEach(() => {
  exitSpy.mockRestore()
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true })
})

describe("edit silence-detect", () => {
  it("maps the source + tuning knobs", async () => {
    mocks.silenceDetect.mockResolvedValueOnce({ jobId: "j1" })
    await runCmd(
      "edit", "silence-detect", "https://x/a.mp3",
      "--threshold-db=-40", "--min-silence-ms", "500", "--pad-ms", "80", "--json",
    )
    expect(mocks.silenceDetect).toHaveBeenCalledWith({
      audioUrl: "https://x/a.mp3",
      thresholdDb: -40,
      minSilenceMs: 500,
      padMs: 80,
    })
  })

  it("sends just the source when no knobs are given", async () => {
    mocks.silenceDetect.mockResolvedValueOnce({ jobId: "j" })
    await runCmd("edit", "silence-detect", "https://x/a.mp3", "--json")
    expect(mocks.silenceDetect).toHaveBeenCalledWith({ audioUrl: "https://x/a.mp3" })
  })
})

describe("edit apply-edl", () => {
  it("reads the EDL file + maps render options", async () => {
    mocks.applyEdl.mockResolvedValueOnce({ jobId: "j2" })
    const edlPath = fixture("edl.json", EDL)
    await runCmd(
      "edit", "apply-edl", "--edl", edlPath,
      "--source", "https://x/override.mp4", "--output", "audio", "--quality", "proxy",
      "--crossfade-ms", "250", "--json",
    )
    expect(mocks.applyEdl).toHaveBeenCalledWith({
      edl: EDL,
      sources: ["https://x/override.mp4"],
      output: "audio",
      quality: "proxy",
      crossfadeMs: 250,
    })
  })

  it("reads an optional transcript file", async () => {
    mocks.applyEdl.mockResolvedValueOnce({ jobId: "j" })
    const edlPath = fixture("edl.json", EDL)
    const tPath = fixture("t.json", TRANSCRIPT)
    await runCmd("edit", "apply-edl", "--edl", edlPath, "--transcript", tPath, "--json")
    expect(mocks.applyEdl).toHaveBeenCalledWith({
      edl: EDL,
      transcript: TRANSCRIPT,
      output: "video",
      quality: "final",
    })
  })

  it("passes --clip-key through as clipKey", async () => {
    mocks.applyEdl.mockResolvedValueOnce({ jobId: "j-ck" })
    const edlPath = fixture("edl.json", EDL)
    await runCmd("edit", "apply-edl", "--edl", edlPath, "--quality", "proxy", "--clip-key", "12000-98000", "--json")
    expect(mocks.applyEdl).toHaveBeenCalledWith({
      edl: EDL,
      output: "video",
      quality: "proxy",
      clipKey: "12000-98000",
    })
  })

  it("errors on an unknown --output", async () => {
    const edlPath = fixture("edl.json", EDL)
    await expect(
      runCmd("edit", "apply-edl", "--edl", edlPath, "--output", "gif"),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("--output"))
    expect(mocks.applyEdl).not.toHaveBeenCalled()
  })
})

describe("edit plan", () => {
  it("mints source rows from --source and maps clip levers", async () => {
    mocks.editPlan.mockResolvedValueOnce({ jobId: "j3" })
    const tPath = fixture("t.json", TRANSCRIPT)
    await runCmd(
      "edit", "plan", "--mode", "clips", "--plan-tier", "premium", "--transcript", tPath,
      "--source", "https://x/m.mp4", "--source", "https://x/a.mp3@audio",
      "--count", "3", "--target-duration-sec", "45", "--target-aspect", "9:16",
      "--platform", "shorts", "--instructions", "keep the hooks", "--json",
    )
    expect(mocks.editPlan).toHaveBeenCalledWith({
      mode: "clips",
      planTier: "premium",
      transcript: TRANSCRIPT,
      sources: [
        { id: "source-1", url: "https://x/m.mp4", kind: "video" },
        { id: "source-2", url: "https://x/a.mp3", kind: "audio" },
      ],
      instructions: "keep the hooks",
      count: 3,
      targetDurationSec: 45,
      targetAspect: "9:16",
      platform: "shorts",
    })
  })

  it("uses a full --sources-file over --source", async () => {
    mocks.editPlan.mockResolvedValueOnce({ jobId: "j" })
    const tPath = fixture("t.json", TRANSCRIPT)
    const rows = [{ id: "cam", url: "https://x/c.mp4", kind: "video", role: "camera", offsetMs: 1000 }]
    const sPath = fixture("sources.json", rows)
    await runCmd(
      "edit", "plan", "--mode", "tighten", "--plan-tier", "standard",
      "--transcript", tPath, "--sources-file", sPath, "--source", "https://x/ignored.mp4", "--json",
    )
    expect(mocks.editPlan).toHaveBeenCalledWith({
      mode: "tighten",
      planTier: "standard",
      transcript: TRANSCRIPT,
      sources: rows,
    })
  })

  it("errors when --sources-file is not a JSON array", async () => {
    const tPath = fixture("t.json", TRANSCRIPT)
    const badPath = fixture("bad-sources.json", { not: "an array" })
    await expect(
      runCmd("edit", "plan", "--mode", "tighten", "--plan-tier", "standard", "--transcript", tPath, "--sources-file", badPath),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("--sources-file"))
    expect(mocks.editPlan).not.toHaveBeenCalled()
  })

  it("accepts every shared edit-plan mode, trailer included", async () => {
    mocks.editPlan.mockResolvedValueOnce({ jobId: "j-trailer" })
    const tPath = fixture("t.json", TRANSCRIPT)
    await runCmd(
      "edit", "plan", "--mode", "trailer", "--plan-tier", "standard", "--transcript", tPath,
      "--source", "https://x/m.mp4", "--target-aspect", "9:16", "--json",
    )
    expect(mocks.editPlan).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "trailer", planTier: "standard", targetAspect: "9:16" }),
    )
  })

  it("errors on an unknown --mode", async () => {
    const tPath = fixture("t.json", TRANSCRIPT)
    await expect(
      runCmd("edit", "plan", "--mode", "chop", "--plan-tier", "standard", "--transcript", tPath, "--source", "https://x/m.mp4"),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("--mode"))
    expect(mocks.editPlan).not.toHaveBeenCalled()
  })

  it("errors when no sources are given", async () => {
    const tPath = fixture("t.json", TRANSCRIPT)
    await expect(
      runCmd("edit", "plan", "--mode", "tighten", "--plan-tier", "standard", "--transcript", tPath),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("source"))
    expect(mocks.editPlan).not.toHaveBeenCalled()
  })
})

describe("edit audio-sync", () => {
  it("maps --source url / id=url specs (ids minted as source-N when omitted) and --reference", async () => {
    mocks.audioSync.mockResolvedValueOnce({ jobId: "j-as" })
    await runCmd(
      "edit", "audio-sync",
      "--source", "mic=https://x/mic.m4a",
      "--source", "https://x/cam.mp4?sig=a=b",
      "--reference", "mic", "--json",
    )
    expect(mocks.audioSync).toHaveBeenCalledWith({
      sources: [
        { id: "mic", url: "https://x/mic.m4a" },
        { id: "source-2", url: "https://x/cam.mp4?sig=a=b" },
      ],
      reference: "mic",
    })
  })

  it("reads full rows from --sources-file", async () => {
    mocks.audioSync.mockResolvedValueOnce({ jobId: "j" })
    const rows = [{ id: "a", url: "https://x/a.wav" }, { id: "b", url: "https://x/b.wav" }]
    await runCmd("edit", "audio-sync", "--sources-file", fixture("sources.json", rows), "--json")
    expect(mocks.audioSync).toHaveBeenCalledWith({ sources: rows })
  })

  it("refuses fewer than two recordings before any request", async () => {
    await expect(runCmd("edit", "audio-sync", "--source", "https://x/a.wav")).rejects.toThrow("process.exit(1)")
    expect(mocks.audioSync).not.toHaveBeenCalled()
    expect(vi.mocked(warn).mock.calls[0]?.[0]).toMatch(/2-6 recordings/)
  })

  it("refuses more than six recordings before any request", async () => {
    const args = Array.from({ length: 7 }, (_, i) => ["--source", `https://x/${i}.wav`]).flat()
    await expect(runCmd("edit", "audio-sync", ...args)).rejects.toThrow("process.exit(1)")
    expect(mocks.audioSync).not.toHaveBeenCalled()
  })
})

describe("edit tighten-episode", () => {
  it("maps flags to client.edit.tightenEpisode", async () => {
    mocks.tightenEpisode.mockResolvedValueOnce({ jobId: "job-1" })
    await runCmd("edit", "tighten-episode", "--media", "https://r2/ep.mp4", "--output", "audio", "--review", "--plan-tier", "premium", "--json")
    expect(mocks.tightenEpisode).toHaveBeenCalledWith({ mediaUrl: "https://r2/ep.mp4", output: "audio", reviewBeforeRender: true, planTier: "premium" })
  })

  it("sends framing with its layout, music, no captions and instructions", async () => {
    mocks.tightenEpisode.mockResolvedValueOnce({ jobId: "job-2" })
    await runCmd(
      "edit", "tighten-episode",
      "--media", "https://r2/ep.mp4",
      "--music", "https://r2/bed.mp3",
      "--framing", "9:16", "--layout", "stacked",
      "--no-captions",
      "--instructions", "keep the intro",
      "--json",
    )
    expect(mocks.tightenEpisode).toHaveBeenCalledWith({
      mediaUrl: "https://r2/ep.mp4",
      musicUrl: "https://r2/bed.mp3",
      framing: { aspect: "9:16", layout: "stacked" },
      captions: false,
      instructions: "keep the intro",
    })
  })

  it("frames with the automatic layout when --layout is not given", async () => {
    mocks.tightenEpisode.mockResolvedValueOnce({ jobId: "job-3" })
    await runCmd("edit", "tighten-episode", "--media", "https://r2/ep.mp4", "--framing", "16:9", "--json")
    expect(mocks.tightenEpisode).toHaveBeenCalledWith({ mediaUrl: "https://r2/ep.mp4", framing: { aspect: "16:9", layout: "auto" } })
  })

  it("names the command it ran on the queued line", async () => {
    mocks.tightenEpisode.mockResolvedValueOnce({ jobId: "job-1" })
    await runCmd("edit", "tighten-episode", "--media", "https://r2/ep.mp4")
    expect(vi.mocked(success)).toHaveBeenCalledWith("job job-1 queued (tighten-episode)")
  })

  it("refuses --layout without --framing before any request", async () => {
    await expect(runCmd("edit", "tighten-episode", "--media", "https://r2/ep.mp4", "--layout", "grid")).rejects.toThrow("process.exit(1)")
    expect(mocks.tightenEpisode).not.toHaveBeenCalled()
    expect(vi.mocked(warn).mock.calls[0]?.[0]).toMatch(/^--layout applies with --framing only/)
  })

  it("refuses an unknown --output, --plan-tier, --framing or --layout before any request", async () => {
    await expect(runCmd("edit", "tighten-episode", "--media", "https://r2/ep.mp4", "--output", "gif")).rejects.toThrow("process.exit(1)")
    await expect(runCmd("edit", "tighten-episode", "--media", "https://r2/ep.mp4", "--plan-tier", "gold")).rejects.toThrow("process.exit(1)")
    await expect(runCmd("edit", "tighten-episode", "--media", "https://r2/ep.mp4", "--framing", "21:9")).rejects.toThrow("process.exit(1)")
    await expect(runCmd("edit", "tighten-episode", "--media", "https://r2/ep.mp4", "--framing", "16:9", "--layout", "mosaic")).rejects.toThrow("process.exit(1)")
    expect(mocks.tightenEpisode).not.toHaveBeenCalled()
    expect(vi.mocked(warn).mock.calls.map((c) => c[0])).toEqual([
      expect.stringMatching(/^--output must be/),
      expect.stringMatching(/^--plan-tier must be/),
      expect.stringMatching(/^--framing must be/),
      expect.stringMatching(/^--layout must be/),
    ])
  })
})

describe("edit episode-chapters", () => {
  it("maps flags to client.edit.episodeChapters", async () => {
    mocks.episodeChapters.mockResolvedValueOnce({ jobId: "job-c" })
    await runCmd(
      "edit", "episode-chapters",
      "--media", "https://r2/ep.mp4",
      "--plan-tier", "standard",
      "--instructions", "5 to 8 chapters",
      "--style-guide", "Short titles",
      "--idempotency-key", "key-12345",
      "--json",
    )
    expect(mocks.episodeChapters).toHaveBeenCalledWith(
      { mediaUrl: "https://r2/ep.mp4", planTier: "standard", instructions: "5 to 8 chapters", styleGuide: "Short titles" },
      { idempotencyKey: "key-12345" },
    )
    expect(vi.mocked(emit)).toHaveBeenCalledWith({ jobId: "job-c" }, expect.anything())
  })

  it("sends only the recording when nothing else is given", async () => {
    mocks.episodeChapters.mockResolvedValueOnce({ jobId: "job-c" })
    await runCmd("edit", "episode-chapters", "--media", "https://r2/ep.mp4", "--json")
    expect(mocks.episodeChapters).toHaveBeenCalledWith({ mediaUrl: "https://r2/ep.mp4" }, undefined)
  })

  it("with --watch, prints the show notes once the run completes", async () => {
    mocks.episodeChapters.mockResolvedValueOnce({ jobId: "job-c" })
    mocks.jobsGetStatus.mockResolvedValueOnce({ data: { id: "job-c", status: "completed", output_data: { text: "0:00 Intro\n4:05 The interview" } } })
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      await runCmd("edit", "episode-chapters", "--media", "https://r2/ep.mp4", "--watch", "--poll-interval", "1")
      expect(log).toHaveBeenCalledWith("0:00 Intro\n4:05 The interview")
    } finally {
      log.mockRestore()
    }
  })

  it("names the command it ran on the queued line", async () => {
    mocks.episodeChapters.mockResolvedValueOnce({ jobId: "job-c" })
    await runCmd("edit", "episode-chapters", "--media", "https://r2/ep.mp4")
    expect(vi.mocked(success)).toHaveBeenCalledWith("job job-c queued (episode-chapters)")
  })

  it("refuses an unknown --plan-tier before any request", async () => {
    await expect(runCmd("edit", "episode-chapters", "--media", "https://r2/ep.mp4", "--plan-tier", "gold")).rejects.toThrow("process.exit(1)")
    expect(mocks.episodeChapters).not.toHaveBeenCalled()
    expect(vi.mocked(warn).mock.calls[0]?.[0]).toMatch(/^--plan-tier must be/)
  })
})

describe("edit episode-trailer", () => {
  it("maps flags to client.edit.episodeTrailer, the formats split on commas", async () => {
    mocks.episodeTrailer.mockResolvedValueOnce({ jobId: "job-t" })
    await runCmd(
      "edit", "episode-trailer",
      "--media", "https://r2/ep.mp4",
      "--intro-card", "https://r2/card.mp4",
      "--formats", "9:16, 16:9",
      "--plan-tier", "premium",
      "--instructions", "open on the laugh",
      "--style-guide", "brisk",
      "--idempotency-key", "key-t-12345",
      "--json",
    )
    expect(mocks.episodeTrailer).toHaveBeenCalledWith(
      {
        mediaUrl: "https://r2/ep.mp4",
        introCardUrl: "https://r2/card.mp4",
        formats: ["9:16", "16:9"],
        planTier: "premium",
        instructions: "open on the laugh",
        styleGuide: "brisk",
      },
      { idempotencyKey: "key-t-12345" },
    )
    expect(vi.mocked(emit)).toHaveBeenCalledWith({ jobId: "job-t" }, expect.anything())
  })

  it("sends only the recording when nothing else is given", async () => {
    mocks.episodeTrailer.mockResolvedValueOnce({ jobId: "job-t" })
    await runCmd("edit", "episode-trailer", "--media", "https://r2/ep.mp4", "--json")
    expect(mocks.episodeTrailer).toHaveBeenCalledWith({ mediaUrl: "https://r2/ep.mp4" }, undefined)
  })

  it("--review asks for the preview and prints how to render every format", async () => {
    mocks.episodeTrailer.mockResolvedValueOnce({ jobId: "job-t" })
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      await runCmd("edit", "episode-trailer", "--media", "https://r2/ep.mp4", "--review")
      expect(mocks.episodeTrailer).toHaveBeenCalledWith({ mediaUrl: "https://r2/ep.mp4", reviewBeforeRender: true }, undefined)
      expect(log.mock.calls.map((c) => String(c[0])).join("\n")).toContain("nodaro edit continue-use-case job-t --mode render-final")
    } finally {
      log.mockRestore()
    }
  })

  it("--review with --json prints the job as JSON and nothing else", async () => {
    mocks.episodeTrailer.mockResolvedValueOnce({ jobId: "job-t" })
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      await runCmd("edit", "episode-trailer", "--media", "https://r2/ep.mp4", "--review", "--json")
      expect(log).not.toHaveBeenCalled()
    } finally {
      log.mockRestore()
    }
  })

  it("with --watch, prints each format's trailer once the run completes", async () => {
    mocks.episodeTrailer.mockResolvedValueOnce({ jobId: "job-t" })
    mocks.jobsGetStatus.mockResolvedValueOnce({
      data: { id: "job-t", status: "completed", output_data: { formats: [{ format: "9:16", url: "https://r2/a.mp4" }, { format: "1:1", url: "https://r2/b.mp4" }] } },
    })
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      await runCmd("edit", "episode-trailer", "--media", "https://r2/ep.mp4", "--watch", "--poll-interval", "1")
      expect(log).toHaveBeenCalledWith("9:16  https://r2/a.mp4")
      expect(log).toHaveBeenCalledWith("1:1  https://r2/b.mp4")
      expect(log.mock.calls.some(([line]) => String(line).startsWith("Could not render"))).toBe(false)
    } finally {
      log.mockRestore()
    }
  })

  it("with --watch, names the formats that could not be rendered after the ones it delivered", async () => {
    mocks.episodeTrailer.mockResolvedValueOnce({ jobId: "job-t" })
    mocks.jobsGetStatus.mockResolvedValueOnce({
      data: { id: "job-t", status: "completed", output_data: { formats: [{ format: "4:5", url: "https://r2/c.mp4" }], failedFormats: ["9:16", "1:1"] } },
    })
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      await runCmd("edit", "episode-trailer", "--media", "https://r2/ep.mp4", "--watch", "--poll-interval", "1")
      expect(log.mock.calls.map(([line]) => line)).toEqual(expect.arrayContaining(["4:5  https://r2/c.mp4", "Could not render: 9:16, 1:1"]))
      const lines = log.mock.calls.map(([line]) => String(line))
      expect(lines.indexOf("Could not render: 9:16, 1:1")).toBeGreaterThan(lines.indexOf("4:5  https://r2/c.mp4"))
    } finally {
      log.mockRestore()
    }
  })

  it("refuses an unknown or empty --formats, or an unknown --plan-tier, before any request", async () => {
    await expect(runCmd("edit", "episode-trailer", "--media", "https://r2/ep.mp4", "--formats", "9:16,21:9")).rejects.toThrow("process.exit(1)")
    await expect(runCmd("edit", "episode-trailer", "--media", "https://r2/ep.mp4", "--formats", " , ")).rejects.toThrow("process.exit(1)")
    await expect(runCmd("edit", "episode-trailer", "--media", "https://r2/ep.mp4", "--plan-tier", "gold")).rejects.toThrow("process.exit(1)")
    expect(mocks.episodeTrailer).not.toHaveBeenCalled()
    expect(vi.mocked(warn).mock.calls.map((c) => c[0])).toEqual([
      expect.stringMatching(/^--formats must be one or more of 9:16, 1:1, 4:5, 16:9/),
      expect.stringMatching(/^--formats must be/),
      expect.stringMatching(/^--plan-tier must be/),
    ])
  })
})

describe("edit continue-use-case", () => {
  it("continues a failed run with only the job and the mode", async () => {
    mocks.continueUseCase.mockResolvedValueOnce({ jobId: "job-2", executionId: "exec-2" })
    await runCmd("edit", "continue-use-case", "job-1", "--mode", "from-failed", "--json")
    expect(mocks.continueUseCase).toHaveBeenCalledWith({ jobId: "job-1", mode: "from-failed" }, undefined)
  })

  it("renders the final with the reviewer's edit and an idempotency key", async () => {
    mocks.continueUseCase.mockResolvedValueOnce({ jobId: "job-3" })
    await runCmd(
      "edit", "continue-use-case", "job-1",
      "--mode", "render-final",
      "--edit", fixture("edit.json", EDL),
      "--idempotency-key", "retry-7",
      "--json",
    )
    expect(mocks.continueUseCase).toHaveBeenCalledWith(
      { jobId: "job-1", mode: "render-final", editedEdl: EDL },
      { idempotencyKey: "retry-7" },
    )
  })

  it("--type names the run's node type, passed through so the job is not read for it", async () => {
    mocks.continueUseCase.mockResolvedValueOnce({ jobId: "job-2" })
    await runCmd("edit", "continue-use-case", "job-1", "--mode", "from-failed", "--type", "tighten-episode", "--json")
    expect(mocks.continueUseCase).toHaveBeenCalledWith({ jobId: "job-1", mode: "from-failed", nodeType: "tighten-episode" }, undefined)
  })

  it("--type episode-chapters continues a Chapters run", async () => {
    mocks.continueUseCase.mockResolvedValueOnce({ jobId: "job-2" })
    await runCmd("edit", "continue-use-case", "job-1", "--mode", "from-failed", "--type", "episode-chapters", "--json")
    expect(mocks.continueUseCase).toHaveBeenCalledWith({ jobId: "job-1", mode: "from-failed", nodeType: "episode-chapters" }, undefined)
  })

  it("--type episode-trailer renders a Trailer's final", async () => {
    mocks.continueUseCase.mockResolvedValueOnce({ jobId: "job-2" })
    await runCmd("edit", "continue-use-case", "job-1", "--mode", "render-final", "--type", "episode-trailer", "--json")
    expect(mocks.continueUseCase).toHaveBeenCalledWith({ jobId: "job-1", mode: "render-final", nodeType: "episode-trailer" }, undefined)
  })

  it("a run whose type the key can't read asks for --type, not the SDK's nodeType", async () => {
    const typeUnknown = () =>
      new NodaroError("continueUseCase: the run's node type cannot be read — pass nodeType", "use_case_type_unknown", 400)
    mocks.continueUseCase.mockRejectedValueOnce(typeUnknown())
    const errLog = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      await expect(runCmd("edit", "continue-use-case", "job-1", "--mode", "from-failed")).rejects.toThrow("process.exit(1)")
      const lines = errLog.mock.calls.map((c) => String(c[0]))
      expect(lines[0]).toContain("pass --type <node type> (this key can't read the job's type)")
      expect(lines.join("\n")).toContain("use_case_type_unknown")
      expect(lines.join("\n")).not.toContain("nodeType")
    } finally {
      errLog.mockRestore()
    }
    // --json: the documented error shape on stdout, keeping the SDK's code.
    vi.mocked(emit).mockClear()
    mocks.continueUseCase.mockRejectedValueOnce(typeUnknown())
    await expect(runCmd("edit", "continue-use-case", "job-1", "--mode", "from-failed", "--json")).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(emit)).toHaveBeenCalledWith(
      { error: { code: "use_case_type_unknown", message: "pass --type <node type> (this key can't read the job's type)" } },
      expect.anything(),
    )
  })

  it("refuses a --type that is no use-case node before any request", async () => {
    await expect(runCmd("edit", "continue-use-case", "job-1", "--mode", "from-failed", "--type", "apply-edl")).rejects.toThrow(
      "process.exit(1)",
    )
    expect(mocks.continueUseCase).not.toHaveBeenCalled()
    expect(vi.mocked(warn).mock.calls.map((c) => c[0])).toEqual([`--type must be ${USE_CASE_NODE_TYPES.join(", ")} (got "apply-edl")`])
  })

  it("refuses an unknown --mode, or --edit without render-final, before any request", async () => {
    await expect(runCmd("edit", "continue-use-case", "job-1", "--mode", "resume")).rejects.toThrow("process.exit(1)")
    await expect(
      runCmd("edit", "continue-use-case", "job-1", "--mode", "from-failed", "--edit", fixture("edit.json", EDL)),
    ).rejects.toThrow("process.exit(1)")
    expect(mocks.continueUseCase).not.toHaveBeenCalled()
    expect(vi.mocked(warn).mock.calls.map((c) => c[0])).toEqual([
      expect.stringMatching(/^--mode must be/),
      expect.stringMatching(/^--edit applies to --mode render-final only/),
    ])
  })

  it("a refusal that names a job prints, on stderr, its message, code and that job with the next step", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {})
    const emitted = vi.mocked(emit).mock.calls.length
    mocks.continueUseCase.mockRejectedValueOnce(
      new ContinuationRefusedError("A later continuation of this run failed: continue that one.", "continuation_superseded", "job-newer"),
    )
    await expect(runCmd("edit", "continue-use-case", "job-1", "--mode", "from-failed")).rejects.toThrow("process.exit(1)")
    const lines = stderr.mock.calls.map((c) => String(c[0]))
    stderr.mockRestore()
    expect(lines[0]).toContain("✗ A later continuation of this run failed: continue that one.")
    expect(lines[1]).toContain("code: continuation_superseded")
    expect(lines[2]).toContain("job: job-newer")
    expect(lines[2]).toContain("nodaro edit continue-use-case job-newer --mode from-failed")
    expect(vi.mocked(emit).mock.calls.length).toBe(emitted)
  })

  it("with --json a named-job refusal is emitted as data", async () => {
    mocks.continueUseCase.mockRejectedValueOnce(
      new ContinuationRefusedError("Already rendered with this edit.", "render_final_already_rendered", "job-final"),
    )
    await expect(runCmd("edit", "continue-use-case", "job-1", "--mode", "render-final", "--json")).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(emit).mock.calls.at(-1)?.[0]).toEqual({
      error: { code: "render_final_already_rendered", message: "Already rendered with this edit." },
      jobId: "job-final",
    })
  })
})
