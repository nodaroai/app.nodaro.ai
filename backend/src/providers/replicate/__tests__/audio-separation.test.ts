/**
 * ReplicateAudioSeparationProvider (Demucs / ryan5453) tests.
 * Covers (mode, quality) → model/stem selection, output-key mapping
 * (no_vocals → instrumental), version pinning, no reconcileOpts, and the
 * no-recognized-stems guard.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const runReplicatePrediction = vi.fn()
vi.mock("../client.js", () => ({
  runReplicatePrediction: (...args: unknown[]) => runReplicatePrediction(...args),
  extractUrl: (item: unknown) => (typeof item === "string" ? item : String(item)),
}))

import { ReplicateAudioSeparationProvider } from "../audio-separation.js"

function lastCallInput() {
  return runReplicatePrediction.mock.calls[0][0] as {
    version: string
    input: Record<string, unknown>
    reconcileOpts?: unknown
    costModelKey?: string
  }
}

describe("ReplicateAudioSeparationProvider.separateAudio", () => {
  beforeEach(() => runReplicatePrediction.mockReset())

  it("vocal_instrumental maps no_vocals → instrumental and sends stem=vocals", async () => {
    runReplicatePrediction.mockResolvedValue({
      output: { vocals: "https://r/vocals.mp3", no_vocals: "https://r/inst.mp3" },
      cost: 0.01,
      predictionId: "p1",
    })
    const res = await new ReplicateAudioSeparationProvider().separateAudio(
      "https://in/song.mp3",
      { mode: "vocal_instrumental", quality: "auto" },
    )
    expect(res.vocals).toBe("https://r/vocals.mp3")
    expect(res.instrumental).toBe("https://r/inst.mp3")
    expect(res.cost).toBe(0.01)

    const arg = lastCallInput()
    expect(arg.input.stem).toBe("vocals")
    expect(arg.input.model).toBe("htdemucs")
    expect(arg.input.output_format).toBe("mp3")
    expect(arg.version).toMatch(/^[0-9a-f]{64}$/) // pinned, not floating
    expect(arg.reconcileOpts).toBeUndefined() // crash → fail+refund, not recovered
    expect(arg.costModelKey).toBe("demucs")
  })

  it("stems + auto uses htdemucs_6s with stem=none and maps every stem", async () => {
    runReplicatePrediction.mockResolvedValue({
      output: { vocals: "v", drums: "d", bass: "b", other: "o", guitar: "g", piano: "p" },
      cost: 0.02,
      predictionId: "p2",
    })
    const res = await new ReplicateAudioSeparationProvider().separateAudio("a", {
      mode: "stems",
      quality: "auto",
    })
    expect(res).toMatchObject({ vocals: "v", drums: "d", bass: "b", other: "o", guitar: "g", piano: "p" })
    const arg = lastCallInput()
    expect(arg.input.stem).toBe("none")
    expect(arg.input.model).toBe("htdemucs_6s")
  })

  it("best quality uses htdemucs_ft", async () => {
    runReplicatePrediction.mockResolvedValue({
      output: { vocals: "v", no_vocals: "i" },
      cost: null,
      predictionId: "p3",
    })
    await new ReplicateAudioSeparationProvider().separateAudio("a", {
      mode: "vocal_instrumental",
      quality: "best",
    })
    expect(lastCallInput().input.model).toBe("htdemucs_ft")
  })

  it("fast quality uses base htdemucs even in stems mode", async () => {
    runReplicatePrediction.mockResolvedValue({
      output: { vocals: "v", drums: "d", bass: "b", other: "o" },
      cost: null,
      predictionId: "p5",
    })
    await new ReplicateAudioSeparationProvider().separateAudio("a", {
      mode: "stems",
      quality: "fast",
    })
    expect(lastCallInput().input.model).toBe("htdemucs")
  })

  it("throws when the output has no recognized stems", async () => {
    runReplicatePrediction.mockResolvedValue({ output: { junk: "x" }, cost: null, predictionId: "p4" })
    await expect(
      new ReplicateAudioSeparationProvider().separateAudio("a", { mode: "stems", quality: "fast" }),
    ).rejects.toThrow(/no recognized stems/)
  })
})
