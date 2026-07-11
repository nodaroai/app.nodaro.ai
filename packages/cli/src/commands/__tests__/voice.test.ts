import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Command } from "commander"
import { voiceCommand } from "../voice.js"
import { warn } from "../../output.js"

/**
 * Mocked SDK shape — every method the voice command touches needs an impl.
 * Mirrors community.test.ts. `handleError` is mocked to rethrow so vitest
 * sees a normal rejection instead of process.exit.
 */
const mocks = {
  recast: vi.fn(),
  change: vi.fn(),
  jobsGet: vi.fn(),
}

vi.mock("../../client.js", () => ({
  buildClient: () => ({
    voices: { recast: mocks.recast, change: mocks.change },
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

describe("voice recast command", () => {
  // Validation failures call warn() + process.exit(1) directly (the CLI's
  // idiom); turn the exit into a throw so the test sees a rejection.
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
  })

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
})
