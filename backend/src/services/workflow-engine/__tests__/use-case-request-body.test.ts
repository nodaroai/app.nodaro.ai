// @test-units-by-name looks up only the tighten-episode body (USE_CASE_BODIES["tighten-episode"])
/**
 * The body the backend engine sends a use-case node's route (`requestOf`).
 * Tighten Episode's bodies are pinned byte for byte (key order included) to
 * the ones P1's engine sent, captured from that code before the request was
 * built from the type's descriptor.
 *
 * One deliberate difference (decided 2026-10-16): a setting set to None
 * (`framing: null`) now reaches the route as `null` — a later node's None is
 * not its default — where P1 left it out. Only a setting the type's body takes
 * as null is sent so; any other null is left out, as P1 left it. Tighten's
 * body takes a null framing and its settings resolver reads null and absent
 * alike (no framing).
 */
import { describe, expect, it } from "vitest"
import { resolveTightenEpisodeSettings, usecaseDescriptor, type UseCaseDescriptor } from "@nodaro/render-rules"
import { USE_CASE_BODIES } from "../../../lib/use-case/bodies.js"
import { requestOf } from "../use-case-request.js"
import type { OrchestratorContext, ResolvedInputs, SimpleNode } from "../types.js"

const tightenEpisodeBody = USE_CASE_BODIES["tighten-episode"]

const USER = "00000000-0000-4000-8000-000000000001"
const WF = "00000000-0000-4000-8000-0000000000aa"
const ctx = { userId: USER, workflowId: WF, billingContext: { payer: "x" } } as unknown as OrchestratorContext
const REC = { useCaseMedia: [{ nodeId: "rec", url: "https://r2/ep.mp4" }] }
const LANE = `"componentDepth":1,"executingComponentIds":[],"previewStopRule":false,"reviewerPresent":false,"billingContext":{"payer":"x"},"userId":"${USER}","workflowId":"${WF}","nodeId":"t1"`

const bodyOf = (data: Record<string, unknown>, inputs: Record<string, unknown> = REC): string => {
  const node = { id: "t1", type: "tighten-episode", data: { label: "Tighten Episode", fieldMappings: {}, ...data } } as unknown as SimpleNode
  return JSON.stringify(requestOf(node, inputs as unknown as ResolvedInputs, ctx, null).body)
}

const DEFAULTS = { output: "video", captions: true, captionStyle: "word-highlight", reviewBeforeRender: false, planTier: "standard", instructions: "" }

describe("Tighten Episode's engine body is P1's, byte for byte", () => {
  it("every setting, a framing and a music bed", () => {
    const data = {
      output: "video", framing: { aspect: "9:16", layout: "stacked" }, captions: false, captionStyle: "karaoke", reviewBeforeRender: true,
      planTier: "premium", instructions: "cut ums", styleGuide: "tight", musicDuckAmount: 40,
    }
    expect(bodyOf(data, { ...REC, useCaseMusic: "https://r2/bed.mp3" })).toBe(
      `{"mediaUrls":["https://r2/ep.mp4"],"musicUrl":"https://r2/bed.mp3","output":"video","framing":{"aspect":"9:16","layout":"stacked"},"captions":false,"captionStyle":"karaoke","reviewBeforeRender":true,"planTier":"premium","instructions":"cut ums","styleGuide":"tight","musicDuckAmount":40,${LANE}}`,
    )
  })

  it("the default settings (the engine sends an empty instruction, as P1's did)", () => {
    expect(bodyOf(DEFAULTS)).toBe(
      `{"mediaUrls":["https://r2/ep.mp4"],"output":"video","captions":true,"captionStyle":"word-highlight","reviewBeforeRender":false,"planTier":"standard","instructions":"",${LANE}}`,
    )
  })

  it("an audio episode with only its output set", () => {
    expect(bodyOf({ output: "audio", instructions: "" })).toBe(`{"mediaUrls":["https://r2/ep.mp4"],"output":"audio","instructions":"",${LANE}}`)
  })

  it("an unset setting is not sent", () => {
    expect(bodyOf({ output: "audio", captions: undefined })).toBe(`{"mediaUrls":["https://r2/ep.mp4"],"output":"audio",${LANE}}`)
  })
})

describe("a setting set to None", () => {
  it("reaches the route as null, in its own place", () => {
    expect(bodyOf({ ...DEFAULTS, framing: null })).toBe(
      `{"mediaUrls":["https://r2/ep.mp4"],"output":"video","framing":null,"captions":true,"captionStyle":"word-highlight","reviewBeforeRender":false,"planTier":"standard","instructions":"",${LANE}}`,
    )
  })

  it("Tighten's route takes it, and reads it as no framing — as it reads an absent one", () => {
    const sent = JSON.parse(bodyOf({ ...DEFAULTS, framing: null })) as Record<string, unknown>
    const parsed = tightenEpisodeBody.safeParse(sent)
    expect(parsed.success).toBe(true)
    const { framing: _none, ...absent } = sent
    expect(resolveTightenEpisodeSettings(parsed.data, "video")).toEqual(resolveTightenEpisodeSettings(absent, "video"))
  })

  it("a stored null on a setting whose body takes no null is dropped, and the run takes the default (as P1's did)", () => {
    // Only a setting the type's body takes as null (framing) is sent as null;
    // `captions: null` (an agent's or an import's write) is left out, as P1 left it.
    const body = bodyOf({ ...DEFAULTS, captions: null, captionStyle: null })
    expect(body).toBe(`{"mediaUrls":["https://r2/ep.mp4"],"output":"video","reviewBeforeRender":false,"planTier":"standard","instructions":"",${LANE}}`)
    expect(tightenEpisodeBody.safeParse(JSON.parse(body)).success).toBe(true)
  })
})

describe("recordings and Master audio (every type takes one recording in this phase)", () => {
  const TWO = { useCaseMedia: [{ nodeId: "a", url: "https://r2/a.mp4" }, { nodeId: "b", url: "https://r2/b.mp4" }] }

  it("a type that takes one recording sends the first in mediaOrder, byte-identical to before when no order is set", () => {
    expect(JSON.parse(bodyOf({ mediaOrder: ["b"] }, TWO)).mediaUrls).toEqual(["https://r2/b.mp4"])
    expect(JSON.parse(bodyOf({}, TWO)).mediaUrls).toEqual(["https://r2/a.mp4"])
    expect(bodyOf(DEFAULTS)).toBe(
      `{"mediaUrls":["https://r2/ep.mp4"],"output":"video","captions":true,"captionStyle":"word-highlight","reviewBeforeRender":false,"planTier":"standard","instructions":"",${LANE}}`,
    )
  })

  it("a wired Master audio is not sent by a type whose descriptor does not take it (none does yet)", () => {
    expect(bodyOf(DEFAULTS, { ...REC, useCaseMasterAudio: "https://r2/m.wav" })).not.toContain("masterAudioUrl")
  })

  it("a type that takes Master audio sends it after the other optional inputs, before the settings", () => {
    const d = usecaseDescriptor("tighten-episode") as { -readonly [K in keyof UseCaseDescriptor]: UseCaseDescriptor[K] }
    const inputs = d.inputs
    d.inputs = [...inputs, "masterAudio"]
    try {
      expect(bodyOf({ output: "audio" }, { ...REC, useCaseMusic: "https://r2/bed.mp3", useCaseMasterAudio: "https://r2/m.wav" })).toBe(
        `{"mediaUrls":["https://r2/ep.mp4"],"musicUrl":"https://r2/bed.mp3","masterAudioUrl":"https://r2/m.wav","output":"audio",${LANE}}`,
      )
      expect(bodyOf({ output: "audio" })).toBe(`{"mediaUrls":["https://r2/ep.mp4"],"output":"audio",${LANE}}`)
    } finally {
      d.inputs = inputs
    }
  })
})
