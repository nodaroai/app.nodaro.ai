import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Command } from "commander"
import { voiceCommand } from "../voice.js"
import { warn, table } from "../../output.js"

/**
 * Mocked SDK shape — every method the voice command touches needs an impl.
 * Mirrors community.test.ts. `handleError` is mocked to rethrow so vitest
 * sees a normal rejection instead of process.exit.
 */
const mocks = {
  recast: vi.fn(),
  change: vi.fn(),
  analyze: vi.fn(),
  exportMix: vi.fn(),
  design: vi.fn(),
  remix: vi.fn(),
  dub: vi.fn(),
  list: vi.fn(),
  listClones: vi.fn(),
  createClone: vi.fn(),
  createCloneFromFile: vi.fn(),
  deleteClone: vi.fn(),
  jobsGet: vi.fn(),
}

vi.mock("../../client.js", () => ({
  buildClient: () => ({
    voices: {
      recast: mocks.recast,
      change: mocks.change,
      analyze: mocks.analyze,
      exportMix: mocks.exportMix,
      design: mocks.design,
      remix: mocks.remix,
      dub: mocks.dub,
      list: mocks.list,
      listClones: mocks.listClones,
      createClone: mocks.createClone,
      createCloneFromFile: mocks.createCloneFromFile,
      deleteClone: mocks.deleteClone,
    },
    jobs: { get: mocks.jobsGet },
  }),
  handleError: (err: unknown) => {
    throw err
  },
}))

// Don't print anything from `success`/`emit`/etc during the tests.
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

/** Attach a fresh `voice` command tree and dispatch argv (argv[0..1] are placeholders). */
async function runCmd(...args: string[]): Promise<void> {
  const program = new Command().exitOverride()
  program.addCommand(voiceCommand())
  await program.parseAsync(["node", "test", ...args])
}

// Validation failures call warn() + process.exit(1) directly (the CLI's
// idiom); turn the exit into a throw so the test sees a rejection.
let exitSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset()
  vi.mocked(warn).mockClear()
  vi.mocked(table).mockClear()
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code ?? 0})`)
  }) as never)
})
afterEach(() => {
  exitSpy.mockRestore()
})

describe("voice recast command", () => {
  it("maps the `keep` sentinel (any case) to null keep-slots positionally", async () => {
    mocks.recast.mockResolvedValueOnce({ jobId: "j1" })
    await runCmd("voice", "recast", "--audio", "https://a/p.mp3", "--voices", "Rachel, Keep ,Aria", "--json")
    expect(mocks.recast).toHaveBeenCalledWith({
      orderedVoices: ["Rachel", null, "Aria"],
      audioUrl: "https://a/p.mp3",
    })
  })

  it("forwards every scalar flag; video wins over audio; --no-preserve-background sends false", async () => {
    mocks.recast.mockResolvedValueOnce({ jobId: "j2" })
    await runCmd(
      "voice", "recast",
      "--video", "https://a/p.mp4", "--audio", "https://a/p.mp3",
      "--voices", "Rachel,keep,Aria",
      "--model", "eleven_multilingual_sts_v2",
      "--no-preserve-background",
      "--separation-quality", "best",
      "--music-volume-mode", "manual", "--music-volume", "80",
      "--remove-background-noise",
      "--voice-fx", "hall", "--voice-fx-mix", "35",
      "--json",
    )
    expect(mocks.recast).toHaveBeenCalledWith({
      orderedVoices: ["Rachel", null, "Aria"],
      videoUrl: "https://a/p.mp4",
      model: "eleven_multilingual_sts_v2",
      preserveBackground: false,
      separationQuality: "best",
      musicVolumeMode: "manual",
      musicVolume: 80,
      removeBackgroundNoise: true,
      voiceFx: { preset: "hall", wetDryMix: 35 },
    })
  })

  it("passes --voices-json entries (objects + nulls) through verbatim", async () => {
    mocks.recast.mockResolvedValueOnce({ jobId: "j3" })
    await runCmd(
      "voice", "recast", "--audio", "https://a/p.mp3",
      "--voices-json", '[{"voiceId":"Rachel","stability":0.6},null,"Aria"]',
      "--json",
    )
    expect(mocks.recast).toHaveBeenCalledWith({
      orderedVoices: [{ voiceId: "Rachel", stability: 0.6 }, null, "Aria"],
      audioUrl: "https://a/p.mp3",
    })
  })

  it("works via the `pro` alias", async () => {
    mocks.recast.mockResolvedValueOnce({ jobId: "j4" })
    await runCmd("voice", "pro", "--audio", "https://a/p.mp3", "--voices", "Rachel", "--json")
    expect(mocks.recast).toHaveBeenCalledWith({
      orderedVoices: ["Rachel"],
      audioUrl: "https://a/p.mp3",
    })
  })

  it("errors when every entry is a keep-slot", async () => {
    await expect(
      runCmd("voice", "recast", "--audio", "https://a/p.mp3", "--voices", "keep,keep"),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("At least one speaker"))
    expect(mocks.recast).not.toHaveBeenCalled()
  })

  it("errors when neither --voices nor --voices-json is given", async () => {
    await expect(
      runCmd("voice", "recast", "--audio", "https://a/p.mp3"),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("--voices"))
    expect(mocks.recast).not.toHaveBeenCalled()
  })

  it("errors when both --voices and --voices-json are given", async () => {
    await expect(
      runCmd("voice", "recast", "--audio", "https://a/p.mp3", "--voices", "Rachel", "--voices-json", '["Aria"]'),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("mutually exclusive"))
    expect(mocks.recast).not.toHaveBeenCalled()
  })

  it("errors when no source URL is given", async () => {
    await expect(
      runCmd("voice", "recast", "--voices", "Rachel"),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("--audio"))
    expect(mocks.recast).not.toHaveBeenCalled()
  })

  it("errors on an empty --voices entry", async () => {
    await expect(
      runCmd("voice", "recast", "--audio", "https://a/p.mp3", "--voices", "Rachel,,Aria"),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("empty"))
    expect(mocks.recast).not.toHaveBeenCalled()
  })

  it("errors on invalid --voices-json", async () => {
    await expect(
      runCmd("voice", "recast", "--audio", "https://a/p.mp3", "--voices-json", "{not json"),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("valid JSON"))
    expect(mocks.recast).not.toHaveBeenCalled()
  })

  it("errors on an empty --voices-json array with the shape message (not the all-keep message)", async () => {
    await expect(
      runCmd("voice", "recast", "--audio", "https://a/p.mp3", "--voices-json", "[]"),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("non-empty JSON array"))
    expect(mocks.recast).not.toHaveBeenCalled()
  })

  it("errors when fx tuning flags are passed without --voice-fx", async () => {
    await expect(
      runCmd("voice", "recast", "--audio", "https://a/p.mp3", "--voices", "Rachel", "--voice-fx-mix", "35"),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("--voice-fx"))
    expect(mocks.recast).not.toHaveBeenCalled()
  })

  it("forwards --output stems", async () => {
    mocks.recast.mockResolvedValueOnce({ jobId: "j5" })
    await runCmd("voice", "recast", "--audio", "https://a/p.mp3", "--voices", "Rachel", "--output", "stems", "--json")
    expect(mocks.recast).toHaveBeenCalledWith({
      orderedVoices: ["Rachel"],
      audioUrl: "https://a/p.mp3",
      output: "stems",
    })
  })

  it("errors on an unknown --output mode", async () => {
    await expect(
      runCmd("voice", "recast", "--audio", "https://a/p.mp3", "--voices", "Rachel", "--output", "both"),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("--output"))
    expect(mocks.recast).not.toHaveBeenCalled()
  })

  it("picks only the analysis keys from --analysis-json (output_data extras never hit the wire)", async () => {
    mocks.recast.mockResolvedValueOnce({ jobId: "j6" })
    const outputData = {
      vocalsUrl: "https://r2/vocals.mp3",
      backgroundUrl: "https://r2/bg.mp3",
      speakers: [{ id: "spk_0", segments: [{ start: 0, end: 4.2 }], wordCount: 12, snippet: "hello there" }],
      languageCode: "en",
      languageProbability: 0.98,
      suggestedTitle: "A chat",
    }
    await runCmd(
      "voice", "recast", "--video", "https://a/p.mp4", "--voices", "Rachel",
      "--analysis-json", JSON.stringify(outputData), "--json",
    )
    expect(mocks.recast).toHaveBeenCalledWith({
      orderedVoices: ["Rachel"],
      videoUrl: "https://a/p.mp4",
      analysis: {
        vocalsUrl: "https://r2/vocals.mp3",
        backgroundUrl: "https://r2/bg.mp3",
        speakers: [{ id: "spk_0", segments: [{ start: 0, end: 4.2 }], wordCount: 12, snippet: "hello there" }],
        languageCode: "en",
        languageProbability: 0.98,
      },
    })
  })

  it("errors when --analysis-json is not an analyze result shape", async () => {
    await expect(
      runCmd("voice", "recast", "--audio", "https://a/p.mp3", "--voices", "Rachel", "--analysis-json", '{"speakers":[]}'),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("analyze result"))
    expect(mocks.recast).not.toHaveBeenCalled()
  })

  it("errors when --analysis-json and --analysis-file are both given", async () => {
    await expect(
      runCmd(
        "voice", "recast", "--audio", "https://a/p.mp3", "--voices", "Rachel",
        "--analysis-json", "{}", "--analysis-file", "x.json",
      ),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("mutually exclusive"))
    expect(mocks.recast).not.toHaveBeenCalled()
  })
})

describe("voice changer command", () => {
  it("forwards --model / --use-speaker-boost / --seed", async () => {
    mocks.change.mockResolvedValueOnce({ jobId: "c1" })
    await runCmd(
      "voice", "changer", "--audio", "https://a/p.mp3", "--voice", "Rachel",
      "--model", "eleven_english_sts_v2", "--use-speaker-boost", "--seed", "42", "--json",
    )
    expect(mocks.change).toHaveBeenCalledWith(
      expect.objectContaining({
        voiceId: "Rachel",
        audioUrl: "https://a/p.mp3",
        model: "eleven_english_sts_v2",
        useSpeakerBoost: true,
        seed: 42,
      }),
    )
  })
})

describe("voice analyze command", () => {
  it("maps flags; video wins over audio", async () => {
    mocks.analyze.mockResolvedValueOnce({ jobId: "a1" })
    await runCmd(
      "voice", "analyze", "--video", "https://a/p.mp4", "--audio", "https://a/p.mp3",
      "--separation-quality", "best", "--suggest-title", "--json",
    )
    expect(mocks.analyze).toHaveBeenCalledWith({
      videoUrl: "https://a/p.mp4",
      separationQuality: "best",
      suggestTitle: true,
    })
  })

  it("errors when no source URL is given", async () => {
    await expect(runCmd("voice", "analyze")).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("--audio"))
    expect(mocks.analyze).not.toHaveBeenCalled()
  })

  it("with --watch renders the speaker table from the completed job's output_data", async () => {
    mocks.analyze.mockResolvedValueOnce({ jobId: "a2" })
    mocks.jobsGet.mockResolvedValue({
      data: {
        status: "completed",
        output_data: {
          vocalsUrl: "https://r2/vocals.mp3",
          speakers: [
            { id: "spk_0", firstStartSec: 0.4, wordCount: 120, snippet: "welcome back to the show" },
            { id: "spk_1", firstStartSec: 6.1, wordCount: 80, snippet: "thanks for having me" },
          ],
          languageCode: "en",
        },
      },
    })
    await runCmd("voice", "analyze", "--audio", "https://a/p.mp3", "--watch")
    expect(vi.mocked(table)).toHaveBeenCalledWith(
      [
        expect.objectContaining({ "#": 1, id: "spk_0", words: 120, snippet: "welcome back to the show" }),
        expect.objectContaining({ "#": 2, id: "spk_1", words: 80, snippet: "thanks for having me" }),
      ],
      ["#", "id", "first heard", "words", "snippet"],
    )
  })
})

describe("voice export command", () => {
  it("forwards the source video, tracks, and fx", async () => {
    mocks.exportMix.mockResolvedValueOnce({ jobId: "e1" })
    const tracks = [
      { url: "https://r2/s0.mp3", gain: 100, muted: false },
      { url: "https://r2/bg.mp3", gain: 80, muted: false, kind: "background" },
    ]
    await runCmd(
      "voice", "export", "--source", "https://a/p.mp4",
      "--tracks-json", JSON.stringify(tracks),
      "--voice-fx", "hall", "--voice-fx-mix", "30", "--json",
    )
    expect(mocks.exportMix).toHaveBeenCalledWith({
      videoUrl: "https://a/p.mp4",
      tracks,
      voiceFx: { preset: "hall", wetDryMix: 30 },
    })
  })

  it("reads tracks from --tracks-file", async () => {
    mocks.exportMix.mockResolvedValueOnce({ jobId: "e2" })
    const dir = mkdtempSync(join(tmpdir(), "nodaro-cli-test-"))
    try {
      const file = join(dir, "mix.json")
      writeFileSync(file, JSON.stringify([{ url: "https://r2/s0.mp3", gain: 100, muted: false }]))
      await runCmd("voice", "export", "--source", "https://a/p.mp4", "--tracks-file", file, "--json")
      expect(mocks.exportMix).toHaveBeenCalledWith({
        videoUrl: "https://a/p.mp4",
        tracks: [{ url: "https://r2/s0.mp3", gain: 100, muted: false }],
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("errors when no tracks are given", async () => {
    await expect(runCmd("voice", "export", "--source", "https://a/p.mp4")).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("--tracks-json"))
    expect(mocks.exportMix).not.toHaveBeenCalled()
  })

  it("errors on a track entry without a url", async () => {
    await expect(
      runCmd("voice", "export", "--source", "https://a/p.mp4", "--tracks-json", '[{"gain":100}]'),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("tracks must be"))
    expect(mocks.exportMix).not.toHaveBeenCalled()
  })

  it("errors when every track is muted", async () => {
    await expect(
      runCmd(
        "voice", "export", "--source", "https://a/p.mp4",
        "--tracks-json", '[{"url":"https://r2/a.mp3","gain":100,"muted":true}]',
      ),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("un-muted"))
    expect(mocks.exportMix).not.toHaveBeenCalled()
  })

  it("errors when fx tuning flags are passed without --voice-fx", async () => {
    await expect(
      runCmd(
        "voice", "export", "--source", "https://a/p.mp4",
        "--tracks-json", '[{"url":"https://r2/a.mp3","gain":100,"muted":false}]',
        "--voice-fx-decay", "0.4",
      ),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("--voice-fx"))
    expect(mocks.exportMix).not.toHaveBeenCalled()
  })
})

describe("voice design / remix / dub commands", () => {
  it("design maps --description to voiceDescription and --enhance to shouldEnhance", async () => {
    mocks.design.mockResolvedValueOnce({ jobId: "d1" })
    await runCmd(
      "voice", "design", "--text", "A preview line long enough to satisfy the provider's minimum length requirements for a designed voice.",
      "--description", "a warm, gravelly narrator", "--guidance-scale", "40", "--seed", "7", "--enhance", "--json",
    )
    expect(mocks.design).toHaveBeenCalledWith({
      text: "A preview line long enough to satisfy the provider's minimum length requirements for a designed voice.",
      voiceDescription: "a warm, gravelly narrator",
      guidanceScale: 40,
      seed: 7,
      shouldEnhance: true,
    })
  })

  it("remix maps text + description", async () => {
    mocks.remix.mockResolvedValueOnce({ jobId: "r1" })
    await runCmd("voice", "remix", "--text", "hello world", "--description", "an excited sports announcer", "--json")
    expect(mocks.remix).toHaveBeenCalledWith({
      text: "hello world",
      voiceDescription: "an excited sports announcer",
    })
  })

  it("dub maps the target language and speaker flags", async () => {
    mocks.dub.mockResolvedValueOnce({ jobId: "du1" })
    await runCmd(
      "voice", "dub", "--audio", "https://a/p.mp3", "--target-language", "es",
      "--num-speakers", "2", "--drop-background-audio", "--json",
    )
    expect(mocks.dub).toHaveBeenCalledWith({
      audioUrl: "https://a/p.mp3",
      targetLanguage: "es",
      numSpeakers: 2,
      dropBackgroundAudio: true,
    })
  })
})

describe("voice list + clones commands", () => {
  it("list renders the premade catalog", async () => {
    mocks.list.mockResolvedValueOnce([
      { voice_id: "v1", name: "Rachel", gender: "female", accent: "american", age: "young", category: "premade" },
    ])
    await runCmd("voice", "list")
    expect(mocks.list).toHaveBeenCalled()
    expect(vi.mocked(table)).toHaveBeenCalledWith(
      [expect.objectContaining({ name: "Rachel", voice_id: "v1" })],
      ["name", "voice_id", "gender", "accent", "age", "category"],
    )
  })

  it("list --clones renders the clone list instead", async () => {
    mocks.listClones.mockResolvedValueOnce([
      { id: "row1", name: "Me", elevenlabsVoiceId: "el1", sampleAudioUrl: "https://r2/s.mp3", createdAt: "2026-07-17" },
    ])
    await runCmd("voice", "list", "--clones")
    expect(mocks.listClones).toHaveBeenCalled()
    expect(mocks.list).not.toHaveBeenCalled()
    expect(vi.mocked(table)).toHaveBeenCalledWith(
      [expect.objectContaining({ name: "Me", voice_id: "el1", clone_id: "row1" })],
      ["name", "voice_id", "clone_id", "created"],
    )
  })

  it("clones create --audio clones from a URL", async () => {
    mocks.createClone.mockResolvedValueOnce({ id: "row1", name: "Me", elevenlabsVoiceId: "el1" })
    await runCmd("voice", "clones", "create", "--name", "Me", "--audio", "https://r2/sample.mp3", "--json")
    expect(mocks.createClone).toHaveBeenCalledWith({ name: "Me", audioUrl: "https://r2/sample.mp3" })
    expect(mocks.createCloneFromFile).not.toHaveBeenCalled()
  })

  it("clones create --file uploads a local file with its name and inferred content type", async () => {
    mocks.createCloneFromFile.mockResolvedValueOnce({ id: "row2", name: "Me", elevenlabsVoiceId: "el2" })
    const dir = mkdtempSync(join(tmpdir(), "nodaro-cli-test-"))
    try {
      const file = join(dir, "sample.wav")
      writeFileSync(file, Buffer.from([1, 2, 3]))
      await runCmd("voice", "clones", "create", "--name", "Me", "--file", file, "--json")
      expect(mocks.createCloneFromFile).toHaveBeenCalledWith({
        name: "Me",
        file: expect.any(Buffer),
        filename: "sample.wav",
        contentType: "audio/wav",
      })
      expect(mocks.createClone).not.toHaveBeenCalled()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("clones create errors when neither --audio nor --file is given", async () => {
    await expect(runCmd("voice", "clones", "create", "--name", "Me")).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("--audio"))
  })

  it("clones create errors when both --audio and --file are given", async () => {
    await expect(
      runCmd("voice", "clones", "create", "--name", "Me", "--audio", "https://r2/s.mp3", "--file", "x.wav"),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("mutually exclusive"))
  })

  it("clones delete deletes by id", async () => {
    mocks.deleteClone.mockResolvedValueOnce(undefined)
    await runCmd("voice", "clones", "delete", "row1")
    expect(mocks.deleteClone).toHaveBeenCalledWith("row1")
  })
})
