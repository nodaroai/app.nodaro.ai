// `nodaro edit`'s use-case node commands (tighten-episode, episode-chapters,
// episode-trailer, clip-pack, speaker-layout, continue-use-case), split from edit.test.ts past
// its size: the same harness.
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
  speakerMap: vi.fn(),
  cameraSwitch: vi.fn(),
  applyEdl: vi.fn(),
  editPlan: vi.fn(),
  tightenEpisode: vi.fn(),
  episodeChapters: vi.fn(),
  episodeTrailer: vi.fn(),
  clipPack: vi.fn(),
  speakerLayout: vi.fn(),
  continueUseCase: vi.fn(),
  jobsGetStatus: vi.fn(),
}

vi.mock("../../client.js", () => ({
  buildClient: () => ({
    edit: {
      silenceDetect: mocks.silenceDetect,
      audioSync: mocks.audioSync,
      speakerMap: mocks.speakerMap,
      cameraSwitch: mocks.cameraSwitch,
      applyEdl: mocks.applyEdl,
      editPlan: mocks.editPlan,
      tightenEpisode: mocks.tightenEpisode,
      episodeChapters: mocks.episodeChapters,
      episodeTrailer: mocks.episodeTrailer,
      clipPack: mocks.clipPack,
      speakerLayout: mocks.speakerLayout,
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

  it("sends --framing-source with --framing (decided 2026-10-17/20)", async () => {
    for (const source of ["auto", "static", "tracking"]) {
      mocks.tightenEpisode.mockResolvedValueOnce({ jobId: "job-f" })
      await runCmd("edit", "tighten-episode", "--media", "https://r2/ep.mp4", "--framing", "9:16", "--framing-source", source, "--json")
      expect(mocks.tightenEpisode).toHaveBeenLastCalledWith({ mediaUrl: "https://r2/ep.mp4", framing: { aspect: "9:16", layout: "auto" }, framingSource: source })
    }
  })

  it("refuses --framing-source without --framing, or an unknown one, before any request", async () => {
    await expect(runCmd("edit", "tighten-episode", "--media", "https://r2/ep.mp4", "--framing-source", "tracking")).rejects.toThrow("process.exit(1)")
    await expect(runCmd("edit", "tighten-episode", "--media", "https://r2/ep.mp4", "--framing", "9:16", "--framing-source", "faces")).rejects.toThrow("process.exit(1)")
    expect(mocks.tightenEpisode).not.toHaveBeenCalled()
    expect(vi.mocked(warn).mock.calls.map((c) => c[0])).toEqual([
      expect.stringMatching(/^--framing-source applies with --framing only/),
      expect.stringMatching(/^--framing-source must be/),
    ])
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

describe("edit tighten-episode on several recordings (decided 2026-10-19)", () => {
  it("maps repeated --media, --master-audio and the camera flags to the recordings input", async () => {
    mocks.tightenEpisode.mockResolvedValueOnce({ jobId: "job-m" })
    await runCmd(
      "edit", "tighten-episode",
      "--media", "https://r2/a.mp4", "--media", "https://r2/b.mp4",
      "--master-audio", "https://r2/m.wav",
      "--wide-camera", "2",
      "--speaker-camera", "1=2", "--speaker-camera", "2=0",
      "--json",
    )
    expect(mocks.tightenEpisode).toHaveBeenCalledWith({
      mediaUrls: ["https://r2/a.mp4", "https://r2/b.mp4"],
      masterAudioUrl: "https://r2/m.wav",
      cameras: { wide: 2, speakerCameras: { "1": 2, "2": 0 } },
    })
  })

  it("--synced, and one --media with a Master audio", async () => {
    mocks.tightenEpisode.mockResolvedValueOnce({ jobId: "job-s" })
    await runCmd("edit", "tighten-episode", "--media", "https://r2/a.mp4", "--master-audio", "https://r2/m.wav", "--synced", "--json")
    expect(mocks.tightenEpisode).toHaveBeenCalledWith({ mediaUrl: "https://r2/a.mp4", masterAudioUrl: "https://r2/m.wav", cameras: { synced: true } })
  })

  it("refuses a camera flag with one recording and no Master audio, and malformed camera flags, before any request", async () => {
    await expect(runCmd("edit", "tighten-episode", "--media", "https://r2/a.mp4", "--wide-camera", "1")).rejects.toThrow("process.exit(1)")
    const two = ["--media", "https://r2/a.mp4", "--media", "https://r2/b.mp4"]
    await expect(runCmd("edit", "tighten-episode", ...two, "--wide-camera", "0")).rejects.toThrow("process.exit(1)")
    await expect(runCmd("edit", "tighten-episode", ...two, "--speaker-camera", "1")).rejects.toThrow("process.exit(1)")
    await expect(runCmd("edit", "tighten-episode", ...two, "--speaker-camera", "0=1")).rejects.toThrow("process.exit(1)")
    await expect(runCmd("edit", "tighten-episode", ...two, "--speaker-camera", "1=-1")).rejects.toThrow("process.exit(1)")
    await expect(runCmd("edit", "tighten-episode", ...two, "--speaker-camera", "1=1", "--speaker-camera", "1=2")).rejects.toThrow("process.exit(1)")
    expect(mocks.tightenEpisode).not.toHaveBeenCalled()
    expect(vi.mocked(warn).mock.calls.map((c) => c[0])).toEqual([
      expect.stringMatching(/^--wide-camera, --synced and --speaker-camera apply with several --media or --master-audio/),
      expect.stringMatching(/^--wide-camera must be a recording number/),
      expect.stringMatching(/^--speaker-camera must be <speaker>=<recording>/),
      expect.stringMatching(/^--speaker-camera must be <speaker>=<recording>/),
      expect.stringMatching(/^--speaker-camera must be <speaker>=<recording>/),
      expect.stringMatching(/^--speaker-camera names speaker 1 twice/),
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

describe("edit episode-trailer on several recordings (decided 2026-10-20)", () => {
  it("maps repeated --media, --master-audio and the camera flags to the recordings input, beside the formats", async () => {
    mocks.episodeTrailer.mockResolvedValueOnce({ jobId: "job-m" })
    await runCmd(
      "edit", "episode-trailer",
      "--media", "https://r2/a.mp4", "--media", "https://r2/b.mp4",
      "--master-audio", "https://r2/m.wav",
      "--wide-camera", "2",
      "--speaker-camera", "1=2",
      "--formats", "16:9",
      "--json",
    )
    expect(mocks.episodeTrailer).toHaveBeenCalledWith({
      mediaUrls: ["https://r2/a.mp4", "https://r2/b.mp4"],
      masterAudioUrl: "https://r2/m.wav",
      cameras: { wide: 2, speakerCameras: { "1": 2 } },
      formats: ["16:9"],
    }, undefined)
  })

  it("refuses a camera flag with one recording and no Master audio, before any request", async () => {
    await expect(runCmd("edit", "episode-trailer", "--media", "https://r2/a.mp4", "--synced")).rejects.toThrow("process.exit(1)")
    expect(mocks.episodeTrailer).not.toHaveBeenCalled()
    expect(vi.mocked(warn).mock.calls.map((c) => c[0])).toEqual([expect.stringMatching(/^--wide-camera, --synced and --speaker-camera apply with several --media or --master-audio/)])
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

describe("edit clip-pack on several recordings and with a framing source (decided 2026-10-17/20)", () => {
  it("repeated --media, --master-audio and the Cameras flags map to the recordings input; --framing-source to framingSource", async () => {
    mocks.clipPack.mockResolvedValueOnce({ jobId: "job-c" })
    await runCmd(
      "edit", "clip-pack",
      "--media", "https://r2/a.mp4", "--media", "https://r2/b.mp4",
      "--master-audio", "https://r2/m.wav",
      "--synced", "--speaker-camera", "1=2",
      "--framing-source", "tracking",
      "--json",
    )
    expect(mocks.clipPack).toHaveBeenCalledWith(
      {
        mediaUrls: ["https://r2/a.mp4", "https://r2/b.mp4"],
        masterAudioUrl: "https://r2/m.wav",
        cameras: { synced: true, speakerCameras: { "1": 2 } },
        framingSource: "tracking",
      },
      undefined,
    )
  })
  it("one --media is the one-recording request it always was", async () => {
    mocks.clipPack.mockResolvedValueOnce({ jobId: "job-c" })
    await runCmd("edit", "clip-pack", "--media", "https://r2/ep.mp4", "--json")
    expect(mocks.clipPack).toHaveBeenCalledWith({ mediaUrl: "https://r2/ep.mp4" }, undefined)
  })
  it("an unknown --framing-source, or one with --framing none, exits 1 before any request", async () => {
    await expect(runCmd("edit", "clip-pack", "--media", "https://r2/ep.mp4", "--framing-source", "faces")).rejects.toThrow("process.exit(1)")
    await expect(runCmd("edit", "clip-pack", "--media", "https://r2/ep.mp4", "--framing", "none", "--framing-source", "auto")).rejects.toThrow("process.exit(1)")
    expect(mocks.clipPack).not.toHaveBeenCalled()
  })
  it("the Cameras flags with one recording exit 1 before any request", async () => {
    await expect(runCmd("edit", "clip-pack", "--media", "https://r2/ep.mp4", "--synced")).rejects.toThrow("process.exit(1)")
    expect(mocks.clipPack).not.toHaveBeenCalled()
  })
})

describe("edit clip-pack", () => {
  it("maps flags to client.edit.clipPack", async () => {
    mocks.clipPack.mockResolvedValueOnce({ jobId: "job-c" })
    await runCmd(
      "edit", "clip-pack",
      "--media", "https://r2/ep.mp4",
      "--count", "5",
      "--length", "45",
      "--framing", "1:1",
      "--layout", "side-by-side",
      "--no-captions",
      "--plan-tier", "premium",
      "--instructions", "the funniest moments",
      "--style-guide", "brisk",
      "--idempotency-key", "key-c-12345",
      "--json",
    )
    expect(mocks.clipPack).toHaveBeenCalledWith(
      {
        mediaUrl: "https://r2/ep.mp4",
        count: 5,
        targetDurationSec: 45,
        framing: { aspect: "1:1", layout: "side-by-side" },
        captions: false,
        planTier: "premium",
        instructions: "the funniest moments",
        styleGuide: "brisk",
      },
      { idempotencyKey: "key-c-12345" },
    )
    expect(vi.mocked(emit)).toHaveBeenCalledWith({ jobId: "job-c" }, expect.anything())
  })

  it("sends only the recording when nothing else is given", async () => {
    mocks.clipPack.mockResolvedValueOnce({ jobId: "job-c" })
    await runCmd("edit", "clip-pack", "--media", "https://r2/ep.mp4", "--json")
    expect(mocks.clipPack).toHaveBeenCalledWith({ mediaUrl: "https://r2/ep.mp4" }, undefined)
  })

  it("--framing none sends framing: null (the recording's shape); an aspect alone leaves the layout to the route", async () => {
    mocks.clipPack.mockResolvedValueOnce({ jobId: "job-c" }).mockResolvedValueOnce({ jobId: "job-d" })
    await runCmd("edit", "clip-pack", "--media", "https://r2/ep.mp4", "--framing", "none", "--json")
    expect(mocks.clipPack).toHaveBeenLastCalledWith({ mediaUrl: "https://r2/ep.mp4", framing: null }, undefined)
    await runCmd("edit", "clip-pack", "--media", "https://r2/ep.mp4", "--framing", "9:16", "--json")
    expect(mocks.clipPack).toHaveBeenLastCalledWith({ mediaUrl: "https://r2/ep.mp4", framing: { aspect: "9:16" } }, undefined)
  })

  it("--review asks for the previews and prints how to render the kept clips", async () => {
    mocks.clipPack.mockResolvedValueOnce({ jobId: "job-c" })
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      await runCmd("edit", "clip-pack", "--media", "https://r2/ep.mp4", "--review")
      expect(mocks.clipPack).toHaveBeenCalledWith({ mediaUrl: "https://r2/ep.mp4", reviewBeforeRender: true }, undefined)
      expect(log.mock.calls.map((c) => String(c[0])).join("\n")).toContain("nodaro edit continue-use-case job-c --mode render-final")
    } finally {
      log.mockRestore()
    }
  })

  it("with --watch, prints each clip once the run completes", async () => {
    mocks.clipPack.mockResolvedValueOnce({ jobId: "job-c" })
    mocks.jobsGetStatus.mockResolvedValueOnce({
      data: {
        id: "job-c",
        status: "completed",
        output_data: {
          clips: [
            { url: "https://r2/a.mp4", title: "The hook", clipKey: "k1" },
            { url: "https://r2/b.mp4", title: "The turn", clipKey: "k2", captionsFailed: true },
            { url: "https://r2/c.mp4", clipKey: "k3", captionsFailed: true },
          ],
          failedClips: 2,
        },
      },
    })
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      await runCmd("edit", "clip-pack", "--media", "https://r2/ep.mp4", "--watch", "--poll-interval", "1")
      expect(log).toHaveBeenCalledWith("1  https://r2/a.mp4  The hook")
      // An uncaptioned clip keeps its title; the note follows it.
      expect(log).toHaveBeenCalledWith("2  https://r2/b.mp4  The turn (no captions)")
      expect(log).toHaveBeenCalledWith("3  https://r2/c.mp4  (no captions)")
      expect(log).toHaveBeenCalledWith("2 clips could not be rendered.")
    } finally {
      log.mockRestore()
    }
  })

  it("with --watch, one clip that could not be rendered is said in the singular, and none says nothing", async () => {
    const run = async (failedClips?: number) => {
      mocks.clipPack.mockResolvedValueOnce({ jobId: "job-c" })
      mocks.jobsGetStatus.mockResolvedValueOnce({
        data: { id: "job-c", status: "completed", output_data: { clips: [{ url: "https://r2/a.mp4", clipKey: "k1" }], ...(failedClips !== undefined ? { failedClips } : {}) } },
      })
      const log = vi.spyOn(console, "log").mockImplementation(() => {})
      try {
        await runCmd("edit", "clip-pack", "--media", "https://r2/ep.mp4", "--watch", "--poll-interval", "1")
        return log.mock.calls.map((c) => String(c[0]))
      } finally {
        log.mockRestore()
      }
    }
    expect(await run(1)).toContain("1 clip could not be rendered.")
    expect((await run()).some((l) => l.includes("could not be rendered"))).toBe(false)
  })

  it("refuses a bad --count, --length, --framing or --layout before any request", async () => {
    const bad: string[][] = [
      ["--count", "60"],
      ["--count", "0"],
      ["--count", "2.5"],
      ["--length", "4"],
      ["--length", "181"],
      ["--framing", "21:9"],
      ["--layout", "stacked"],
      ["--framing", "none", "--layout", "stacked"],
      ["--framing", "9:16", "--layout", "diagonal"],
      ["--plan-tier", "gold"],
    ]
    for (const args of bad) {
      await expect(runCmd("edit", "clip-pack", "--media", "https://r2/ep.mp4", ...args), args.join(" ")).rejects.toThrow("process.exit(1)")
    }
    expect(mocks.clipPack).not.toHaveBeenCalled()
    const warned = vi.mocked(warn).mock.calls.map((c) => String(c[0]))
    expect(warned[0]).toMatch(/^--count must be 1–50/)
    expect(warned[3]).toMatch(/^--length must be 5–180 seconds/)
    expect(warned[6]).toMatch(/^--layout applies with --framing <aspect> only/)
    expect(warned[7]).toMatch(/^--layout applies with --framing <aspect> only/)
  })
  it("maps --switch, --emphasis (with --framing <aspect>) and --caption-style to the framing and the captions' look", async () => {
    mocks.clipPack.mockResolvedValueOnce({ jobId: "job-c" })
    await runCmd(
      "edit", "clip-pack", "--media", "https://r2/ep.mp4",
      "--framing", "9:16", "--switch", "xfade:fade", "--emphasis", "scale+border", "--caption-style", "word-pop", "--json",
    )
    expect(mocks.clipPack).toHaveBeenCalledWith(
      {
        mediaUrl: "https://r2/ep.mp4",
        framing: { aspect: "9:16", switchType: "xfade:fade", emphasisStyle: "scale+border" },
        captionStyle: "word-pop",
      },
      undefined,
    )
  })

  it("refuses a bad --switch, --emphasis or --caption-style, or one without what it applies to, before any request", async () => {
    const bad: string[][] = [
      ["--switch", "pan"],
      ["--framing", "none", "--emphasis", "scale"],
      ["--framing", "9:16", "--switch", "teleport"],
      ["--framing", "9:16", "--emphasis", "glow"],
      ["--framing", "9:16", "--emphasis", "scale+scale"],
      ["--framing", "9:16", "--emphasis", "none+dim"],
      ["--caption-style", "comic"],
      ["--no-captions", "--caption-style", "karaoke"],
    ]
    for (const args of bad) {
      await expect(runCmd("edit", "clip-pack", "--media", "https://r2/ep.mp4", ...args), args.join(" ")).rejects.toThrow("process.exit(1)")
    }
    expect(mocks.clipPack).not.toHaveBeenCalled()
    const warned = vi.mocked(warn).mock.calls.map((c) => String(c[0]))
    expect(warned[0]).toMatch(/^--switch applies with --framing <aspect> only/)
    expect(warned[1]).toMatch(/^--emphasis applies with --framing <aspect> only/)
    expect(warned[2]).toMatch(/^--switch must be one of cut, pan, zoom, xfade:fade/)
    expect(warned[3]).toBe('--emphasis must be none, or scale, border, dim joined with "+" (each once) (got "glow")')
    expect(warned[4]).toMatch(/^--emphasis must be/)
    expect(warned[5]).toMatch(/^--emphasis must be/)
    expect(warned[6]).toMatch(/^--caption-style must be subtitle, word-highlight, karaoke/)
    expect(warned[7]).toBe("--caption-style applies with captions on (drop --no-captions)")
  })
})

describe("edit speaker-layout (decided 2026-10-17)", () => {
  it("sends only the recording when nothing else is given", async () => {
    mocks.speakerLayout.mockResolvedValueOnce({ jobId: "job-l" })
    await runCmd("edit", "speaker-layout", "--media", "https://r2/ep.mp4", "--json")
    expect(mocks.speakerLayout).toHaveBeenCalledWith({ mediaUrl: "https://r2/ep.mp4" }, undefined)
    expect(vi.mocked(emit)).toHaveBeenCalledWith({ jobId: "job-l" }, expect.anything())
  })

  it("maps every flag, the recordings and the camera flags to client.edit.speakerLayout", async () => {
    mocks.speakerLayout.mockResolvedValueOnce({ jobId: "job-l" })
    await runCmd(
      "edit", "speaker-layout",
      "--media", "https://r2/a.mp4", "--media", "https://r2/b.mp4",
      "--master-audio", "https://r2/m.wav",
      "--wide-camera", "2",
      "--aspect", "1:1",
      "--layout", "grid",
      "--switch", "cut",
      "--emphasis", "scale+border",
      "--framing-source", "static",
      "--review",
      "--idempotency-key", "key-l-12345",
      "--json",
    )
    expect(mocks.speakerLayout).toHaveBeenCalledWith(
      {
        mediaUrls: ["https://r2/a.mp4", "https://r2/b.mp4"],
        masterAudioUrl: "https://r2/m.wav",
        cameras: { wide: 2 },
        targetAspect: "1:1",
        layout: "grid",
        switchType: "cut",
        emphasisStyle: "scale+border",
        framingSource: "static",
        reviewBeforeRender: true,
      },
      { idempotencyKey: "key-l-12345" },
    )
  })

  it("--review prints how to render the final", async () => {
    mocks.speakerLayout.mockResolvedValueOnce({ jobId: "job-l" })
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      await runCmd("edit", "speaker-layout", "--media", "https://r2/ep.mp4", "--review")
      expect(mocks.speakerLayout).toHaveBeenCalledWith({ mediaUrl: "https://r2/ep.mp4", reviewBeforeRender: true }, undefined)
      expect(log.mock.calls.map((c) => String(c[0])).join("\n")).toContain("nodaro edit continue-use-case job-l --mode render-final")
    } finally {
      log.mockRestore()
    }
  })

  it("with --watch, prints the framed video once the run completes", async () => {
    mocks.speakerLayout.mockResolvedValueOnce({ jobId: "job-l" })
    mocks.jobsGetStatus.mockResolvedValueOnce({ data: { id: "job-l", status: "completed", output_data: { videoUrl: "https://r2/framed.mp4" } } })
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      await runCmd("edit", "speaker-layout", "--media", "https://r2/ep.mp4", "--watch", "--poll-interval", "1")
      expect(log.mock.calls.map((c) => String(c[0]))).toContain("https://r2/framed.mp4")
    } finally {
      log.mockRestore()
    }
  })

  it("refuses an unknown aspect, layout, switch, emphasis or framing source before any request", async () => {
    for (const [flag, value] of [["--aspect", "2:1"], ["--layout", "mosaic"], ["--switch", "wipe"], ["--emphasis", "glow"], ["--framing-source", "faces"]]) {
      await expect(runCmd("edit", "speaker-layout", "--media", "https://r2/ep.mp4", flag!, value!)).rejects.toThrow("process.exit(1)")
    }
    expect(mocks.speakerLayout).not.toHaveBeenCalled()
    expect(vi.mocked(warn).mock.calls.map((c) => c[0])).toEqual([
      expect.stringMatching(/^--aspect must be/),
      expect.stringMatching(/^--layout must be/),
      expect.stringMatching(/^--switch must be/),
      expect.stringMatching(/^--emphasis must be/),
      expect.stringMatching(/^--framing-source must be auto, static, tracking/),
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

  it("--type clip-pack renders a Clip Pack's kept clips", async () => {
    mocks.continueUseCase.mockResolvedValueOnce({ jobId: "job-2" })
    await runCmd("edit", "continue-use-case", "job-1", "--mode", "render-final", "--type", "clip-pack", "--json")
    expect(mocks.continueUseCase).toHaveBeenCalledWith({ jobId: "job-1", mode: "render-final", nodeType: "clip-pack" }, undefined)
  })

  it("--type speaker-layout renders a Speaker Layout's final, with no edit", async () => {
    mocks.continueUseCase.mockResolvedValueOnce({ jobId: "job-2" })
    await runCmd("edit", "continue-use-case", "job-1", "--mode", "render-final", "--type", "speaker-layout", "--json")
    expect(mocks.continueUseCase).toHaveBeenCalledWith({ jobId: "job-1", mode: "render-final", nodeType: "speaker-layout" }, undefined)
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
