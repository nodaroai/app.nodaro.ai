import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Command } from "commander"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { editCommand } from "../edit.js"
import { warn } from "../../output.js"

const mocks = {
  silenceDetect: vi.fn(),
  audioSync: vi.fn(),
  applyEdl: vi.fn(),
  editPlan: vi.fn(),
  jobsGetStatus: vi.fn(),
}

vi.mock("../../client.js", () => ({
  buildClient: () => ({
    edit: {
      silenceDetect: mocks.silenceDetect,
      audioSync: mocks.audioSync,
      applyEdl: mocks.applyEdl,
      editPlan: mocks.editPlan,
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
