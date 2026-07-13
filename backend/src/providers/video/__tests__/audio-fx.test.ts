import { describe, it, expect, vi } from "vitest"
import {
  afirEffectiveGain,
  buildAudioFxArgs,
  buildReverbIr,
  IR_SAMPLE_RATE,
  type AudioFxPaths,
} from "../audio-fx.js"

const PATHS: AudioFxPaths = {
  inputPath: "/w/in.mp3",
  outputPath: "/w/out.mp3",
  irPath: "/w/reverb-ir.f32",
}

/** The filtergraph, for the reverb presets that emit one. */
function graph(opts: Parameters<typeof buildAudioFxArgs>[0]): string {
  const args = buildAudioFxArgs(opts, PATHS)
  return args[args.indexOf("-filter_complex") + 1]!
}

describe("buildAudioFxArgs — reverb", () => {
  it("splits dry/wet, convolves the pre-baked IR via afir, and amixes them back", () => {
    const args = buildAudioFxArgs({ audioUrl: "x", preset: "room" }, PATHS)
    const fc = graph({ audioUrl: "x", preset: "room" })

    expect(args).toContain("-filter_complex")
    expect(fc).toContain("asplit") // dry/wet split so the dry passes through
    expect(fc).toContain("afir")
    expect(fc).toContain("amix") // mixed back (afir alone drops the dry)
    expect(args).toContain("-map")
    expect(args).toContain("[out]")
    expect(args.at(-1)).toBe("/w/out.mp3")
  })

  it("NEVER emits irnorm — it does not exist on ffmpeg 5.1 and would kill the job", () => {
    // `afir`'s gtype runs -1..2 on the production ffmpeg (5.1.9, Debian bookworm).
    // `irnorm` is an ffmpeg 6+ option: passing it does not degrade, it ERRORS OUT.
    for (const preset of ["room", "church", "cave", "outdoor"] as const) {
      const args = buildAudioFxArgs({ audioUrl: "x", preset }, PATHS)
      expect(args.join(" ")).not.toContain("irnorm")
    }
  })

  it("passes the IR as a SECOND input (raw f32le), not as an inline synth", () => {
    const args = buildAudioFxArgs({ audioUrl: "x", preset: "hall" }, PATHS)

    // input 0 = the voice, input 1 = the IR, declared raw so ffmpeg can read it.
    const firstIn = args.indexOf("-i")
    const irIn = args.indexOf("-i", firstIn + 1)
    expect(args[firstIn + 1]).toBe("/w/in.mp3")
    expect(args[irIn + 1]).toBe("/w/reverb-ir.f32")
    expect(args.slice(firstIn + 2, irIn)).toEqual([
      "-f", "f32le", "-ar", String(IR_SAMPLE_RATE), "-ac", "1",
    ])

    // ...and the graph convolves against that second input.
    expect(graph({ audioUrl: "x", preset: "hall" })).toContain("[w][1:a]afir")

    // The IR is no longer synthesised inside ffmpeg. `afade=curve=exp` decays to
    // -100 dB and rang ~1.5x too long; `anoisesrc` is not the browser's pink noise.
    const fc = graph({ audioUrl: "x", preset: "hall" })
    expect(fc).not.toContain("anoisesrc")
    expect(fc).not.toContain("afade")
  })

  it("lets afir do nothing but convolve (gtype=none — NOT gn, which normalised to ~unity)", () => {
    const fc = graph({ audioUrl: "x", preset: "room" })
    expect(fc).toContain("afir=gtype=none")
    // gtype=gn is what put the wet leg ~22 dB over the browser's preview.
    expect(fc).not.toContain("gtype=gn")
  })

  it("applies the band shape AFTER afir, not baked into the IR", () => {
    // The browser hangs BiquadFilterNodes off its ConvolverNode, so the shape sits
    // downstream of the convolution, not inside the IR.
    expect(graph({ audioUrl: "x", preset: "room" })).toContain("afir=gtype=none[wc];[wc]lowpass=f=6000:")
    expect(graph({ audioUrl: "x", preset: "church" })).toMatch(
      /afir=gtype=none\[wc\];\[wc\]highpass=f=120:[^,]+,lowpass=f=4000:[^,]+,volume=/,
    )
  })

  it("pins the band filters to the browser's EFFECTIVE Q, not ffmpeg's Butterworth default", () => {
    // The Web Audio spec reads BiquadFilterNode.Q in DECIBELS for lowpass/highpass,
    // so the browser's `Q = Math.SQRT1_2` is an effective LINEAR Q of
    // 10^(0.7071/20) = 1.0848 — NOT the 0.707 Butterworth its name implies, and NOT
    // ffmpeg's default. Leaving ffmpeg on its default renders the export's reverb
    // measurably darker than the preview (up to 1.6 dB on the highpass presets).
    const effectiveQ = Math.pow(10, Math.SQRT1_2 / 20)
    expect(effectiveQ).toBeCloseTo(1.084814, 6)

    const fc = graph({ audioUrl: "x", preset: "bathroom" })
    expect(fc).toContain(`highpass=f=250:width_type=q:width=${effectiveQ.toFixed(6)}`)
    expect(fc).toContain(`lowpass=f=9000:width_type=q:width=${effectiveQ.toFixed(6)}`)
    // ...and never the bare, Butterworth-defaulted form.
    expect(fc).not.toMatch(/lowpass=f=\d+,/)
    expect(fc).not.toMatch(/highpass=f=\d+,/)
  })

  it("throws rather than convolving against a missing IR", () => {
    expect(() => buildAudioFxArgs({ audioUrl: "x", preset: "room" }, { ...PATHS, irPath: undefined }))
      .toThrow(/requires an irPath/)
  })

  it("dry/wet is a complementary unity crossfade (mix=50 → dry 0.5, wet 0.5)", () => {
    const fc = graph({ audioUrl: "x", preset: "hall", mix: 50 })
    expect((fc.match(/volume=0\.500/g) ?? []).length).toBe(2) // dry + wet
    expect(fc).toContain("alimiter=limit=0.95") // hard clip/corruption safety
  })

  it("mix=100 is full wet at unity; mix=0 is passthrough, NOT silence", () => {
    const wet = graph({ audioUrl: "x", preset: "hall", mix: 100 })
    expect(wet).toContain("volume=1.000") // wet at unity
    expect(wet).toContain("volume=0.000") // dry muted

    const dry = graph({ audioUrl: "x", preset: "room", mix: 0 })
    expect(dry).toContain("volume=0.000") // wet muted
    expect(dry).toContain("volume=1.000") // dry at full
    expect(dry).toContain("asplit")
  })
})

describe("buildReverbIr", () => {
  /**
   * The Web Audio spec's `calculateNormalizationScale` divides the IR by its own
   * RMS, so a ConvolverNode's normalised IR always lands on the SAME RMS —
   * `GainCalibration * (GainCalibrationSampleRate / sampleRate)` — whatever the IR
   * happens to contain. That fixed, tiny RMS is what puts the browser's reverb ~16
   * dB under the dry voice, and reproducing it is the whole point of this module.
   * Pinning it here is exact and immune to the generator's unseeded Math.random().
   */
  const EXPECTED_RMS = 0.00125 * (44100 / IR_SAMPLE_RATE)

  function rms(ir: Float32Array): number {
    let sum = 0
    for (let i = 0; i < ir.length; i++) sum += ir[i]! * ir[i]!
    return Math.sqrt(sum / ir.length)
  }

  it.each([
    ["outdoor", 0.15],
    ["room", 0.4],
    ["hall", 1.2],
    ["church", 3.0],
  ])("%s (%ss): length is floor(48000 * dur)", (_name, durSec) => {
    expect(buildReverbIr(durSec)).toHaveLength(Math.floor(IR_SAMPLE_RATE * durSec))
  })

  it.each([0.15, 0.4, 1.2, 3.0])("%ss: RMS is exactly the ConvolverNode normalisation scale", (durSec) => {
    const actual = rms(buildReverbIr(durSec))
    expect(Math.abs(actual - EXPECTED_RMS) / EXPECTED_RMS).toBeLessThan(1e-5)
  })

  it("tapers the tail to zero so the IR cannot end on a step (a click on every convolution)", () => {
    const ir = buildReverbIr(0.4)
    const last = Math.abs(ir[ir.length - 1]!)

    // The `(1 - p)` taper drives the final sample to ~1/length of its untapered
    // value — some 5 orders of magnitude under the tail's own RMS. It is not
    // BIT-exactly 0.0: `p = i / length` never reaches 1. That is the browser's
    // arithmetic, ported verbatim on purpose, and the residue is ~-150 dBFS.
    expect(last).toBeLessThan(1e-6)
    expect(last).toBeLessThan(rms(ir) / 1000)
  })

  it("decays: the head carries far more energy than the tail", () => {
    const ir = buildReverbIr(1.2)
    const tenth = Math.floor(ir.length / 10)
    const energy = (from: number, to: number) => {
      let sum = 0
      for (let i = from; i < to; i++) sum += ir[i]! * ir[i]!
      return sum
    }
    expect(energy(0, tenth)).toBeGreaterThan(energy(ir.length - tenth, ir.length) * 100)
  })

  it("is finite everywhere (a NaN in an IR silences the whole convolution)", () => {
    const ir = buildReverbIr(0.18)
    expect(ir.every((s) => Number.isFinite(s))).toBe(true)
  })
})

describe("buildAudioFxArgs — non-reverb presets are plain -af chains", () => {
  const chain = (opts: Parameters<typeof buildAudioFxArgs>[0]): string => {
    const args = buildAudioFxArgs(opts, PATHS)
    return args[args.indexOf("-af") + 1]!
  }

  it("telephone band-limits via -af (no filter_complex, no IR input)", () => {
    const args = buildAudioFxArgs({ audioUrl: "x", preset: "telephone" }, PATHS)
    expect(args).not.toContain("-filter_complex")
    expect(args).not.toContain("/w/reverb-ir.f32")
    expect(args).toContain("-af")
    expect(chain({ audioUrl: "x", preset: "telephone" })).toBe(
      "highpass=f=300,lowpass=f=3400,equalizer=f=1500:t=q:w=1.2:g=4",
    )
  })

  it("megaphone keeps its crusher chain", () => {
    expect(chain({ audioUrl: "x", preset: "megaphone" })).toContain("acrusher=bits=8:mix=0.25")
  })

  it("echo uses aecho with the supplied delay/decay", () => {
    expect(chain({ audioUrl: "x", preset: "echo", delayMs: 300, decay: 0.5 })).toBe("aecho=0.8:0.88:300:0.5")
  })

  it("custom applies only the set knobs (EQ + delay)", () => {
    const c = chain({ audioUrl: "x", preset: "custom", eqLow: 3, eqHigh: -2, delayMs: 200 })
    expect(c).toContain("bass=g=3")
    expect(c).toContain("treble=g=-2")
    expect(c).toContain("aecho")
  })

  it("custom with no knobs is a no-op (anull)", () => {
    expect(chain({ audioUrl: "x", preset: "custom" })).toBe("anull")
  })
})

describe("buildAudioFxArgs — afir gain compensation (version-robust wet leg)", () => {
  const fcFor = (afirGain?: number): string => {
    const args = buildAudioFxArgs(
      { audioUrl: "x", preset: "room", mix: 50 },
      { inputPath: "/w/in.mp3", outputPath: "/w/out.mp3", irPath: "/w/reverb-ir.f32" },
      afirGain,
    )
    return args[args.indexOf("-filter_complex") + 1]
  }

  it("divides ONLY the wet leg by the measured gain (dry untouched — complementary crossfade preserved)", () => {
    // ffmpeg 5.1 regime: flat ×2 → wet halves, dry stays.
    const fc = fcFor(2)
    expect(fc).toContain("volume=0.250000") // wet: 0.5 / 2
    expect(fc).toContain("volume=0.500")    // dry: unchanged
  })

  it("compensation is in the graph, NOT the IR — norm-based gain is scale-invariant, IR division cancels nothing", () => {
    // ffmpeg 8 regime: irnorm=1 crushes a Web-Audio IR by ℓ1 (measured 1/10.3
    // for room) → wet multiplies back up; must render with full precision.
    const fc = fcFor(1 / 10.3)
    expect(fc).toContain("volume=5.150000")
  })

  it("defaults to ×1 so pure arg-shape tests need no probe", () => {
    expect(fcFor(undefined)).toContain("volume=0.500000")
  })

  it("rejects an implausible gain rather than rendering a broken mix", () => {
    expect(() => fcFor(0)).toThrow(/implausible afirGain/)
    expect(() => fcFor(Number.NaN)).toThrow(/implausible afirGain/)
  })
})

/**
 * The probe's FAILURE SEMANTICS are load-bearing (a wrong guess ships a
 * near-silent or 6 dB-hot reverb billed to a customer), so they are pinned
 * here with a fake runFfmpeg: throw instead of guessing, retry once, never
 * memoize a failure, and reject non-flat gain that a scalar cannot cancel.
 * Only runFfmpeg is faked — work dirs and file I/O are real.
 */
const ffmpegFake = vi.hoisted(() => ({
  // Plain FIFO: each probe run consumes exactly one behavior, and running
  // out THROWS — so a change in how many probes the code performs (e.g. a
  // retry-policy change) surfaces as "no behavior configured" instead of
  // being silently absorbed by a repeating last entry.
  behaviors: [] as Array<"flat2" | "l1norm" | "nonflat" | "silent" | "fail">,
}))

vi.mock("../ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ffmpeg-utils.js")>()
  const { promises: fsp } = await import("node:fs")
  return {
    ...actual,
    runFfmpeg: async (args: readonly string[]): Promise<string> => {
      const behavior = ffmpegFake.behaviors.shift()
      if (!behavior) throw new Error("ffmpegFake: no behavior configured")
      if (behavior === "fail") throw new Error("ffmpeg failed: fake transient error")

      const inputIdxs = args.flatMap((a, i) => (a === "-i" ? [i + 1] : []))
      const irPath = args[inputIdxs[1]]
      const outPath = args[args.length - 1]
      const raw = await fsp.readFile(irPath)
      const out = Buffer.alloc(raw.length)
      const count = Math.floor(raw.length / 4)
      let l1 = 0
      for (let i = 0; i < count; i++) l1 += Math.abs(raw.readFloatLE(i * 4))
      for (let i = 0; i < count; i++) {
        const v = raw.readFloatLE(i * 4)
        const scaled =
          behavior === "flat2" ? v * 2
          : behavior === "l1norm" ? v / l1
          : behavior === "silent" ? 0
          : i < count / 2 ? v : v * 4 // nonflat: second half boosted
        out.writeFloatLE(scaled, i * 4)
      }
      await fsp.writeFile(outPath, out)
      return ""
    },
  }
})

describe("afirEffectiveGain — probe failure semantics (throw, retry, never memoize failures)", () => {
  const ir = (): Float32Array => {
    const data = new Float32Array(64)
    for (let i = 0; i < data.length; i++) data[i] = (i % 2 ? -1 : 1) / (i + 1)
    return data
  }

  it("measures a flat gain via peak ratio (×2, the ffmpeg 5.1 regime)", async () => {
    ffmpegFake.behaviors = ["flat2"]
    await expect(afirEffectiveGain("t-flat", ir())).resolves.toBeCloseTo(2, 5)
  })

  it("measures a tiny flat ℓ1-normalization gain (the ffmpeg 8 regime) instead of rejecting it", async () => {
    ffmpegFake.behaviors = ["l1norm"]
    const gain = await afirEffectiveGain("t-l1", ir())
    expect(gain).toBeGreaterThan(0)
    expect(gain).toBeLessThan(1)
  })

  it("retries once: a single transient failure still resolves", async () => {
    ffmpegFake.behaviors = ["fail", "flat2"]
    await expect(afirEffectiveGain("t-retry", ir())).resolves.toBeCloseTo(2, 5)
  })

  it("throws after both attempts fail — no version-guessed fallback gain", async () => {
    ffmpegFake.behaviors = ["fail", "fail", "fail"]
    await expect(afirEffectiveGain("t-throw", ir())).rejects.toThrow(/refusing to render the reverb at a guessed level/)
  })

  it("does NOT memoize a failure — the next job re-probes and succeeds", async () => {
    ffmpegFake.behaviors = ["fail", "fail", "flat2"]
    await expect(afirEffectiveGain("t-evict", ir())).rejects.toThrow()
    await expect(afirEffectiveGain("t-evict", ir())).resolves.toBeCloseTo(2, 5)
  })

  it("memoizes success — one probe per preset per process", async () => {
    ffmpegFake.behaviors = ["flat2", "fail", "fail", "fail"]
    await expect(afirEffectiveGain("t-memo", ir())).resolves.toBeCloseTo(2, 5)
    // Would fail if re-probed: the remaining behaviors all throw.
    await expect(afirEffectiveGain("t-memo", ir())).resolves.toBeCloseTo(2, 5)
  })

  it("rejects a NON-FLAT gain the scalar compensation model cannot cancel", async () => {
    ffmpegFake.behaviors = ["nonflat"]
    await expect(afirEffectiveGain("t-nonflat", ir())).rejects.toThrow(/not a flat scalar/)
  })

  it("a deterministic diagnosis skips the in-place retry and says so — no 'retry the job' advice", async () => {
    // If the (wasteful, misleading) retry happened, the second behavior would
    // resolve ×2 and this would NOT reject.
    ffmpegFake.behaviors = ["nonflat", "flat2"]
    await expect(afirEffectiveGain("t-det-noretry", ir())).rejects.toThrow(
      /deterministic for this ffmpeg binary and IR/,
    )
  })

  it("rejects a silent probe output as deterministic, not transient", async () => {
    ffmpegFake.behaviors = ["silent"]
    await expect(afirEffectiveGain("t-silent", ir())).rejects.toThrow(/deterministic/)
  })

  it("memoizes by IR CONTENT, not preset name alone — a different IR under the same name re-probes", async () => {
    ffmpegFake.behaviors = ["flat2", "l1norm"]
    const irB = ir()
    irB[0] = 0.9 // different content → different fingerprint
    await expect(afirEffectiveGain("t-fingerprint", ir())).resolves.toBeCloseTo(2, 5)
    const gainB = await afirEffectiveGain("t-fingerprint", irB)
    expect(gainB).toBeLessThan(1) // fresh probe (l1norm), NOT the cached ×2
  })
})
