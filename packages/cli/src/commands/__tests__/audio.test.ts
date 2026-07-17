import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Command } from "commander"
import { audioCommand } from "../audio.js"
import { warn } from "../../output.js"

const mocks = {
  separate: vi.fn(),
  isolate: vi.fn(),
  applyFx: vi.fn(),
  mix: vi.fn(),
  adjustVolume: vi.fn(),
  combine: vi.fn(),
  jobsGet: vi.fn(),
}

vi.mock("../../client.js", () => ({
  buildClient: () => ({
    audio: {
      separate: mocks.separate,
      isolate: mocks.isolate,
      applyFx: mocks.applyFx,
      mix: mocks.mix,
      adjustVolume: mocks.adjustVolume,
      combine: mocks.combine,
    },
    jobs: { get: mocks.jobsGet },
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
  program.addCommand(audioCommand())
  await program.parseAsync(["node", "test", ...args])
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
})

describe("audio separate / isolate", () => {
  it("separate maps mode + quality", async () => {
    mocks.separate.mockResolvedValueOnce({ jobId: "j1" })
    await runCmd("audio", "separate", "--audio", "https://x/a.mp3", "--mode", "stems", "--quality", "best", "--json")
    expect(mocks.separate).toHaveBeenCalledWith({ audioUrl: "https://x/a.mp3", mode: "stems", quality: "best" })
  })

  it("separate errors on an unknown --mode", async () => {
    await expect(
      runCmd("audio", "separate", "--audio", "https://x/a.mp3", "--mode", "drums"),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("--mode"))
    expect(mocks.separate).not.toHaveBeenCalled()
  })

  it("separate errors on an unknown --quality", async () => {
    await expect(
      runCmd("audio", "separate", "--audio", "https://x/a.mp3", "--quality", "ultra"),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("--quality"))
  })

  it("isolate maps the source", async () => {
    mocks.isolate.mockResolvedValueOnce({ jobId: "j2" })
    await runCmd("audio", "isolate", "--audio", "https://x/a.mp3", "--json")
    expect(mocks.isolate).toHaveBeenCalledWith({ audioUrl: "https://x/a.mp3" })
  })
})

describe("audio fx", () => {
  it("maps every knob", async () => {
    mocks.applyFx.mockResolvedValueOnce({ jobId: "j3" })
    await runCmd(
      "audio", "fx", "--audio", "https://x/a.mp3", "--preset", "echo",
      "--mix", "40", "--delay", "250", "--decay", "0.4", "--eq-low", "-3", "--eq-high", "2", "--json",
    )
    expect(mocks.applyFx).toHaveBeenCalledWith({
      audioUrl: "https://x/a.mp3",
      preset: "echo",
      mix: 40,
      delayMs: 250,
      decay: 0.4,
      eqLow: -3,
      eqHigh: 2,
    })
  })
})

describe("audio mix", () => {
  it("collects repeated --audio flags and positional volumes", async () => {
    mocks.mix.mockResolvedValueOnce({ jobId: "j4" })
    await runCmd(
      "audio", "mix", "--audio", "https://x/voice.mp3", "--audio", "https://x/bed.mp3",
      "--volumes", "100, 60", "--json",
    )
    expect(mocks.mix).toHaveBeenCalledWith({
      audioUrls: ["https://x/voice.mp3", "https://x/bed.mp3"],
      trackVolumes: [100, 60],
    })
  })

  it("errors with fewer than two tracks", async () => {
    await expect(runCmd("audio", "mix", "--audio", "https://x/a.mp3")).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("two tracks"))
    expect(mocks.mix).not.toHaveBeenCalled()
  })

  it("errors when --volumes count doesn't match the tracks", async () => {
    await expect(
      runCmd("audio", "mix", "--audio", "https://x/a.mp3", "--audio", "https://x/b.mp3", "--volumes", "100"),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("--volumes"))
    expect(mocks.mix).not.toHaveBeenCalled()
  })
})

describe("audio adjust-volume", () => {
  it("maps the level + fades", async () => {
    mocks.adjustVolume.mockResolvedValueOnce({ jobId: "j5" })
    await runCmd(
      "audio", "adjust-volume", "--video", "https://x/v.mp4",
      "--volume", "80", "--normalize", "--fade-in", "1.5", "--fade-out", "2", "--json",
    )
    expect(mocks.adjustVolume).toHaveBeenCalledWith({
      videoUrl: "https://x/v.mp4",
      volume: 80,
      normalize: true,
      fadeIn: 1.5,
      fadeOut: 2,
    })
  })

  it("errors without a source", async () => {
    await expect(runCmd("audio", "adjust-volume", "--volume", "80")).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("--audio"))
  })
})

describe("audio combine", () => {
  it("parses url@start-end sub-ranges per segment", async () => {
    mocks.combine.mockResolvedValueOnce({ jobId: "j6" })
    await runCmd(
      "audio", "combine",
      "--segment", "https://x/intro.mp3",
      "--segment", "https://x/talk.mp3@12-95.5",
      "--json",
    )
    expect(mocks.combine).toHaveBeenCalledWith({
      segments: [
        { url: "https://x/intro.mp3" },
        { url: "https://x/talk.mp3", startTime: 12, endTime: 95.5 },
      ],
    })
  })

  it("errors when no segments are given", async () => {
    await expect(runCmd("audio", "combine")).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("--segment"))
    expect(mocks.combine).not.toHaveBeenCalled()
  })

  it("errors on a malformed sub-range", async () => {
    await expect(
      runCmd("audio", "combine", "--segment", "https://x/a.mp3@95-12"),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("--segment"))
    expect(mocks.combine).not.toHaveBeenCalled()
  })
})
