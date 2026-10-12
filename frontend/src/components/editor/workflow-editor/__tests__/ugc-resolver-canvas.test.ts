/**
 * The editor's input resolution for the UGC video nodes — the canvas twin of
 * the backend's backend/src/services/workflow-engine/__tests__/ugc-resolver.test.ts:
 * the same graph with each node's outputs on its data (`ugcOutputs`,
 * `__listResults`), and the same expectations.
 */
import { ADULT_AGE_IDS, MINOR_IMPLYING_TYPE_IDS, PICKER_CATALOGS } from "@nodaro/prompts"
import { defaultEdgeOutputMode } from "@nodaro/shared"
import { describe, expect, it } from "vitest"
import { collectMediaAssets, detectPreviewItemType, extractNodeOutput } from "../execution-graph"
import { extractNodeOutputAsList, getListFanOutForNode, resolveNodeInputs } from "../node-input-resolver"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const node = (id: string, type: string, data: Record<string, unknown> = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const edge = (source: string, sourceHandle: string, target: string, targetHandle: string, data?: Record<string, unknown>) =>
  ({ id: `${source}.${sourceHandle}->${target}.${targetHandle}`, source, sourceHandle, target, targetHandle, ...(data ? { data } : {}) }) as unknown as WorkflowEdge
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
const script = node("script", "ugc-script", { targetDurationSec: 15, ugcOutputs: { plan: PLAN, category: "saas" } })
const creator = node("creator", "ugc-creator", {
  source: "sampled", gender: "woman", ugcOutputs: { creator: CREATOR, image: "https://cdn.example/c.png" }, generatedImageUrl: "https://cdn.example/c.png",
})
const clips = node("clips", "ugc-clips", { ugcOutputs: { clips: T(0), "plan-out": PLAN_OUT, transcript: "a b" }, __listResults: [T(0), T(1)] })
const clip = node("clip", "ugc-clip", { rerender: {} })
const cards = node("cards", "ugc-cards", { ugcOutputs: { layerPlan: "[]", captionPlan: "{}", report: "Clip 2 runs long." } })
// Ordinary consumers of the UGC outputs.
const gen = node("gen", "generate-image")
const lip = node("lip", "lip-sync")
const collage = node("collage", "image-collage")
const post = node("post", "instagram-post", { action: "post-image" })
const writer = node("writer", "llm-chat")
const speech = node("speech", "text-to-speech")
const NODES = [site, shot1, shot3, person, person2, setting, script, creator, clips, clip, cards, gen, lip, collage, post, writer, speech]
/** The graph with some nodes replaced by the given ones (same ids). */
const withNodes = (...replaced: WorkflowNode[]) => NODES.map((n) => replaced.find((r) => r.id === n.id) ?? n)
const ugcOf = (target: WorkflowNode, edges: WorkflowEdge[], nodes = NODES) => resolveNodeInputs(target, nodes, edges).ugc

describe("the canvas routes the UGC inputs", () => {
  it("reads its picker ids from the catalog: adult ages, a type that implies no child", () => {
    expect([AGE, AGE2, TYPE, SETTING].every((id) => typeof id === "string" && id.length > 0)).toBe(true)
    expect(AGE).not.toBe(AGE2)
  })

  it("UGC Script: the site text and each screenshot at its own handle", () => {
    expect(ugcOf(script, [edge("site", "prompt", "script", "site"), edge("shot1", "image", "script", "screenshot"), edge("shot3", "image", "script", "screenshot3")]))
      .toEqual({ site: "Acme", screenshot: "https://cdn.example/1.png", screenshot3: "https://cdn.example/3.png" })
  })

  it("UGC Creator in the author's own editor: an Upload Image wired into its photo input hands it the photo it holds", () => {
    // Publishing empties that upload for everyone else (stripUgcPublishState); the editor reads it as it is.
    const photo = node("photo", "upload-image", { url: "https://cdn.example/author.png", r2Url: "https://cdn.example/author.png" })
    const myPhoto = node("creator", "ugc-creator", { source: "photo", gender: "woman" })
    expect(ugcOf(myPhoto, [edge("photo", "image", "creator", "photo")], [...NODES.filter((n) => n.id !== "creator"), myPhoto, photo])).toEqual({ photo: "https://cdn.example/author.png" })
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

  it("plan-out and transcript carry one value each; clips fans out by default", () => {
    const u = ugcOf(cards, [edge("clips", "plan-out", "cards", "plan"), edge("clips", "transcript", "cards", "transcript")])
    expect(u).toEqual({ plan: PLAN_OUT, transcript: "a b" })
    expect(defaultEdgeOutputMode("ugc-clips", "clips")).toBe("each")
    expect(getListFanOutForNode(clip, NODES, [edge("clips", "clips", "clip", "clip")])?.items).toEqual([T(0), T(1)])
  })

  it("fan-out iteration i receives ticket i, never ugcOutputs.clips (ticket 0) on every iteration", () => {
    const fan = [edge("clips", "clips", "clip", "clip")]
    expect(resolveNodeInputs(clip, NODES, fan, 0).ugc).toEqual({ clip: T(0) })
    expect(resolveNodeInputs(clip, NODES, fan, 1).ugc).toEqual({ clip: T(1) })
  })

  it("a single-run UGC Clips with one ticket hands UGC Clip that ticket, not a one-element array", () => {
    const one = withNodes(node("clips", "ugc-clips", { ugcOutputs: { clips: T(0) }, __listResults: [T(0)] }))
    expect(getListFanOutForNode(clip, one, [edge("clips", "clips", "clip", "clip")])).toBeUndefined()
    expect(ugcOf(clip, [edge("clips", "clips", "clip", "clip")], one)).toEqual({ clip: T(0) })
  })

  it("a one-ticket run replaces a saved two-ticket list", () => {
    // The UGC Clips executor clears __listResults at run start and writes this run's list.
    const rerun = withNodes(node("clips", "ugc-clips", { ugcOutputs: { clips: T(5) }, __listResults: [T(5)] }))
    expect(getListFanOutForNode(clip, rerun, [edge("clips", "clips", "clip", "clip")])).toBeUndefined()
    expect(ugcOf(clip, [edge("clips", "clips", "clip", "clip")], rerun)).toEqual({ clip: T(5) })
  })
})

describe("the Creator look: each picker's own set fields", () => {
  it("a custom age rides with its number, so the creator's adult floor can read it", () => {
    const custom = node("custom", "person", { age: "age-custom", customAge: 34, type: TYPE })
    const u = resolveNodeInputs(creator, [...NODES, custom], [edge("custom", "out", "creator", "pickers")]).ugc
    expect(u?.pickers).toEqual({ person: { age: "age-custom", customAge: 34, type: TYPE } })
  })

  it("drops empty values, run state, free text and any field the catalog does not name", () => {
    const busy = node("busy", "person", {
      age: AGE, type: "", hairColor: [], eyeColor: "  ", skinTone: null, ethnicity: [idsOf("person", "ethnicity")[0]!],
      executionStatus: "completed", preText: "a free text", maxItemsPerRow: 2, fieldMappings: {},
    })
    const u = resolveNodeInputs(creator, [...NODES, busy], [edge("busy", "out", "creator", "pickers")]).ugc
    expect(u?.pickers).toEqual({ person: { age: AGE, ethnicity: [idsOf("person", "ethnicity")[0]!] } })
  })

  it("a picker of another kind hands the Creator nothing (the look takes exactly the four creator pickers)", () => {
    const mood = node("mood", "mood", { mood: "happy" })
    const u = resolveNodeInputs(creator, [...NODES, mood], [edge("mood", "out", "creator", "pickers"), edge("setting", "out", "creator", "pickers")]).ugc
    expect(u?.pickers).toEqual({ setting: { setting: SETTING } })
  })

  it("a pick that sets no field is skipped: a later blank Person never erases an earlier filled one", () => {
    const blank = node("blank", "person", { age: "" })
    const u = resolveNodeInputs(creator, [...NODES, blank], [edge("person", "out", "creator", "pickers"), edge("blank", "out", "creator", "pickers")]).ugc
    expect(u?.pickers).toEqual({ person: { age: AGE, type: TYPE } })
  })

  it("blank picks alone send no look at all", () => {
    const blank = node("blank", "person", { age: "", hairColor: "" })
    expect(resolveNodeInputs(creator, [...NODES, blank], [edge("blank", "out", "creator", "pickers")]).ugc).toBeUndefined()
  })
})

describe("a wired empty UGC text arrives empty, never as nothing", () => {
  it("UGC Clips' empty transcript reaches UGC Cards as an empty string", () => {
    const quiet = withNodes(node("clips", "ugc-clips", { ugcOutputs: { clips: T(0), "plan-out": PLAN_OUT, transcript: "" } }))
    expect(ugcOf(cards, [edge("clips", "transcript", "cards", "transcript")], quiet)).toEqual({ transcript: "" })
  })

  it("an output a UGC node does not hold is not wired at all", () => {
    const fresh = withNodes(node("clips", "ugc-clips"))
    expect(ugcOf(cards, [edge("clips", "transcript", "cards", "transcript")], fresh)).toBeUndefined()
  })

  it("a blank Text into UGC Script's site arrives as nothing, as on the server: only a UGC output's empty text is a value", () => {
    for (const text of ["", "  "]) {
      const blank = node("blank", "text-prompt", { text })
      const u = resolveNodeInputs(script, [...NODES, blank], [edge("blank", "prompt", "script", "site"), edge("shot1", "image", "script", "screenshot")]).ugc
      expect(u, JSON.stringify(text)).toEqual({ screenshot: "https://cdn.example/1.png" })
    }
  })
})

describe("a fanned UGC Clip read from its saved data (a ▶ below it, as Run from here on the server)", () => {
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
    expect(extractNodeOutputAsList(fanned, "video-out")).toEqual(["https://cdn.example/1.mp4", "https://cdn.example/2.mp4"])
    expect(resolveNodeInputs(join, [fanned, join], [ALL_EDGE]).videoUrls).toEqual(["https://cdn.example/1.mp4", "https://cdn.example/2.mp4"])
  })

  it("a clip that never fanned out reads its takes as before", () => {
    const once = node("clip", "ugc-clip", { rerender: {}, generatedResults: takes.map((url) => ({ url })) })
    expect(extractNodeOutputAsList(once, "video-out")).toEqual(takes)
  })
})

describe("a UGC output reaches every input it connects to", () => {
  const inputsOf = (target: WorkflowNode, edges: WorkflowEdge[], nodes = NODES) => resolveNodeInputs(target, nodes, edges)

  it("UGC Creator's image is an image: references, an image input, a collage, a post's photo", () => {
    expect(inputsOf(gen, [edge("creator", "image", "gen", "references")]).referenceImageUrls).toEqual(["https://cdn.example/c.png"])
    expect(inputsOf(lip, [edge("creator", "image", "lip", "image")]).imageUrl).toBe("https://cdn.example/c.png")
    expect(inputsOf(collage, [edge("creator", "image", "collage", "in")]).imageUrls).toEqual(["https://cdn.example/c.png"])
    // A file link that does not end in an image extension is still the creator's image, never the post's text.
    const noExtension = withNodes(node("creator", "ugc-creator", { ugcOutputs: { creator: CREATOR, image: "https://cdn.example/creator/1" } }))
    const toPost = inputsOf(post, [edge("creator", "image", "post", "in")], noExtension)
    expect(toPost.imageUrl).toBe("https://cdn.example/creator/1")
    expect(toPost.prompt).toBeUndefined()
  })

  it("the text pips are text: the category, the transcript and the Notes reach a prompt", () => {
    expect(inputsOf(writer, [edge("script", "category", "writer", "prompt")]).prompt).toBe("saas")
    expect(inputsOf(speech, [edge("clips", "transcript", "speech", "prompt")]).prompt).toBe("a b")
    expect(inputsOf(writer, [edge("cards", "report", "writer", "prompt")]).prompt).toBe("Clip 2 runs long.")
    expect(inputsOf(gen, [edge("script", "category", "gen", "prompt")]).prompt).toBe("saas")
  })

  it("UGC Clip's clip is a video wherever the editor sorts media: a Preview item, a composer's assets", () => {
    // A file link that does not end in a video extension is still the clip.
    const shown = node("clip", "ugc-clip", { ugcOutputs: { "video-out": "https://cdn.example/clip/1" } })
    expect(detectPreviewItemType("ugc-clip", "https://cdn.example/clip/1", "video-out")).toBe("video")
    const composer = node("composer", "video-composer")
    expect(collectMediaAssets(composer, [edge("clip", "video-out", "composer", "in")], [shown, composer]))
      .toEqual([expect.objectContaining({ id: "clip", type: "video", url: "https://cdn.example/clip/1" })])
  })
})

describe("what an edge from a UGC node reads on the canvas (extractNodeOutput)", () => {
  it("each pip hands on its own value; an edge with no pip reads the node's primary output", () => {
    expect(extractNodeOutput(clips, "plan-out")).toBe(PLAN_OUT)
    expect(extractNodeOutput(clips, "transcript")).toBe("a b")
    expect(extractNodeOutput(clips)).toBe(T(0))
    expect(extractNodeOutput(creator, "image")).toBe("https://cdn.example/c.png")
    expect(extractNodeOutput(creator)).toBe(CREATOR)
    expect(extractNodeOutput(cards, "report")).toBe("Clip 2 runs long.")
  })

  it("a creator whose options wait for a pick hands nothing on, whatever older image it shows", () => {
    const waiting = node("creator", "ugc-creator", { candidates: [{ imageUrl: "https://cdn.example/a.png", record: { v: 1 } }], generatedImageUrl: "https://cdn.example/old.png" })
    expect(extractNodeOutput(waiting, "image")).toBeUndefined()
    expect(extractNodeOutput(waiting)).toBeUndefined()
  })

  it("UGC Clip hands on the take it shows, as every video node does", () => {
    const takes = node("clip", "ugc-clip", {
      generatedResults: [{ url: "https://cdn.example/take2.mp4" }, { url: "https://cdn.example/take1.mp4" }],
      activeResultIndex: 1,
      generatedVideoUrl: "https://cdn.example/take1.mp4",
      ugcOutputs: { "video-out": "https://cdn.example/take2.mp4" },
    })
    expect(extractNodeOutput(takes, "video-out")).toBe("https://cdn.example/take1.mp4")
    expect(extractNodeOutput(node("clip", "ugc-clip", { ugcOutputs: { "video-out": "https://cdn.example/c.mp4" } }), "video-out")).toBe("https://cdn.example/c.mp4")
    expect(extractNodeOutput(clip, "video-out")).toBeUndefined()
  })
})
