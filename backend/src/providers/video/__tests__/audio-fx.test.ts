import { describe, it, expect } from "vitest"
import { buildAudioFxArgs, buildReverbIr, IR_SAMPLE_RATE, type AudioFxPaths } from "../audio-fx.js"

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
