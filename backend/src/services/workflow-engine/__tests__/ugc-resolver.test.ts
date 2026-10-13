/**
 * The orchestrator's input resolution for the UGC video nodes: every input of a
 * UGC node by its own handle (the edge's already-resolved value, the fan-out
 * iteration's item when one is picked), the Creator look as each wired picker's
 * own set fields, and the UGC outputs — read by pip — delivered into every input
 * they connect to, from this run's states and from saved data alike. The canvas
 * twin is frontend/.../__tests__/ugc-resolver-canvas.test.ts: the same graph,
 * the same expectations.
 */
import { ADULT_AGE_IDS, MINOR_IMPLYING_TYPE_IDS, PICKER_CATALOGS } from "@nodaro/prompts"
import { defaultEdgeOutputMode } from "@nodaro/shared"
import { describe, expect, it } from "vitest"
import { getListFanOutForNode, getNodeOutput, resolveNodeInputs } from "../input-resolver.js"
import { executePreview } from "../inline-executor.js"
import { extractSavedNodeOutput, getPrimaryOutput } from "../output-extractor.js"
import { listFor, savedListFor, seededFromSavedData } from "../saved-data.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"

const node = (id: string, type: string, data: Record<string, unknown> = {}): SimpleNode => ({ id, type, data: { label: id, ...data } })
const edge = (source: string, sourceHandle: string, target: string, targetHandle: string, data?: Record<string, unknown>): SimpleEdge =>
  ({ id: `${source}.${sourceHandle}->${target}.${targetHandle}`, source, sourceHandle, target, targetHandle, ...(data ? { data } : {}) })
const T = (i: number) => JSON.stringify({ v: 1, index: i, durationSec: 12, video: { tool: "t", args: {} } })
const PLAN = JSON.stringify({ v: 1, hook: "h" })
const CREATOR = JSON.stringify({ v: 1, gender: "woman", identityImages: ["https://cdn.example/c.png"] })
const PLAN_OUT = JSON.stringify({ v: 1, plan: {}, transcribeArgs: {} })

/** A picker field's option ids, from the catalog both engines read. */
const idsOf = (pickerType: string, field: string): string[] => {
  const catalog = PICKER_CATALOGS.find((c) => c.nodeType === pickerType)
  const options = catalog?.valueField === field ? catalog.options : catalog?.dimensions?.find((d) => d.field === field)?.options
  return (options ?? []).map((o) => o.id)
}
const ADULT_AGES = idsOf("person", "age").filter((id) => ADULT_AGE_IDS.has(id))
const AGE = ADULT_AGES[0]!
const AGE2 = ADULT_AGES[1]!
const TYPE = idsOf("person", "type").find((id) => !MINOR_IMPLYING_TYPE_IDS.has(id))!
const SETTING = idsOf("setting", "setting")[0]!

const site = node("site", "text-prompt", { text: "Acme" })
const shot1 = node("shot1", "upload-image", { url: "https://cdn.example/1.png" })
const shot3 = node("shot3", "upload-image", { url: "https://cdn.example/3.png" })
const person = node("person", "person", { age: AGE, type: TYPE, hairColor: "", executionStatus: "completed" })
const person2 = node("person2", "person", { age: AGE2 })
const setting = node("setting", "setting", { setting: SETTING })
const script = node("script", "ugc-script", { targetDurationSec: 15 })
const creator = node("creator", "ugc-creator", { source: "sampled", gender: "woman" })
const clips = node("clips", "ugc-clips")
const clip = node("clip", "ugc-clip", { rerender: {} })
const cards = node("cards", "ugc-cards")
// Ordinary consumers of the UGC outputs.
const gen = node("gen", "generate-image")
const lip = node("lip", "lip-sync")
const collage = node("collage", "image-collage")
const post = node("post", "instagram-post", { action: "post-image" })
const writer = node("writer", "llm-chat")
const speech = node("speech", "text-to-speech")
const ALL = [site, shot1, shot3, person, person2, setting, script, creator, clips, clip, cards, gen, lip, collage, post, writer, speech]
const STATES: Record<string, NodeExecutionState> = {
  script: { status: "completed", output: { ugcOutputs: { plan: PLAN, category: "saas" } } },
  creator: { status: "completed", output: { ugcOutputs: { creator: CREATOR, image: "https://cdn.example/c.png" }, imageUrl: "https://cdn.example/c.png" } },
  clips: { status: "completed", output: { ugcOutputs: { clips: T(0), "plan-out": PLAN_OUT, transcript: "a b" }, listResults: [T(0), T(1)] } },
  cards: { status: "completed", output: { ugcOutputs: { layerPlan: "[]", captionPlan: "{}", report: "Clip 2 runs long." } } },
}
const ugcOf = (target: SimpleNode, edges: SimpleEdge[], states = STATES) => resolveNodeInputs(target, edges, states, ALL).ugc

describe("the backend routes the UGC inputs", () => {
  it("reads its picker ids from the catalog: adult ages, a type that implies no child", () => {
    expect([AGE, AGE2, TYPE, SETTING].every((id) => typeof id === "string" && id.length > 0)).toBe(true)
    expect(AGE).not.toBe(AGE2)
  })

  it("UGC Script: the site text and each screenshot at its own handle", () => {
    expect(ugcOf(script, [edge("site", "prompt", "script", "site"), edge("shot1", "image", "script", "screenshot"), edge("shot3", "image", "script", "screenshot3")]))
      .toEqual({ site: "Acme", screenshot: "https://cdn.example/1.png", screenshot3: "https://cdn.example/3.png" })
  })

  it("UGC Clips: the plan and creator wires; UGC Creator: the category text", () => {
    expect(ugcOf(clips, [edge("script", "plan", "clips", "plan"), edge("creator", "creator", "clips", "creator")])).toEqual({ plan: PLAN, creator: CREATOR })
    expect(ugcOf(creator, [edge("script", "category", "creator", "category")])).toEqual({ category: "saas" })
  })

  it("the pickers handle carries each picker's own set fields, never its single-string value; the later edge wins", () => {
    const u = ugcOf(creator, [edge("person", "out", "creator", "pickers"), edge("setting", "out", "creator", "pickers")])
    expect(u?.pickers).toEqual({ person: { age: AGE, type: TYPE }, setting: { setting: SETTING } })
    const twice = ugcOf(creator, [edge("person", "out", "creator", "pickers"), edge("person2", "out", "creator", "pickers")])
    expect(twice?.pickers).toEqual({ person: { age: AGE2 } })
  })

  it("the pickers handle survives the orchestrator's seeded picker state (the parameter skip must not drop it)", () => {
    const seeded: Record<string, NodeExecutionState> = { ...STATES, person: { status: "completed", output: { text: "<a hint>" } }, setting: { status: "completed", output: { text: "<a hint>" } } }
    const u = ugcOf(creator, [edge("person", "out", "creator", "pickers"), edge("setting", "out", "creator", "pickers")], seeded)
    expect(u?.pickers).toEqual({ person: { age: AGE, type: TYPE }, setting: { setting: SETTING } })
  })

  it("plan-out and transcript carry one value each; clips fans out by default", () => {
    const u = ugcOf(cards, [edge("clips", "plan-out", "cards", "plan"), edge("clips", "transcript", "cards", "transcript")])
    expect(u).toEqual({ plan: PLAN_OUT, transcript: "a b" })
    expect(defaultEdgeOutputMode("ugc-clips", "clips")).toBe("each")
    expect(getListFanOutForNode(clip, [edge("clips", "clips", "clip", "clip")], STATES, ALL)?.items).toEqual([T(0), T(1)])
  })

  it("fan-out iteration i receives ticket i, never ugcOutputs.clips (ticket 0) on every iteration", () => {
    const fan = [edge("clips", "clips", "clip", "clip")]
    expect(resolveNodeInputs(clip, fan, STATES, ALL, undefined, 0).ugc).toEqual({ clip: T(0) })
    expect(resolveNodeInputs(clip, fan, STATES, ALL, undefined, 1).ugc).toEqual({ clip: T(1) })
  })

  it("a single-run UGC Clips with one ticket hands UGC Clip that ticket, not a one-element array", () => {
    const one: Record<string, NodeExecutionState> = { ...STATES, clips: { status: "completed", output: { ugcOutputs: { clips: T(0) }, listResults: [T(0)] } } }
    expect(getListFanOutForNode(clip, [edge("clips", "clips", "clip", "clip")], one, ALL)).toBeUndefined()
    expect(ugcOf(clip, [edge("clips", "clips", "clip", "clip")], one)).toEqual({ clip: T(0) })
  })

  it("this run's single ticket wins over the node's saved two-ticket list", () => {
    const saved = node("clips", "ugc-clips", { __listResults: [T(0), T(1)], ugcOutputs: { clips: T(0) } })
    const one: Record<string, NodeExecutionState> = { clips: { status: "completed", output: { ugcOutputs: { clips: T(5) }, listResults: [T(5)] } } }
    const all = ALL.map((n) => (n.id === "clips" ? saved : n))
    expect(getListFanOutForNode(clip, [edge("clips", "clips", "clip", "clip")], one, all)).toBeUndefined()
    expect(resolveNodeInputs(clip, [edge("clips", "clips", "clip", "clip")], one, all).ugc).toEqual({ clip: T(5) })
  })

  it("saved data (no state this run) is read like the canvas reads it", () => {
    const saved = node("clips", "ugc-clips", { __listResults: [T(0), T(1)], ugcOutputs: { clips: T(0) } })
    // The saved list: savedListFor reads __listResults because ugc-clips is in FAN_OUT_EACH_HANDLES.
    expect(savedListFor(saved, undefined)).toEqual([T(0), T(1)])
    expect(listFor(saved, undefined)).toEqual([T(0), T(1)])
    // The saved outputs.
    expect(extractSavedNodeOutput(saved)?.ugcOutputs).toEqual({ clips: T(0) })
    expect(extractSavedNodeOutput(saved)?.listResults).toEqual([T(0), T(1)])
    // A state this run built from the saved data still serves the saved list.
    expect(getNodeOutput(saved, "clips", { clips: seededFromSavedData(extractSavedNodeOutput(saved)) })).toBe(T(0))
  })

  it("saved UGC Cards hand on their Notes as the node's text, as a run of it does", () => {
    const outputs = { layerPlan: "[]", captionPlan: "{\"v\":1}", report: "No issues." }
    const saved = node("cards", "ugc-cards", { ugcOutputs: outputs })
    expect(extractSavedNodeOutput(saved)).toEqual({ ugcOutputs: outputs, text: "No issues." })
    // Notes that were never written leave the text out.
    expect(extractSavedNodeOutput(node("cards", "ugc-cards", { ugcOutputs: { layerPlan: "[]" } }))).toEqual({ ugcOutputs: { layerPlan: "[]" } })
  })
})

describe("the Creator look: each picker's own set fields", () => {
  it("a custom age rides with its number, so the creator's adult floor can read it", () => {
    const custom = node("custom", "person", { age: "age-custom", customAge: 34, type: TYPE })
    const u = resolveNodeInputs(creator, [edge("custom", "out", "creator", "pickers")], STATES, [...ALL, custom]).ugc
    expect(u?.pickers).toEqual({ person: { age: "age-custom", customAge: 34, type: TYPE } })
  })

  it("drops empty values, run state, free text and any field the catalog does not name", () => {
    const busy = node("busy", "person", {
      age: AGE, type: "", hairColor: [], eyeColor: "  ", skinTone: null, ethnicity: [idsOf("person", "ethnicity")[0]!],
      executionStatus: "completed", preText: "a free text", maxItemsPerRow: 2, fieldMappings: {},
    })
    const u = resolveNodeInputs(creator, [edge("busy", "out", "creator", "pickers")], STATES, [...ALL, busy]).ugc
    expect(u?.pickers).toEqual({ person: { age: AGE, ethnicity: [idsOf("person", "ethnicity")[0]!] } })
  })

  it("a picker of another kind hands the Creator nothing (the look takes exactly the four creator pickers)", () => {
    const mood = node("mood", "mood", { mood: "happy" })
    const u = resolveNodeInputs(creator, [edge("mood", "out", "creator", "pickers"), edge("setting", "out", "creator", "pickers")], STATES, [...ALL, mood]).ugc
    expect(u?.pickers).toEqual({ setting: { setting: SETTING } })
  })

  it("a pick that sets no field is skipped: a later blank Person never erases an earlier filled one", () => {
    const blank = node("blank", "person", { age: "" })
    const u = resolveNodeInputs(creator, [edge("person", "out", "creator", "pickers"), edge("blank", "out", "creator", "pickers")], STATES, [...ALL, blank]).ugc
    expect(u?.pickers).toEqual({ person: { age: AGE, type: TYPE } })
  })

  it("blank picks alone send no look at all", () => {
    const blank = node("blank", "person", { age: "", hairColor: "" })
    expect(resolveNodeInputs(creator, [edge("blank", "out", "creator", "pickers")], STATES, [...ALL, blank]).ugc).toBeUndefined()
  })
})

describe("a wired empty UGC text arrives empty, never as nothing", () => {
  it("UGC Clips' empty transcript reaches UGC Cards as an empty string", () => {
    const quiet: Record<string, NodeExecutionState> = { ...STATES, clips: { status: "completed", output: { ugcOutputs: { clips: T(0), "plan-out": PLAN_OUT, transcript: "" } } } }
    expect(ugcOf(cards, [edge("clips", "transcript", "cards", "transcript")], quiet)).toEqual({ transcript: "" })
  })

  it("an output a UGC node does not hold is not wired at all", () => {
    expect(ugcOf(cards, [edge("clips", "transcript", "cards", "transcript")], {})).toBeUndefined()
  })

  it("a blank Text into UGC Script's site arrives as nothing, as on the canvas: only a UGC output's empty text is a value", () => {
    for (const text of ["", "  "]) {
      const blank = node("blank", "text-prompt", { text })
      const u = resolveNodeInputs(script, [edge("blank", "prompt", "script", "site"), edge("shot1", "image", "script", "screenshot")], STATES, [...ALL, blank]).ugc
      expect(u, JSON.stringify(text)).toEqual({ screenshot: "https://cdn.example/1.png" })
    }
  })
})

describe("a fanned UGC Clip outside the run (Run from here, Run selected)", () => {
  const takes = ["https://cdn.example/old.mp4", "https://cdn.example/1.mp4", "https://cdn.example/2.mp4"]
  const fanned = node("clip", "ugc-clip", {
    rerender: {},
    __listResults: ["https://cdn.example/1.mp4", "https://cdn.example/2.mp4"],
    generatedResults: takes.map((url) => ({ url })),
    activeResultIndex: 2,
    generatedVideoUrl: "https://cdn.example/2.mp4",
  })
  const join = node("join", "combine-videos", { transition: "cut" })
  const ALL_EDGE = edge("clip", "video-out", "join", "in", { outputMode: "all" })

  it("hands a Combine Videos after it the clips of its last run, never every take it has held", () => {
    expect(extractSavedNodeOutput(fanned)?.listResults).toEqual(["https://cdn.example/1.mp4", "https://cdn.example/2.mp4"])
    const states = { clip: seededFromSavedData(extractSavedNodeOutput(fanned)) }
    expect(resolveNodeInputs(join, [ALL_EDGE], states, [fanned, join]).videoUrls).toEqual(["https://cdn.example/1.mp4", "https://cdn.example/2.mp4"])
  })

  it("a clip that never fanned out lists no batch", () => {
    const once = node("clip", "ugc-clip", { rerender: {}, generatedVideoUrl: "https://cdn.example/1.mp4", __listResults: [] })
    expect(extractSavedNodeOutput(once)?.listResults).toBeUndefined()
  })
})

describe("a UGC output reaches every input it connects to", () => {
  const inputsOf = (target: SimpleNode, edges: SimpleEdge[], states = STATES) => resolveNodeInputs(target, edges, states, ALL)

  it("UGC Creator's image is an image: references, an image input, a collage, a post's photo", () => {
    expect(inputsOf(gen, [edge("creator", "image", "gen", "references")]).referenceImageUrls).toEqual(["https://cdn.example/c.png"])
    expect(inputsOf(lip, [edge("creator", "image", "lip", "image")]).imageUrl).toBe("https://cdn.example/c.png")
    expect(inputsOf(collage, [edge("creator", "image", "collage", "in")]).imageUrls).toEqual(["https://cdn.example/c.png"])
    // A file link that does not end in an image extension is still the creator's image, never a caption.
    const noExtension: Record<string, NodeExecutionState> = { ...STATES, creator: { status: "completed", output: { ugcOutputs: { creator: CREATOR, image: "https://cdn.example/creator/1" }, imageUrl: "https://cdn.example/creator/1" } } }
    const toPost = inputsOf(post, [edge("creator", "image", "post", "in")], noExtension)
    expect(toPost.imageUrl).toBe("https://cdn.example/creator/1")
    expect(toPost.caption).toBeUndefined()
    expect(toPost.prompt).toBeUndefined()
  })

  it("the text pips are text: the category, the transcript and the Notes reach a prompt", () => {
    expect(inputsOf(writer, [edge("script", "category", "writer", "prompt")]).prompt).toBe("saas")
    expect(inputsOf(speech, [edge("clips", "transcript", "speech", "prompt")]).prompt).toBe("a b")
    expect(inputsOf(writer, [edge("cards", "report", "writer", "prompt")]).prompt).toBe("Clip 2 runs long.")
    expect(inputsOf(gen, [edge("script", "category", "gen", "prompt")]).prompt).toBe("saas")
  })

  it("UGC Clip's clip is a video wherever the server sorts media: a Preview item", () => {
    // A file link that does not end in a video extension is still the clip.
    const preview = node("preview", "preview")
    const states: Record<string, NodeExecutionState> = { clip: { status: "completed", output: { videoUrl: "https://cdn.example/clip/1", ugcOutputs: { "video-out": "https://cdn.example/clip/1" } } } }
    expect(executePreview(preview, [edge("clip", "video-out", "preview", "in")], [clip, preview], states).previewItems)
      .toEqual([expect.objectContaining({ type: "video", value: "https://cdn.example/clip/1" })])
  })

  it("each pip hands on its own value, by pip; an edge with no pip reads the node's primary output", () => {
    const out = STATES.clips!.output!
    expect(getPrimaryOutput(out, "ugc-clips", "plan-out")).toBe(PLAN_OUT)
    expect(getPrimaryOutput(out, "ugc-clips", "transcript")).toBe("a b")
    expect(getPrimaryOutput(out, "ugc-clips", null)).toBe(T(0))
    expect(getPrimaryOutput(STATES.creator!.output!, "ugc-creator", "image")).toBe("https://cdn.example/c.png")
    expect(getPrimaryOutput(STATES.creator!.output!, "ugc-creator", undefined)).toBe(CREATOR)
    expect(getPrimaryOutput({ ugcOutputs: { creator: CREATOR } }, "ugc-creator", "image")).toBeUndefined()
  })

  it("UGC Clip hands on the clip it holds", () => {
    expect(getPrimaryOutput({ videoUrl: "https://cdn.example/c.mp4", ugcOutputs: { "video-out": "https://cdn.example/c.mp4" } }, "ugc-clip", "video-out")).toBe("https://cdn.example/c.mp4")
    expect(getPrimaryOutput({ ugcOutputs: { "video-out": "https://cdn.example/c.mp4" } }, "ugc-clip", null)).toBe("https://cdn.example/c.mp4")
    expect(getPrimaryOutput({ videoUrl: "https://cdn.example/c.mp4" }, "ugc-clip", "video-out")).toBe("https://cdn.example/c.mp4")
  })
})

describe("a UGC node outside the run is read from its saved data", () => {
  it("a creator's saved image is the image its creator wire names", () => {
    const saved = node("creator", "ugc-creator", { ugcOutputs: { creator: CREATOR, image: "https://cdn.example/c.png" }, generatedImageUrl: "https://cdn.example/c.png" })
    expect(extractSavedNodeOutput(saved)).toEqual({ ugcOutputs: { creator: CREATOR, image: "https://cdn.example/c.png" }, imageUrl: "https://cdn.example/c.png" })
  })

  it("a creator whose options wait for a pick hands nothing on, whatever older image it shows", () => {
    const waiting = node("creator", "ugc-creator", { candidates: [{ imageUrl: "https://cdn.example/a.png", record: { v: 1 } }], generatedImageUrl: "https://cdn.example/old.png" })
    expect(extractSavedNodeOutput(waiting)).toBeUndefined()
    const states = { creator: seededFromSavedData(extractSavedNodeOutput(waiting)) }
    expect(getNodeOutput(waiting, "image", states)).toBeUndefined()
    expect(getNodeOutput(waiting, "creator", states)).toBeUndefined()
  })

  it("a script's saved plan and category, as the canvas holds them", () => {
    const saved = node("script", "ugc-script", { ugcOutputs: { plan: PLAN, category: "saas" }, result: { plan: { hook: "h" } } })
    expect(extractSavedNodeOutput(saved)).toEqual({ ugcOutputs: { plan: PLAN, category: "saas" } })
    const all = ALL.map((n) => (n.id === "script" ? saved : n))
    expect(resolveNodeInputs(clips, [edge("script", "plan", "clips", "plan")], { script: seededFromSavedData(extractSavedNodeOutput(saved)) }, all).ugc).toEqual({ plan: PLAN })
  })

  it("a clip's saved output: the take it shows, its notes and its length", () => {
    const saved = node("clip", "ugc-clip", {
      rerender: { "1": 1 },
      generatedResults: [{ url: "https://cdn.example/take2.mp4" }, { url: "https://cdn.example/take1.mp4" }],
      activeResultIndex: 1,
      generatedVideoUrl: "https://cdn.example/take1.mp4",
      ugcOutputs: { "video-out": "https://cdn.example/take2.mp4" },
      clipWarnings: ["clip_lengthened:13"],
      durationSec: 13,
      __listResultMeta: [{ warnings: ["clip_lengthened:13"], durationSec: 13 }],
    })
    const out = extractSavedNodeOutput(saved)
    // The take the person picked, as for every video node.
    expect(out?.videoUrl).toBe("https://cdn.example/take1.mp4")
    expect(out?.durationSec).toBe(13)
    expect(out?.clipWarnings).toEqual(["clip_lengthened:13"])
    expect(out?.listResultMeta).toEqual([{ warnings: ["clip_lengthened:13"], durationSec: 13 }])
    const states = { clip: seededFromSavedData(out) }
    expect(getNodeOutput(saved, "video-out", states)).toBe("https://cdn.example/take1.mp4")
    // UGC Cards' notes from a clip outside the run, as the canvas reads them.
    expect(resolveNodeInputs(cards, [edge("clip", "video-out", "cards", "notes", { outputMode: "all" })], states, [saved, cards]).clipNotes)
      .toEqual([{ clip: 1, warnings: ["clip_lengthened:13"], durationSec: 13 }])
  })

  it("a UGC node that never ran has no saved output", () => {
    for (const n of [script, creator, clips, clip, cards]) expect(extractSavedNodeOutput(n), n.type).toBeUndefined()
  })
})
