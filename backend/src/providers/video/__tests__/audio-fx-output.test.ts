import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { execFileSync } from "node:child_process"
import { promises as fs, mkdtempSync, realpathSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import {
  applyAudioFx,
  buildAudioFxArgs,
  IR_SAMPLE_RATE,
  type AudioFxPaths,
} from "../audio-fx.js"

/**
 * The additive output options on applyAudioFx: `format: "wav"` (lossless
 * 16-bit PCM), a LOCAL input (`inputPath`) and a caller-chosen LOCAL output
 * (`outputPath`). The one invariant that matters most is that a caller who
 * passes none of them is byte-identical to before — so the default arg vectors
 * are pinned here as literal arrays, not as "contains".
 */

const PATHS: AudioFxPaths = {
  inputPath: "/w/in.mp3",
  outputPath: "/w/out.mp3",
  irPath: "/w/reverb-ir.f32",
}
const WAV_PATHS: AudioFxPaths = { ...PATHS, outputPath: "/w/out.wav" }

describe("buildAudioFxArgs — defaults are byte-identical (no new flags unless asked)", () => {
  it("non-reverb: exactly the pre-existing vector", () => {
    expect(buildAudioFxArgs({ audioUrl: "x", preset: "telephone" }, PATHS)).toEqual([
      "-y", "-i", "/w/in.mp3",
      "-af", "highpass=f=300,lowpass=f=3400,equalizer=f=1500:t=q:w=1.2:g=4",
      "/w/out.mp3",
    ])
  })

  it("reverb: exactly the pre-existing vector", () => {
    const args = buildAudioFxArgs({ audioUrl: "x", preset: "room", mix: 50 }, PATHS)
    expect(args.slice(0, 2)).toEqual(["-y", "-i"])
    expect(args.slice(-3)).toEqual(["-map", "[out]", "/w/out.mp3"])
    expect(args).not.toContain("-c:a")
  })

  it("format: 'mp3' is the same vector as no format at all", () => {
    for (const preset of ["telephone", "echo", "custom", "room", "church"] as const) {
      expect(buildAudioFxArgs({ audioUrl: "x", preset, format: "mp3" }, PATHS)).toEqual(
        buildAudioFxArgs({ audioUrl: "x", preset }, PATHS),
      )
    }
  })

  it("a local source / output path does not change the vector either (only the paths do)", () => {
    expect(
      buildAudioFxArgs({ inputPath: "/w/in.wav", outputPath: "/w/o.mp3", preset: "telephone" }, PATHS),
    ).toEqual(buildAudioFxArgs({ audioUrl: "x", preset: "telephone" }, PATHS))
  })
})

describe("buildAudioFxArgs — format: 'wav'", () => {
  it("non-reverb: pins 16-bit PCM right before the output path, touches nothing else", () => {
    const wav = buildAudioFxArgs({ audioUrl: "x", preset: "telephone", format: "wav" }, WAV_PATHS)
    const mp3 = buildAudioFxArgs({ audioUrl: "x", preset: "telephone" }, PATHS)
    expect(wav.slice(-3)).toEqual(["-c:a", "pcm_s16le", "/w/out.wav"])
    expect(wav.slice(0, -3)).toEqual(mp3.slice(0, -1))
    // No resample / remix flag: the input's own rate and channel count survive.
    expect(wav).not.toContain("-ar")
    expect(wav).not.toContain("-ac")
  })

  it("reverb: same, after -map [out]; the graph is identical to the mp3 one", () => {
    const wav = buildAudioFxArgs({ audioUrl: "x", preset: "hall", format: "wav" }, WAV_PATHS)
    const mp3 = buildAudioFxArgs({ audioUrl: "x", preset: "hall" }, PATHS)
    expect(wav.slice(-5)).toEqual(["-map", "[out]", "-c:a", "pcm_s16le", "/w/out.wav"])
    expect(wav[wav.indexOf("-filter_complex") + 1]).toBe(mp3[mp3.indexOf("-filter_complex") + 1])
  })
})

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" })
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
})()

function probe(path: string): { codec: string; rate: number; channels: number; duration: number } {
  const out = execFileSync("ffprobe", [
    "-v", "error", "-select_streams", "a:0",
    "-show_entries", "stream=codec_name,sample_rate,channels:format=duration",
    "-of", "json", path,
  ]).toString()
  const j = JSON.parse(out) as {
    streams: Array<{ codec_name: string; sample_rate: string; channels: number }>
    format: { duration: string }
  }
  return {
    codec: j.streams[0]!.codec_name,
    rate: Number(j.streams[0]!.sample_rate),
    channels: j.streams[0]!.channels,
    duration: Number(j.format.duration),
  }
}

/** Isolated TMPDIR so "no leftover files" is countable, not inferred. */
let sandbox = ""
let savedTmp: string | undefined
const listDir = async (): Promise<string[]> => (await fs.readdir(sandbox)).sort()

beforeAll(() => {
  savedTmp = process.env.TMPDIR
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), "afx-out-test-")))
  process.env.TMPDIR = sandbox
})
afterAll(async () => {
  if (savedTmp === undefined) delete process.env.TMPDIR
  else process.env.TMPDIR = savedTmp
  await fs.rm(sandbox, { recursive: true, force: true })
})

async function makeSource(name: string, rate: number, channels: number): Promise<string> {
  const path = join(sandbox, name)
  execFileSync("ffmpeg", [
    "-y", "-f", "lavfi", "-i", `sine=frequency=440:duration=1:sample_rate=${rate}`,
    "-ac", String(channels), path,
  ], { stdio: "ignore" })
  return path
}

describe.skipIf(!hasFfmpeg)("applyAudioFx — local in/out + wav (real ffmpeg)", () => {
  it("wav out keeps a non-reverb input's sample rate and channel count (44.1 kHz stereo)", async () => {
    const src = await makeSource("src-st.wav", 44100, 2)
    const out = join(sandbox, "tel.wav")
    const res = await applyAudioFx({ inputPath: src, outputPath: out, preset: "telephone", format: "wav" })
    expect(res.outputPath).toBe(out)
    expect(probe(out)).toMatchObject({ codec: "pcm_s16le", rate: 44100, channels: 2 })
    expect(probe(out).duration).toBeGreaterThan(0.9)
  })

  it("wav out keeps a mono 16 kHz input as mono 16 kHz", async () => {
    const src = await makeSource("src-mono.wav", 16000, 1)
    const out = join(sandbox, "echo.wav")
    await applyAudioFx({ inputPath: src, outputPath: out, preset: "echo", format: "wav" })
    expect(probe(out)).toMatchObject({ codec: "pcm_s16le", rate: 16000, channels: 1 })
  })

  it("reverb presets render at the IR rate (48 kHz) — documented, not preserved", async () => {
    const src = await makeSource("src-rv.wav", 44100, 1)
    const out = join(sandbox, "rv.wav")
    await applyAudioFx({ inputPath: src, outputPath: out, preset: "room", format: "wav" })
    expect(probe(out)).toMatchObject({ codec: "pcm_s16le", rate: IR_SAMPLE_RATE, channels: 1 })
  })

  it("with outputPath, nothing is left behind but the output file", async () => {
    const src = await makeSource("src-clean.wav", 48000, 1)
    const out = join(sandbox, "clean.wav")
    const before = await listDir()
    await applyAudioFx({ inputPath: src, outputPath: out, preset: "hall", format: "wav" })
    const after = await listDir()
    expect(after.filter((n) => !before.includes(n))).toEqual(["clean.wav"])
  })

  it("on failure, removes its scratch dir AND the partial output", async () => {
    const bad = join(sandbox, "not-audio.wav")
    await fs.writeFile(bad, "this is not audio")
    const out = join(sandbox, "never.wav")
    const before = await listDir()
    await expect(
      applyAudioFx({ inputPath: bad, outputPath: out, preset: "telephone", format: "wav" }),
    ).rejects.toThrow()
    expect(await listDir()).toEqual(before)
  })

  it("without outputPath it keeps the legacy contract: output in a fresh work dir the caller cleans", async () => {
    const src = await makeSource("src-legacy.wav", 44100, 1)
    const res = await applyAudioFx({ inputPath: src, preset: "telephone", format: "wav" })
    expect(res.outputPath).toMatch(/audio-fx-[^/]+\/output\.wav$/)
    expect(probe(res.outputPath).codec).toBe("pcm_s16le")
    const res2 = await applyAudioFx({ inputPath: src, preset: "telephone" })
    expect(res2.outputPath).toMatch(/audio-fx-[^/]+\/output\.mp3$/)
    expect(probe(res2.outputPath).codec).toBe("mp3")
  })
})

describe("applyAudioFx — option validation (refuses before any work)", () => {
  const base = { preset: "telephone" as const }

  it("needs exactly one of audioUrl / inputPath", async () => {
    await expect(applyAudioFx({ ...base } as never)).rejects.toThrow(/exactly one of audioUrl or inputPath/)
    await expect(
      applyAudioFx({ ...base, audioUrl: "https://x/y.mp3", inputPath: join(sandbox, "a.wav") } as never),
    ).rejects.toThrow(/exactly one of audioUrl or inputPath/)
  })

  it("rejects a relative or out-of-tmp input path", async () => {
    await expect(applyAudioFx({ ...base, inputPath: "a.wav" })).rejects.toThrow(/absolute/)
    await expect(applyAudioFx({ ...base, inputPath: "/etc/hosts" })).rejects.toThrow(/inside the temp directory/)
  })

  it("rejects a symlink that escapes the temp directory", async () => {
    const link = join(sandbox, "escape.wav")
    await fs.symlink("/etc/hosts", link)
    await expect(applyAudioFx({ ...base, inputPath: link })).rejects.toThrow(/inside the temp directory/)
  })

  it("rejects an output path that is a symlink (ffmpeg -y writes through it), leaving the target untouched", async () => {
    const src = join(sandbox, "sym-src.wav")
    await fs.writeFile(src, "x")
    const outside = mkdtempSync(join(homedir(), ".audiofx-victim-"))
    try {
      const victim = join(outside, "victim.wav")
      await fs.writeFile(victim, "ORIGINAL")
      const toOutside = join(sandbox, "sym-out.wav")
      await fs.symlink(victim, toOutside)
      await expect(applyAudioFx({ ...base, inputPath: src, outputPath: toOutside, format: "wav" })).rejects.toThrow(/symlink/)
      expect(await fs.readFile(victim, "utf8")).toBe("ORIGINAL")
      // a link that stays inside the temp dir is refused too (the leaf is never followed), as is a dangling one
      const inside = join(sandbox, "sym-inside.wav")
      await fs.symlink(src, inside)
      await expect(applyAudioFx({ ...base, inputPath: src, outputPath: inside, format: "wav" })).rejects.toThrow(/symlink/)
      expect(await fs.readFile(src, "utf8")).toBe("x")
      const dangling = join(sandbox, "sym-dangling.wav")
      await fs.symlink(join(outside, "nope.wav"), dangling)
      await expect(applyAudioFx({ ...base, inputPath: src, outputPath: dangling, format: "wav" })).rejects.toThrow(/symlink/)
      await expect(fs.stat(join(outside, "nope.wav"))).rejects.toThrow()
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
  })

  it("rejects an input that does not exist", async () => {
    await expect(applyAudioFx({ ...base, inputPath: join(sandbox, "missing.wav") })).rejects.toThrow(/does not exist|not a file/)
  })

  it("rejects an output path outside the temp directory or with the wrong extension", async () => {
    const src = join(sandbox, "v.wav")
    await fs.writeFile(src, "x")
    await expect(applyAudioFx({ ...base, inputPath: src, outputPath: "/etc/o.wav", format: "wav" })).rejects.toThrow(/inside the temp directory/)
    await expect(applyAudioFx({ ...base, inputPath: src, outputPath: join(sandbox, "o.mp3"), format: "wav" })).rejects.toThrow(/\.wav/)
    await expect(applyAudioFx({ ...base, inputPath: src, outputPath: join(sandbox, "o.wav") })).rejects.toThrow(/\.mp3/)
  })

  it("rejects outputPath === inputPath (ffmpeg would truncate its own source)", async () => {
    const src = join(sandbox, "same.wav")
    await fs.writeFile(src, "x")
    await expect(applyAudioFx({ ...base, inputPath: src, outputPath: src, format: "wav" })).rejects.toThrow(/same file/)
  })

  it("rejects an unknown format", async () => {
    const src = join(sandbox, "fmt.wav")
    await fs.writeFile(src, "x")
    await expect(applyAudioFx({ ...base, inputPath: src, format: "flac" as never })).rejects.toThrow(/format/)
  })
})
