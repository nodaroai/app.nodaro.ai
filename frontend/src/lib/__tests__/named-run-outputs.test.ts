// One mapping for a finished node's named side outputs, shared by the live run
// and both load-time restore lanes. The keys are pinned against what READS them:
// the bug (#1547) was two lanes writing names no reader ever looked at.
import { describe, it, expect } from "vitest"
import type { WorkflowNode } from "@/types/nodes"
import { extractNodeOutput } from "@/components/editor/workflow-editor/execution-graph"
import { SUNO_SEPARATE_RESULT_FIELDS } from "@nodaro/shared/models"
import { namedRunOutputFields, sunoSeparateRunOutputFields } from "../named-run-outputs"

function node(type: string, data: Record<string, unknown>): WorkflowNode {
  return { id: "n1", type, position: { x: 0, y: 0 }, data: { label: "n", ...data } } as unknown as WorkflowNode
}

describe("namedRunOutputFields", () => {
  it("names every side output the way its readers do", () => {
    expect(
      namedRunOutputFields({
        generatedVoiceId: "voice-1",
        vocalUrl: "https://cdn.test/vocals.mp3",
        instrumentalUrl: "https://cdn.test/inst.mp3",
        alignment: [{ word: "hi", start: 0, end: 1 }],
        combinedText: "a b",
        splitResults: ["a", "b"],
      }),
    ).toEqual({
      generatedVoiceId: "voice-1",
      vocalUrl: "https://cdn.test/vocals.mp3",
      instrumentalUrl: "https://cdn.test/inst.mp3",
      alignmentResults: [{ word: "hi", start: 0, end: 1 }],
      combinedText: "a b",
      generatedText: "a b",
      splitResults: ["a", "b"],
    })
  })

  it("writes nothing for an output the node did not produce — a patch must not blank a field it does not own", () => {
    expect(namedRunOutputFields({})).toEqual({})
    expect(namedRunOutputFields({ vocalUrl: "" })).toEqual({})
  })

  it("the stems land where the OUTPUT HANDLES read them — not on the full mix", () => {
    // A missing `vocalUrl` does not read as "no vocals": the handle falls back to
    // `generatedAudioUrl`, so a misnamed restore sent the WHOLE MIX downstream.
    const restored = { generatedAudioUrl: "https://cdn.test/mix.mp3", ...namedRunOutputFields({ vocalUrl: "https://cdn.test/vocals.mp3", instrumentalUrl: "https://cdn.test/inst.mp3" }) }
    for (const type of ["suno-separate", "audio-separation"]) {
      expect(extractNodeOutput(node(type, restored), "vocals"), type).toBe("https://cdn.test/vocals.mp3")
      expect(extractNodeOutput(node(type, restored), "instrumental"), type).toBe("https://cdn.test/inst.mp3")
    }
  })
})

describe("sunoSeparateRunOutputFields", () => {
  it("run-output funnel carries stems and takes", () => {
    expect(sunoSeparateRunOutputFields("suno-separate", { backingVocalsUrl: "B", isolatedUrl: "I", engineUsed: "demucs", junk: 1 }))
      .toEqual({ backingVocalsUrl: "B", isolatedUrl: "I", engineUsed: "demucs" })
    expect(sunoSeparateRunOutputFields("audio-separation", { drumsUrl: "D" })).toEqual({})
  })

  it("writes every result field and run fact — one the run did not return as undefined — and never the stemName setting", () => {
    const out = sunoSeparateRunOutputFields("suno-separate", {
      vocalUrl: "V", instrumentalUrl: "", otherUrl: "O",
      withoutUrl: "W", isolated2Url: "I2", without2Url: "W2",
      separateType: "split_stem_advanced", stemName: "Bass", sunoRefused: true, fallbackReason: "catalog",
      audioUrl: "V", sunoTaskId: "t1",
    })
    const absent = Object.fromEntries(SUNO_SEPARATE_RESULT_FIELDS.map((key) => [key, undefined]))
    expect(out).toStrictEqual({
      ...absent,
      vocalUrl: "V", otherUrl: "O",
      withoutUrl: "W", isolated2Url: "I2", without2Url: "W2",
      separateType: "split_stem_advanced", engineUsed: undefined, sunoRefused: true, fallbackReason: "catalog",
    })
    expect("stemName" in out).toBe(false)
  })

  it("a re-run takes the previous run's stems, takes and fallback facts off the node — its pips route nothing stale", () => {
    // A vocals run that fell back to Demucs, then a one-instrument run on Suno.
    const previous = {
      type: "split_stem_advanced",
      stemName: "Piano",
      generatedAudioUrl: "https://cdn.test/old-vocals.mp3",
      vocalUrl: "https://cdn.test/old-vocals.mp3",
      instrumentalUrl: "https://cdn.test/old-inst.mp3",
      otherUrl: "https://cdn.test/old-other.mp3",
      engineUsed: "demucs",
      sunoRefused: true,
      fallbackReason: "catalog",
    }
    const run = {
      audioUrl: "https://cdn.test/iso.mp3",
      isolatedUrl: "https://cdn.test/iso.mp3",
      withoutUrl: "https://cdn.test/without.mp3",
      separateType: "split_stem_advanced",
      stemName: "Bass",
      engineUsed: "suno",
    }
    // Merged the way every lane writes a patch: the store spreads it, the reopen lanes Object.assign it.
    const data = { ...previous, generatedAudioUrl: run.audioUrl, ...sunoSeparateRunOutputFields("suno-separate", run) }
    for (const stale of ["vocalUrl", "instrumentalUrl", "otherUrl", "sunoRefused", "fallbackReason"]) {
      expect(data[stale as keyof typeof data], stale).toBeUndefined()
    }
    expect(data.engineUsed).toBe("suno")
    expect(data.stemName).toBe("Piano")
    expect(extractNodeOutput(node("suno-separate", data), "vocals")).toBeUndefined()
    expect(extractNodeOutput(node("suno-separate", data), "instrumental")).toBeUndefined()
    expect(extractNodeOutput(node("suno-separate", data), "isolated")).toBe("https://cdn.test/iso.mp3")
    expect(extractNodeOutput(node("suno-separate", data), "without")).toBe("https://cdn.test/without.mp3")
  })

  it("is a no-op for a missing type", () => {
    expect(sunoSeparateRunOutputFields(undefined, { vocalUrl: "V" })).toEqual({})
    expect(sunoSeparateRunOutputFields(null, { vocalUrl: "V" })).toEqual({})
  })
})

describe("extractNodeOutput — suno-separate handles", () => {
  const MIX = "https://cdn.test/primary.mp3"
  it("full-stems instrumental handle yields undefined without instrumentalUrl", () => {
    // A full-stems run's primary is its vocals; the instrumental pip used to fall
    // back to that primary and hand the VOCALS downstream as "instrumental".
    const data = { generatedAudioUrl: MIX, vocalUrl: MIX, drumsUrl: "https://cdn.test/drums.mp3" }
    expect(extractNodeOutput(node("suno-separate", data), "instrumental")).toBeUndefined()
    expect(extractNodeOutput(node("suno-separate", data), "instrumental-out")).toBeUndefined()
    expect(extractNodeOutput(node("suno-separate", data), "vocals")).toBe(MIX)
  })

  it("isolated handle yields isolatedUrl; without yields withoutUrl", () => {
    const data = { generatedAudioUrl: "https://cdn.test/iso.mp3", isolatedUrl: "https://cdn.test/iso.mp3", withoutUrl: "https://cdn.test/without.mp3" }
    expect(extractNodeOutput(node("suno-separate", data), "isolated")).toBe("https://cdn.test/iso.mp3")
    expect(extractNodeOutput(node("suno-separate", data), "without")).toBe("https://cdn.test/without.mp3")
    // One-instrument mode has no vocals / instrumental — never the main audio.
    expect(extractNodeOutput(node("suno-separate", data), "vocals")).toBeUndefined()
    expect(extractNodeOutput(node("suno-separate", data), "instrumental")).toBeUndefined()
  })

  it("isolated / without stay empty on a vocals run", () => {
    const data = { generatedAudioUrl: MIX, vocalUrl: MIX, instrumentalUrl: "https://cdn.test/inst.mp3" }
    expect(extractNodeOutput(node("suno-separate", data), "isolated")).toBeUndefined()
    expect(extractNodeOutput(node("suno-separate", data), "without")).toBeUndefined()
  })

  it("a node saved before the per-stem fields routes its one audio to vocals and instrumental", () => {
    const data = { generatedAudioUrl: MIX }
    expect(extractNodeOutput(node("suno-separate", data), "vocals")).toBe(MIX)
    expect(extractNodeOutput(node("suno-separate", data), "instrumental")).toBe(MIX)
  })

  it("with no handle, reads the active result", () => {
    const data = {
      generatedAudioUrl: "https://cdn.test/a.mp3",
      vocalUrl: "https://cdn.test/a.mp3",
      generatedResults: [{ url: "https://cdn.test/a.mp3" }, { url: "https://cdn.test/b.mp3" }],
      activeResultIndex: 1,
    }
    expect(extractNodeOutput(node("suno-separate", data))).toBe("https://cdn.test/b.mp3")
  })
})
