// @test-units-by-name looks up only the tighten-episode and clip-pack bodies (USE_CASE_BODIES) and builds episode-trailer, clip-pack and episode-chapters engine bodies by type
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
import { resolveTightenEpisodeSettings } from "@nodaro/render-rules"
import { USE_CASE_BODIES } from "../../../lib/use-case/bodies.js"
import { requestOf } from "../use-case-request.js"
import type { OrchestratorContext, ResolvedInputs, SimpleNode } from "../types.js"

const tightenEpisodeBody = USE_CASE_BODIES["tighten-episode"]

const USER = "00000000-0000-4000-8000-000000000001"
const WF = "00000000-0000-4000-8000-0000000000aa"
const ctx = { userId: USER, workflowId: WF, billingContext: { payer: "x" } } as unknown as OrchestratorContext
const REC = { useCaseMedia: [{ nodeId: "rec", url: "https://r2/ep.mp4" }] }
const LANE = `"componentDepth":1,"executingComponentIds":[],"previewStopRule":false,"reviewerPresent":false,"billingContext":{"payer":"x"},"userId":"${USER}","workflowId":"${WF}","nodeId":"t1"`

const bodyOf = (data: Record<string, unknown>, inputs: Record<string, unknown> = REC, multicam = false): string => {
  const node = { id: "t1", type: "tighten-episode", data: { label: "Tighten Episode", fieldMappings: {}, ...data } } as unknown as SimpleNode
  return JSON.stringify(requestOf(node, inputs as unknown as ResolvedInputs, ctx, null, { multicam, framesAvailable: false }).body)
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

describe("recordings and Master audio (decided 2026-10-19: several only for a viewer who may use Speaker Map)", () => {
  const TWO = { useCaseMedia: [{ nodeId: "a", url: "https://r2/a.mp4" }, { nodeId: "b", url: "https://r2/b.mp4" }] }
  const FIRST = { useCaseMedia: [{ nodeId: "a", url: "https://r2/a.mp4" }] }
  const MIC = { useCaseMasterAudio: "https://r2/m.wav", useCaseMasterAudioNodeId: "mic" }
  it("a viewer who may not use Speaker Map: the first recording in mediaOrder alone, byte-identical to the run as before", () => {
    expect(JSON.parse(bodyOf({ mediaOrder: ["b"] }, TWO)).mediaUrls).toEqual(["https://r2/b.mp4"])
    expect(bodyOf(DEFAULTS, TWO)).toBe(bodyOf(DEFAULTS, FIRST))
    expect(bodyOf(DEFAULTS)).toBe(
      `{"mediaUrls":["https://r2/ep.mp4"],"output":"video","captions":true,"captionStyle":"word-highlight","reviewBeforeRender":false,"planTier":"standard","instructions":"",${LANE}}`,
    )
  })
  it("…its master and Cameras settings ignored too, a malformed one included", () => {
    expect(bodyOf({ ...DEFAULTS, cameras: "not cameras" }, { ...TWO, ...MIC })).toBe(bodyOf(DEFAULTS, FIRST))
  })
  it("a viewer who may use Speaker Map: every recording in mediaOrder, then the rest in wire order, with the Cameras settings", () => {
    expect(JSON.parse(bodyOf({ mediaOrder: ["b"] }, TWO, true)).mediaUrls).toEqual(["https://r2/b.mp4", "https://r2/a.mp4"])
    expect(JSON.parse(bodyOf({ cameras: { wide: 2 } }, TWO, true))).toMatchObject({ mediaUrls: ["https://r2/a.mp4", "https://r2/b.mp4"], cameras: { wide: 2 } })
    // One recording sends no Cameras settings, even for such a viewer.
    expect(bodyOf({ ...DEFAULTS, cameras: { wide: 2 } }, REC, true)).toBe(bodyOf(DEFAULTS))
  })

  it("a type that takes one recording (Chapters) sends the first in mediaOrder, whoever the viewer", () => {
    const chapters = (data: Record<string, unknown>) =>
      JSON.parse(JSON.stringify(requestOf({ id: "c1", type: "episode-chapters", data: { label: "Chapters", fieldMappings: {}, ...data } } as unknown as SimpleNode, TWO as unknown as ResolvedInputs, ctx, null, { multicam: true, framesAvailable: false }).body))
    expect(chapters({ mediaOrder: ["b"] }).mediaUrls).toEqual(["https://r2/b.mp4"])
    expect(chapters({}).mediaUrls).toEqual(["https://r2/a.mp4"])
  })

  it("a wired Master audio is not sent by a type whose descriptor does not take it (Chapters)", () => {
    const chapters = requestOf({ id: "c1", type: "episode-chapters", data: { label: "Chapters", fieldMappings: {} } } as unknown as SimpleNode, { ...REC, ...MIC } as unknown as ResolvedInputs, ctx, null, { multicam: true, framesAvailable: false })
    expect(JSON.stringify(chapters.body)).not.toContain("masterAudioUrl")
  })

  it("Tighten takes Master audio and sends it, for such a viewer, after the other optional inputs, before the settings", () => {
    expect(bodyOf({ output: "audio" }, { ...REC, useCaseMusic: "https://r2/bed.mp3", ...MIC }, true)).toBe(
      `{"mediaUrls":["https://r2/ep.mp4"],"musicUrl":"https://r2/bed.mp3","masterAudioUrl":"https://r2/m.wav","output":"audio",${LANE}}`,
    )
    expect(bodyOf({ output: "audio" }, REC, true)).toBe(`{"mediaUrls":["https://r2/ep.mp4"],"output":"audio",${LANE}}`)
  })

  it("a Master audio from the node a recording comes from is not sent (decided 2026-10-19, compared by NODE): the run is built as with none", () => {
    expect(bodyOf({ output: "video" }, { ...REC, useCaseMasterAudio: "https://r2/ep.mp4", useCaseMasterAudioNodeId: "rec" }, true)).toBe(bodyOf({ output: "video" }, REC, true))
    expect(bodyOf({ output: "video" }, { ...TWO, useCaseMasterAudio: "https://r2/b.mp4", useCaseMasterAudioNodeId: "b" }, true)).toBe(bodyOf({ output: "video" }, TWO, true))
  })

  it("a Split Media's audio into Master audio beside its own video into Recordings is that camera's track: no master, the one-recording body", () => {
    const split = { useCaseMedia: [{ nodeId: "split", url: "https://r2/split-video.mp4" }], useCaseMasterAudio: "https://r2/split-audio.m4a", useCaseMasterAudioNodeId: "split" }
    expect(bodyOf({ ...DEFAULTS, cameras: { synced: true } }, split, true)).toBe(bodyOf(DEFAULTS, { useCaseMedia: split.useCaseMedia }, true))
  })
})

describe("the framing source (decided 2026-10-17/20)", () => {
  const FRAMED = { output: "video", framing: { aspect: "9:16", layout: "stacked" } }
  const HEAD = `{"mediaUrls":["https://r2/ep.mp4"],"output":"video","framing":{"aspect":"9:16","layout":"stacked"}`
  const node = (data: Record<string, unknown>) => ({ id: "t1", type: "tighten-episode", data: { label: "Tighten Episode", fieldMappings: {}, ...data } }) as unknown as SimpleNode
  const body = (data: Record<string, unknown>, framesAvailable: boolean) =>
    JSON.stringify(requestOf(node(data), REC as unknown as ResolvedInputs, ctx, null, { multicam: false, framesAvailable }).body)

  it("a node without one sends none — the body as before, whoever the viewer", () => {
    expect(body(FRAMED, true)).toBe(`${HEAD},${LANE}}`)
    expect(body(FRAMED, false)).toBe(`${HEAD},${LANE}}`)
  })
  it("tracking is sent as tracking, whoever the viewer (a caller without Speaker Frames is refused for it)", () => {
    expect(body({ ...FRAMED, framingSource: "tracking" }, true)).toBe(`${HEAD},"framingSource":"tracking",${LANE}}`)
    expect(body({ ...FRAMED, framingSource: "tracking" }, false)).toBe(`${HEAD},"framingSource":"tracking",${LANE}}`)
  })
  it("auto: sent as auto to a viewer who may use Speaker Frames, as the even split to anyone else", () => {
    expect(body({ ...FRAMED, framingSource: "auto" }, true)).toBe(`${HEAD},"framingSource":"auto",${LANE}}`)
    expect(body({ ...FRAMED, framingSource: "auto" }, false)).toBe(`${HEAD},"framingSource":"static",${LANE}}`)
  })
  it("the route's body schema takes every value the engine sends", () => {
    for (const framingSource of ["auto", "static", "tracking"]) {
      expect(tightenEpisodeBody.safeParse({ mediaUrls: ["https://r2/ep.mp4"], framingSource }).success).toBe(true)
    }
  })
})

describe("Trailer's recordings and Master audio (decided 2026-10-20: several only for a viewer who may use Speaker Map)", () => {
  const TWO = { useCaseMedia: [{ nodeId: "a", url: "https://r2/a.mp4" }, { nodeId: "b", url: "https://r2/b.mp4" }] }
  const FIRST = { useCaseMedia: [{ nodeId: "a", url: "https://r2/a.mp4" }] }
  const MIC = { useCaseMasterAudio: "https://r2/m.wav", useCaseMasterAudioNodeId: "mic" }
  const CARD = { useCaseIntroCard: "https://r2/card.mp4" }
  const trailer = (data: Record<string, unknown>, inputs: Record<string, unknown>, multicam: boolean) =>
    JSON.stringify(requestOf({ id: "t1", type: "episode-trailer", data: { label: "Trailer", fieldMappings: {}, ...data } } as unknown as SimpleNode, inputs as unknown as ResolvedInputs, ctx, null, { multicam, framesAvailable: false }).body)

  it("a viewer who may not use Speaker Map: the first recording alone — its master, other cameras and Cameras settings ignored — byte-identical to the run as before", () => {
    expect(trailer({ formats: ["9:16"], cameras: { wide: 2 } }, { ...TWO, ...MIC, ...CARD }, false)).toBe(trailer({ formats: ["9:16"] }, { ...FIRST, ...CARD }, false))
  })
  it("a viewer who may use Speaker Map: every recording, the master and the Cameras settings", () => {
    expect(JSON.parse(trailer({ formats: ["9:16"], cameras: { wide: 2 } }, { ...TWO, ...MIC, ...CARD }, true))).toMatchObject({
      mediaUrls: ["https://r2/a.mp4", "https://r2/b.mp4"],
      masterAudioUrl: "https://r2/m.wav",
      introCardUrl: "https://r2/card.mp4",
      formats: ["9:16"],
      cameras: { wide: 2 },
    })
    // One recording sends no Cameras settings, even for such a viewer.
    expect(trailer({ formats: ["9:16"], cameras: { wide: 2 } }, FIRST, true)).toBe(trailer({ formats: ["9:16"] }, FIRST, false))
  })
})

describe("Clip Pack's recordings, Master audio and framing source (decided 2026-10-17/20)", () => {
  const TWO = { useCaseMedia: [{ nodeId: "a", url: "https://r2/a.mp4" }, { nodeId: "b", url: "https://r2/b.mp4" }] }
  const FIRST = { useCaseMedia: [{ nodeId: "a", url: "https://r2/a.mp4" }] }
  const MIC = { useCaseMasterAudio: "https://r2/m.wav", useCaseMasterAudioNodeId: "mic" }
  const pack = (data: Record<string, unknown>, inputs: Record<string, unknown>, multicam: boolean, framesAvailable = false) =>
    JSON.stringify(requestOf({ id: "c1", type: "clip-pack", data: { label: "Clip Pack", fieldMappings: {}, ...data } } as unknown as SimpleNode, inputs as unknown as ResolvedInputs, ctx, null, { multicam, framesAvailable }).body)

  it("a viewer who may not use Speaker Map: the first recording alone — its master, other cameras and Cameras settings ignored — byte-identical to the run as before", () => {
    for (const cameras of [{ wide: 2 }, null, ""]) {
      expect(pack({ count: 4, cameras }, { ...TWO, ...MIC }, false), JSON.stringify(cameras)).toBe(pack({ count: 4 }, FIRST, false))
    }
  })
  it("a viewer who may use Speaker Map: every recording, the master and the Cameras settings", () => {
    expect(JSON.parse(pack({ count: 4, cameras: { wide: 2 } }, { ...TWO, ...MIC }, true))).toMatchObject({
      mediaUrls: ["https://r2/a.mp4", "https://r2/b.mp4"],
      masterAudioUrl: "https://r2/m.wav",
      count: 4,
      cameras: { wide: 2 },
    })
    expect(pack({ count: 4, cameras: { wide: 2 } }, FIRST, true)).toBe(pack({ count: 4 }, FIRST, false))
  })
  it("auto: sent as auto to a viewer who may use Speaker Frames, as the even split to anyone else; a node without one sends none", () => {
    expect(JSON.parse(pack({ framingSource: "auto" }, FIRST, false, true)).framingSource).toBe("auto")
    expect(JSON.parse(pack({ framingSource: "auto" }, FIRST, false, false)).framingSource).toBe("static")
    expect("framingSource" in JSON.parse(pack({}, FIRST, false, true))).toBe(false)
  })
  it("the route's body schema takes every value the engine sends", () => {
    for (const framingSource of ["auto", "static", "tracking"]) {
      expect(USE_CASE_BODIES["clip-pack"].safeParse({ mediaUrls: ["https://r2/a.mp4", "https://r2/b.mp4"], masterAudioUrl: "https://r2/m.wav", framingSource }).success).toBe(true)
    }
  })
})
