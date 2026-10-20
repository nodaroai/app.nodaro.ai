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

describe("edit speaker-map", () => {
  const SPEAKERS = { version: 1, words: [{ text: "hi", startMs: 0, endMs: 400, speaker: "speaker_0" }] }

  it("sends the --source rows (the audio-sync parser), the transcript and --wide as wideSourceId", async () => {
    mocks.speakerMap.mockResolvedValueOnce({ jobId: "j-sm" })
    await runCmd(
      "edit", "speaker-map",
      "--source", "a=https://x/a.mp4",
      "--source", "b=https://x/b.mp4",
      "--transcript", fixture("t.json", SPEAKERS),
      "--wide", "b", "--json",
    )
    expect(mocks.speakerMap).toHaveBeenCalledWith({
      sources: [{ id: "a", url: "https://x/a.mp4" }, { id: "b", url: "https://x/b.mp4" }],
      transcript: SPEAKERS,
      wideSourceId: "b",
    })
  })

  it("passes --offsets, --master and --margin-db when given", async () => {
    mocks.speakerMap.mockResolvedValueOnce({ jobId: "j" })
    const offsets = { reference: "a", offsets: [], notes: [] }
    await runCmd(
      "edit", "speaker-map",
      "--source", "a=https://x/a.mp4", "--source", "b=https://x/b.mp4",
      "--transcript", fixture("t.json", SPEAKERS),
      "--offsets", fixture("o.json", offsets), "--master", "a", "--margin-db", "4", "--json",
    )
    expect(mocks.speakerMap).toHaveBeenCalledWith(expect.objectContaining({ offsets, masterSourceId: "a", marginDb: 4 }))
  })

  it("refuses fewer than two recordings before any request", async () => {
    await expect(
      runCmd("edit", "speaker-map", "--source", "https://x/a.mp4", "--transcript", fixture("t.json", SPEAKERS)),
    ).rejects.toThrow("process.exit(1)")
    expect(mocks.speakerMap).not.toHaveBeenCalled()
    expect(vi.mocked(warn).mock.calls[0]?.[0]).toMatch(/2-6 recordings/)
  })
})

describe("edit switch-cameras --speaker-map-result", () => {
  it("hands the Speaker Map result to the SDK beside --speaker-map", async () => {
    mocks.cameraSwitch.mockResolvedValueOnce({ jobId: "j-cs" })
    const result = { version: 1, speakerMap: { speaker_0: "a" }, confidence: {}, notes: [] }
    await runCmd(
      "edit", "switch-cameras",
      "--edl", fixture("edl.json", EDL),
      "--transcript", fixture("t.json", TRANSCRIPT),
      "--speaker-map", fixture("m.json", { speaker_1: "b" }),
      "--speaker-map-result", fixture("r.json", result), "--json",
    )
    expect(mocks.cameraSwitch).toHaveBeenCalledWith(expect.objectContaining({ speakerMap: { speaker_1: "b" }, speakerMapResult: result }))
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
