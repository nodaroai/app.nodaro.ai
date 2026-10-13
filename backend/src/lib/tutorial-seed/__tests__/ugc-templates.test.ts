/**
 * Structural validation for the three UGC video templates: a creator talks to camera about a
 * product while its pictures pop up as cards, with captions.
 * - "UGC Video From Your Site" (`ugc-website-video`): a website's screenshots.
 * - The product-in-hand template (`ugc-product-in-hand`): a product photo the creator may hold up,
 *   and up to three close-ups as cards.
 * - The app-demo template (`ugc-app-demo`): an app's phone screenshots.
 *
 * All three share one graph. Each template runs the `steal-the-format.test.ts` checks — every node
 * type registered in NODE_HANDLES, every edge on a real handle, the gallery copy through the
 * Publish as template form — plus the rules the templates exist to keep:
 * - it is content-free: no node holds a model id, a prompt, a result or a kept result, and it
 *   carries no run state. The only filled values are the example inputs, on input nodes: the
 *   product text and pictures at our CDN's example prefix, by address alone (no asset id);
 * - the fan-out and fan-in wires: one UGC Clip run per clip ticket, the joined video and the
 *   clips' notes from all of them;
 * - the join's three settings are the plugin's own join call's;
 * - the app's inputs: the price line, the product, the pictures, the length, the creator and the
 *   creator's look, the Person card restricted to adults;
 * - the finish nodes sit in the video's chain, so a newer run of the video replaces them on
 *   reopen and the server prices them as part of the video;
 * - a creator set to "My photo" in the app takes the runner's photo;
 * - six sticky notes explain the stages, outside the video's chain.
 * The frontend twin (frontend/src/lib/__tests__/ugc-templates-connections.test.ts) proves every
 * edge is a connection the canvas accepts.
 */
import { describe, it, expect } from "vitest"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  MODEL_CATALOG,
  TEMPLATE_CATEGORIES,
  UGC_NODE_TYPES,
  defaultEdgeOutputMode,
  findRestrictedPickerValue,
  findUgcLockedFields,
  stripUgcRunState,
  type PresentationItem,
} from "@nodaro/shared"
import { ADULT_AGE_IDS, BODY_CAPTIONS_PRESET_ID, MINOR_IMPLYING_TYPE_IDS, PICKER_CATALOGS, getFactoryPresets } from "@nodaro/prompts"
import { stripUgcPublishState, ugcChainInput, ugcChains } from "@nodaro/render-rules"
import { NODE_HANDLES } from "../../mcp/generated/node-handles.js"
import { CLOUD_ONLY_NODE_TYPES } from "../../cloud-only-nodes.js"
import { publishBodySchema } from "../../template-publish-schema.js"
import { ugcAppRunMissesPhoto } from "../../ugc-app-run.js"
import { extractAppInputSchema } from "../../mcp/extract-app-inputs.js"
import { CreditsService } from "../../../ee/billing/credits.js"
import type { TutorialTemplateDoc } from "../types.js"

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * The two prices each template states, each the estimate's expected figure rounded up to the
 * hundred: the gallery card's `estimatedCredits` is an editor run's (every creator option drawn)
 * and the app's price line an app run's (the primary option alone). Neither is derived from the
 * other. The UGC estimate plans the video with the private plugin, so no test here can compute
 * them: they are re-derived from the live estimate at the release's estimate check (editor =
 * rendersEveryCandidate true, app = without), and a mismatch updates the figure here, and for the
 * app the price line, before release. The estimate form has no product photo, so the three
 * templates' 15-second figures are one.
 */
const FIGURES = { editor: 2900, app: 2900 } as const

/** Where the example inputs live: a template-owned prefix of our CDN, never a user's media. */
const EXAMPLES_CDN = "https://cdn.nodaro.ai/templates/examples"

const SHOTS8 = ["shot1", "shot2", "shot3", "shot4", "shot5", "shot6", "shot7", "shot8"] as const
const NOTE_IDS = ["note-overview", "note-product", "note-script", "note-clips", "note-finish", "note-example"] as const

interface Spec {
  readonly file: string
  readonly slug: string
  readonly sortOrder: number
  /** The screenshot or close-up uploads wired into UGC Script, in slot order. */
  readonly shots: readonly string[]
  /** The upload nodes holding an example picture. */
  readonly examples: readonly string[]
  /** The product photo is one of the app's inputs (it is always wired into UGC Script). */
  readonly exposesProduct: boolean
  /** The gallery copy this file's test pins (the rest is pinned by the publish form only). */
  readonly copy?: { readonly name: string; readonly description: string; readonly tags: readonly string[] }
}

const SPECS: readonly Spec[] = [
  {
    file: "ugc-website-video.json",
    slug: "ugc-website-video",
    sortOrder: 46,
    shots: SHOTS8,
    examples: ["shot1", "shot2", "shot3", "shot4"],
    exposesProduct: false,
    copy: {
      name: "UGC Video From Your Site",
      description: "A creator talks to camera about your product while your site's screenshots pop up as cards, with captions. Upload 3 to 8 screenshots, pick the length and the creator, and run.",
      tags: ["ugc", "marketing", "talking head", "captions"],
    },
  },
  {
    file: "ugc-product-in-hand.json",
    slug: "ugc-product-in-hand",
    sortOrder: 47,
    shots: ["shot1", "shot2", "shot3"],
    examples: ["product", "shot1", "shot2", "shot3"],
    exposesProduct: true,
  },
  {
    file: "ugc-app-demo.json",
    slug: "ugc-app-demo",
    sortOrder: 48,
    shots: SHOTS8,
    examples: ["shot1", "shot2", "shot3", "shot4"],
    exposesProduct: false,
  },
]

type Node = { id: string; type: string; position?: { x: number; y: number }; data: Record<string, unknown> }
type Edge = { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null; data?: Record<string, unknown> }
type Settings = {
  viewport?: unknown
  flowPromptTemplates?: unknown
  characterDefinitions?: unknown
  presentationSettings: {
    runTarget: string
    inputItems: PresentationItem[]
    cardMeta: Record<string, { title?: string; description?: string; pickerAllowedValuesByField?: Record<string, string[]> }>
    outputOrder: string[]
  }
}

async function load(file: string): Promise<{ doc: TutorialTemplateDoc; nodes: Node[]; edges: Edge[]; settings: Settings }> {
  const doc = JSON.parse(await readFile(join(HERE, "..", "templates", file), "utf8")) as TutorialTemplateDoc
  return { doc, nodes: doc.nodes as Node[], edges: doc.edges as Edge[], settings: doc.settings as unknown as Settings }
}

function byId(nodes: Node[], id: string): Node {
  const found = nodes.find((n) => n.id === id)
  expect(found, `node ${id}`).toBeDefined()
  return found!
}

function edgeOf(edges: Edge[], source: string, sourceHandle: string, target: string, targetHandle: string): Edge {
  const found = edges.filter((e) => e.source === source && e.sourceHandle === sourceHandle && e.target === target && e.targetHandle === targetHandle)
  expect(found, `edge ${source}.${sourceHandle} → ${target}.${targetHandle}`).toHaveLength(1)
  return found[0]!
}

describe("the UGC templates", () => {
  it("are distinct templates, each in its own place in the tutorial list", async () => {
    const docs = await Promise.all(SPECS.map(async (s) => (await load(s.file)).doc))
    expect(new Set(docs.map((d) => d.slug)).size).toBe(SPECS.length)
    expect(new Set(docs.map((d) => d.name)).size).toBe(SPECS.length)
    expect(new Set(docs.map((d) => d.tutorialSortOrder)).size).toBe(SPECS.length)
  })
})

describe.each(SPECS)("$slug template", (spec) => {
  const get = () => load(spec.file)

  it("declares the card metadata", async () => {
    const { doc } = await get()
    expect(doc.slug).toBe(spec.slug)
    expect(TEMPLATE_CATEGORIES).toContain(doc.category)
    expect(doc.category).toBe("video-ads")
    expect(doc.tutorialCategorySlug).toBe("workflows")
    expect(doc.tutorialSortOrder).toBe(spec.sortOrder)
    expect(doc.outputTypes).toEqual(["video"])
    expect(doc.complexity).toBe("advanced")
    // The clip and image models are the builders' choice: the template names none.
    expect(doc.providersUsed).toEqual([])
    expect(doc.markdownDescription).toBeTruthy()
    expect(doc.estimatedCredits).toBe(FIGURES.editor)
    // The preview is the example run's captioned video, picked when the template is published.
    expect(doc.previewMediaUrl ?? null).toBeNull()
    if (spec.copy) {
      expect(doc.name).toBe(spec.copy.name)
      expect(doc.description).toBe(spec.copy.description)
      expect(doc.tags).toEqual(spec.copy.tags)
    }
  })

  it("carries gallery copy that fits the Publish as template form", async () => {
    const { doc } = await get()
    const form = publishBodySchema.safeParse({
      workflowId: "00000000-0000-4000-8000-000000000000",
      name: doc.name,
      description: doc.description,
      markdownDescription: doc.markdownDescription,
      category: doc.category,
      outputTypes: doc.outputTypes,
      tags: doc.tags,
    })
    expect(form.success, JSON.stringify(form.error?.issues)).toBe(true)
  })

  it("is listed nowhere: listing it is a distribution choice", async () => {
    const { doc } = await get()
    expect(doc.listedIn).toBeUndefined()
  })

  it("names every node type it uses, and each one is registered", async () => {
    const { doc, nodes } = await get()
    for (const node of nodes) {
      expect(node.id, `node ${JSON.stringify(node.id)} has an id`).toBeTruthy()
      expect(NODE_HANDLES[node.type], `node type "${node.type}" (${node.id}) is registered`).toBeDefined()
    }
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length)
    expect(new Set(doc.nodeTypesUsed)).toEqual(new Set(nodes.map((n) => n.type)))
    expect(doc.nodeTypesUsed).toHaveLength(new Set(doc.nodeTypesUsed).size)
    // Every UGC node is in it, once.
    for (const t of UGC_NODE_TYPES) expect(nodes.filter((n) => n.type === t), t).toHaveLength(1)
  })

  it("wires every edge to a real handle on a real node, under an id of its own", async () => {
    const { nodes, edges } = await get()
    const ids = new Map(nodes.map((n) => [n.id, n]))
    expect(new Set(edges.map((e) => e.id)).size).toBe(edges.length)
    for (const edge of edges) {
      const src = ids.get(edge.source)
      const tgt = ids.get(edge.target)
      expect(src, `edge ${edge.id} source "${edge.source}" exists`).toBeDefined()
      expect(tgt, `edge ${edge.id} target "${edge.target}" exists`).toBeDefined()
      expect(NODE_HANDLES[src!.type]!.outputs, `edge ${edge.id}: output of ${src!.type}`).toContain(edge.sourceHandle)
      expect(NODE_HANDLES[tgt!.type]!.inputs, `edge ${edge.id}: input of ${tgt!.type}`).toContain(edge.targetHandle)
      expect(edge.id).toBe(`e-${edge.source}-${edge.target}-${edge.targetHandle}`)
    }
  })

  it("runs on Cloud only — the seeder keeps it off editions without these nodes", async () => {
    const { nodes } = await get()
    for (const t of UGC_NODE_TYPES) expect(CLOUD_ONLY_NODE_TYPES.has(t), t).toBe(true)
    expect(nodes.some((n) => CLOUD_ONLY_NODE_TYPES.has(n.type))).toBe(true)
  })

  it("holds no content: no model id, prompt, result or kept result in any node", async () => {
    const { nodes } = await get()
    const modelIds = new Set(Object.keys(MODEL_CATALOG))
    expect(modelIds.size).toBeGreaterThan(20)
    const FILLED_IS_CONTENT = ["prompt", "systemPrompt", "userInput", "generatedResults", "result", "generatedJson", "ugcOutputs", "generatedImageUrl", "generatedVideoUrl", "exampleLines"]
    const filled = (v: unknown) =>
      v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0) && !(typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0)
    const walk = (where: string, value: unknown): void => {
      if (typeof value === "string") expect(modelIds.has(value), `${where} holds a catalog model id: ${value}`).toBe(false)
      else if (Array.isArray(value)) value.forEach((v, i) => walk(`${where}[${i}]`, v))
      else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(`${where}.${k}`, v)
    }
    for (const node of nodes) {
      walk(node.id, node.data)
      for (const key of FILLED_IS_CONTENT) expect(filled(node.data[key]), `${node.id}.${key}`).toBe(false)
      expect(node.data.keepResult, `${node.id}.keepResult`).not.toBe(true)
      // No voice is chosen for the clips: the plugin's own default speaks.
      expect(node.data.voiceId, `${node.id}.voiceId`).toBeUndefined()
    }
  })

  it("its only filled values are the example inputs: the product text and pictures, at our example prefix, by address alone", async () => {
    const { nodes } = await get()
    const MEDIA = ["url", "r2Url", "thumbnailUrl", "assetId", "filename", "mimeType", "fileSize", "metadata"]
    for (const node of nodes) {
      const media = MEDIA.filter((k) => node.data[k] !== undefined)
      if (!spec.examples.includes(node.id)) {
        expect(media, `${node.id} holds no media`).toEqual([])
        continue
      }
      expect(node.type, node.id).toBe("upload-image")
      // An asset id would point a cloner's run at another account's asset: address only.
      expect(node.data.assetId, `${node.id}.assetId`).toBeUndefined()
      const url = node.data.url as string
      expect(url.startsWith(`${EXAMPLES_CDN}/${spec.slug}/`), `${node.id}.url ${url}`).toBe(true)
      expect(node.data.r2Url).toBe(url)
      expect(node.data.thumbnailUrl).toBe(url)
      expect(node.data.mimeType).toBe("image/png")
    }
    // The product text is filled; "Your photo" — the runner's own face — never is.
    expect(byId(nodes, "site").data.text).toBeTruthy()
    expect(Object.keys(byId(nodes, "photo").data).sort()).toEqual(["fieldMappings", "label"])
  })

  it("carries no run state: the publish strip finds nothing to remove", async () => {
    const { nodes, edges } = await get()
    expect(stripUgcRunState(nodes)).toEqual(nodes)
    // What publishing ships (the video's join, overlay and captions included): the template as it is.
    expect(stripUgcPublishState(nodes, edges)).toEqual(nodes)
  })

  it("six sticky notes explain the stages, outside the video's chain and wired to nothing", async () => {
    const { nodes, edges } = await get()
    const notes = nodes.filter((n) => n.type === "sticky-note")
    expect(notes.map((n) => n.id)).toEqual([...NOTE_IDS])
    for (const note of notes) {
      expect(note.data, note.id).toMatchObject({ color: "#1d2430", textColor: "#ffffff", fontSize: "xl" })
      for (const key of ["title", "text"]) expect(note.data[key], `${note.id}.${key}`).toBeTruthy()
      expect(edges.some((e) => e.source === note.id || e.target === note.id), note.id).toBe(false)
    }
    const inChain = new Set(ugcChains(nodes, edges).flatMap((c) => c.members.map((m) => m.id)))
    for (const id of NOTE_IDS) expect(inChain.has(id), id).toBe(false)
    // No two notes overlap on the canvas.
    const box = (n: Node) => ({ x: n.position!.x, y: n.position!.y, w: n.data.width as number, h: n.data.height as number })
    for (const [i, a] of notes.entries()) {
      for (const b of notes.slice(i + 1)) {
        const p = box(a)
        const q = box(b)
        const apart = p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y
        expect(apart, `${a.id} overlaps ${b.id}`).toBe(true)
      }
    }
  })

  it("the inputs reach UGC Script and UGC Creator on their own handles", async () => {
    const { nodes, edges } = await get()
    edgeOf(edges, "site", "prompt", "script", "site")
    spec.shots.forEach((shot, i) => edgeOf(edges, shot, "image", "script", i === 0 ? "screenshot" : `screenshot${i + 1}`))
    expect(edges.filter((e) => e.target === "script" && e.targetHandle?.startsWith("screenshot"))).toHaveLength(spec.shots.length)
    edgeOf(edges, "product", "image", "script", "product")
    edgeOf(edges, "script", "category", "creator", "category")
    edgeOf(edges, "photo", "image", "creator", "photo")
    for (const picker of ["person", "styling", "setting", "lighting"]) edgeOf(edges, picker, "out", "creator", "pickers")
    expect(byId(nodes, "script").data).toMatchObject({ targetDurationSec: 15, keepResult: false })
    expect(byId(nodes, "creator").data).toMatchObject({ source: "sampled", gender: "woman", keepResult: false })
  })

  it("one UGC Clip run per clip ticket; the join and the clips' notes take all of them", async () => {
    const { edges } = await get()
    edgeOf(edges, "script", "plan", "clips", "plan")
    edgeOf(edges, "creator", "creator", "clips", "creator")
    const tickets = edgeOf(edges, "clips", "clips", "clip", "clip")
    expect(tickets.data?.outputMode).toBeUndefined()
    expect(defaultEdgeOutputMode("ugc-clips", "clips")).toBe("each")
    for (const handle of ["plan-out", "transcript"] as const) {
      const wire = edgeOf(edges, "clips", handle, "cards", handle === "plan-out" ? "plan" : "transcript")
      expect(wire.data?.outputMode, handle).toBeUndefined()
      expect(defaultEdgeOutputMode("ugc-clips", handle), handle).toBe("last")
    }
    // Every clip into UGC Finish at once, with UGC Clips' sized script; the finished clips, in order, into the join.
    expect(edgeOf(edges, "clip", "video-out", "finish", "clips").data).toEqual({ outputMode: "all" })
    expect(edgeOf(edges, "clips", "plan-out", "finish", "plan").data).toBeUndefined()
    expect(edgeOf(edges, "finish", "video-out", "join", "in").data).toEqual({ outputMode: "all" })
    expect(edges.some((e) => e.source === "clip" && e.target === "join")).toBe(false)
    expect(edgeOf(edges, "clip", "video-out", "cards", "notes").data).toEqual({ outputMode: "all" })
    edgeOf(edges, "join", "video", "cards", "video")
    edgeOf(edges, "join", "video", "overlay", "video")
    edgeOf(edges, "cards", "layerPlan", "overlay", "layerPlan")
    edgeOf(edges, "cards", "captionPlan", "captions", "captionPlan")
    edgeOf(edges, "overlay", "video-out", "captions", "in")
  })

  it("joins the clips as the plugin's own join call does", async () => {
    // Two-sided pin. The plugin's clip calls build the join as `combine_videos` with
    // { transition: "cut", audio_mode: "keep", smart_cut: false } (clip-calls.ts,
    // "const join: ToolCall | null"); the plugin's contract test pins that side.
    const { nodes } = await get()
    const join = byId(nodes, "join")
    expect(join.type).toBe("combine-videos")
    expect({ transition: join.data.transition, audioMode: join.data.audioMode, smartCutEnabled: join.data.smartCutEnabled }).toEqual({
      transition: "cut",
      audioMode: "keep",
      smartCutEnabled: false,
    })
    // The trims are pinned at the combiner's own defaults (start 1, end 2): a video cut from one recorded speech
    // plans its cut for exactly these, so a changed default can never move a cut onto a word.
    expect({ start: join.data.trimStartFrames, end: join.data.trimEndFrames }).toEqual({ start: 1, end: 2 })
  })

  it("the picture cards draw only the cards' layer plan", async () => {
    const { nodes, edges } = await get()
    const overlay = byId(nodes, "overlay")
    expect(overlay.data).toMatchObject({ layers: [], layerCount: 4 })
    expect(edges.filter((e) => e.target === "overlay").map((e) => e.targetHandle).sort()).toEqual(["layerPlan", "video"])
  })

  it("the creator's look pickers hold no pick: empty is a creator the builder draws", async () => {
    const { nodes } = await get()
    for (const id of ["person", "styling", "setting", "lighting"]) {
      const picker = byId(nodes, id)
      expect(picker.type).toBe(id)
      expect(picker.data).toEqual({ label: picker.data.label, fieldMappings: {} })
    }
  })

  it("captions in the Body Captions style", async () => {
    const { nodes } = await get()
    const preset = getFactoryPresets("add-captions").find((p) => p.id === BODY_CAPTIONS_PRESET_ID)
    expect(preset, BODY_CAPTIONS_PRESET_ID).toBeDefined()
    const captions = byId(nodes, "captions")
    expect(captions.type).toBe("add-captions")
    expect(captions.data).toMatchObject(preset!.data as Record<string, unknown>)
    expect(captions.data.presentationOutput).toBe(true)
  })

  it("the app's Person card admits adults only", async () => {
    const { nodes, settings } = await get()
    const person = PICKER_CATALOGS.find((c) => c.nodeType === "person")!
    const types = person.dimensions!.find((d) => d.field === "type")!.options.map((o) => o.id)
    const minors = new Set<string>(MINOR_IMPLYING_TYPE_IDS)
    const restricted = settings.presentationSettings.cardMeta.person!.pickerAllowedValuesByField!
    expect(restricted.age).toEqual([...ADULT_AGE_IDS])
    expect(restricted.type).toEqual(types.filter((id) => !minors.has(id)))
    expect(Object.keys(restricted).sort()).toEqual(["age", "type"])
    // The app runner refuses a minor on any run, the API's included.
    const run = (values: Record<string, unknown>) =>
      findRestrictedPickerValue({ cardMeta: settings.presentationSettings.cardMeta, nodes, inputValues: { person: values } })
    expect(run({ age: "age-30s", type: types.find((id) => !minors.has(id)) })).toBeNull()
    expect(run({ age: "age-teen" })).not.toBeNull()
    expect(run({ type: [...minors][0] })).not.toBeNull()
  })

  it("the app's inputs: the price line, the product, the pictures, the length, the creator and its look", async () => {
    const { settings } = await get()
    const pres = settings.presentationSettings
    expect(pres.runTarget).toBe("workflow")
    const [price, site, ...rest] = pres.inputItems
    expect(price).toMatchObject({ type: "richtext", id: "r-price" })
    // The app's price line states an app run's figure (the primary option alone).
    expect((price as { content: string }).content).toContain(FIGURES.app.toLocaleString("en-US"))
    // At most 300 characters: what UGC Script takes for the product name or website.
    expect(site).toEqual({ type: "node", nodeId: "site", maxLength: 300 })
    const shots = rest.find((i) => i.type === "group" && i.id === "g-shots") as Extract<PresentationItem, { type: "group" }>
    expect(shots.title).toBeTruthy()
    expect(rest).toEqual([
      ...(spec.exposesProduct ? [{ type: "node", nodeId: "product" }] : []),
      { type: "group", id: "g-shots", title: shots.title, showTitle: true, items: spec.shots.map((nodeId) => ({ type: "node", nodeId })) },
      { type: "field", id: "f-length", nodeId: "script", field: "targetDurationSec", allowedValues: [15, 20, 25] },
      { type: "field", id: "f-language", nodeId: "script", field: "language", allowedValues: ["en", "he"] },
      { type: "node", nodeId: "creator" },
      { type: "group", id: "g-look", title: "Creator look (optional)", showTitle: true, items: [{ type: "node", nodeId: "setting" }, { type: "node", nodeId: "person" }] },
    ])
    // A field item's card is keyed by the item's id; a node's by the node's.
    expect(pres.cardMeta["f-length"]).toEqual({ title: "Video length" })
    expect(pres.cardMeta.creator).toEqual({ title: "Creator" })
    expect(Object.keys(pres.cardMeta).sort()).toEqual(["creator", "f-language", "f-length", "person", ...(spec.exposesProduct ? ["product"] : []), "site"].sort())
    for (const id of ["site", ...(spec.exposesProduct ? ["product"] : [])]) {
      expect(pres.cardMeta[id]!.title, `${id} title`).toBeTruthy()
      expect(pres.cardMeta[id]!.description, `${id} description`).toBeTruthy()
    }
    expect(pres.outputOrder).toEqual(["captions", "cards"])
  })

  it("the app's inputs as the API and MCP read them", async () => {
    const { doc, nodes } = await get()
    const { fields, keyMap } = extractAppInputSchema({ snapshotSettings: doc.settings, snapshotNodes: stripUgcRunState(nodes) })
    const read = fields.map((f) => {
      const to = keyMap[f.key]!
      return [`${to.nodeId}.${to.fieldKey}`, f.type, f.options ?? f.maxLength ?? null]
    })
    expect(read).toEqual([
      ["site.text", "text", 300],
      ...(spec.exposesProduct ? [["product.url", "image", null]] : []),
      ...spec.shots.map((id) => [`${id}.url`, "image", null]),
      ["script.targetDurationSec", "select", [15, 20, 25]],
      ["script.language", "select", ["en", "he"]],
      ["creator.source", "select", ["sampled", "photo"]],
      ["creator.gender", "select", ["woman", "man"]],
      ["creator.photoUrl", "image", null],
      ["setting.setting", "select", null],
      // The Person card's API field is its first dimension; the app runner restricts it too.
      ["person.type", "select", null],
    ])
  })

  it("the app's outputs are the captioned video and the Notes", async () => {
    const { nodes } = await get()
    expect(nodes.filter((n) => n.data.presentationOutput === true).map((n) => n.id).sort()).toEqual(["captions", "cards"])
  })

  it("an app run's length, creator and photo are the only UGC values a runner sets", async () => {
    const { nodes } = await get()
    expect(findUgcLockedFields(nodes, { script: { targetDurationSec: 20 }, creator: { source: "photo", gender: "man", photoUrl: "https://example.com/me.png" } })).toEqual([])
  })

  it("a creator set to My photo in the app takes the runner's photo; the template itself draws one", async () => {
    const { nodes, edges } = await get()
    // As published: the author's own photo is stripped, the creator is drawn.
    const published = stripUgcPublishState(nodes, edges)
    expect(ugcAppRunMissesPhoto(published, edges, undefined)).toBe(false)
    // The runner switches the Creator card to My photo: the run needs the photo the card takes.
    expect(ugcAppRunMissesPhoto(published, edges, { creator: { source: "photo" } })).toBe(true)
    expect(ugcAppRunMissesPhoto(published, edges, { creator: { source: "photo", photoUrl: "https://example.com/me.png" } })).toBe(false)
  })

  it("the author's photo in the template's own photo upload never ships, and a My photo run needs the runner's own", async () => {
    const { nodes, edges } = await get()
    const AUTHOR = "https://cdn.example/author-face.png"
    // The author put their photo in "Your photo", set the creator to My photo and ran the video.
    const ran = nodes.map((n) =>
      n.id === "photo"
        ? { ...n, data: { ...n.data, assetId: "asset-author", url: AUTHOR, r2Url: AUTHOR, thumbnailUrl: `${AUTHOR}.jpg`, filename: "author.png", generatedResults: [{ url: AUTHOR, jobId: "upload-1", timestamp: "t" }], activeResultIndex: 0 } }
        : n.id === "creator"
          ? { ...n, data: { ...n.data, source: "photo", keepResult: true, generatedImageUrl: AUTHOR, ugcOutputs: { creator: '{"v":1}', image: AUTHOR }, result: { v: 1, identityImages: [AUTHOR] } } }
          : n.id === "captions"
            ? { ...n, data: { ...n.data, generatedVideoUrl: "https://cdn.example/captioned.mp4", generatedResults: [{ url: "https://cdn.example/captioned.mp4", jobId: "j", timestamp: "t" }], activeResultIndex: 0 } }
            : n,
    )
    edgeOf(edges, "photo", "image", "creator", "photo")
    const published = stripUgcPublishState(ran, edges)
    expect(JSON.stringify(published)).not.toContain(AUTHOR)
    expect(JSON.stringify(published)).not.toContain("captioned.mp4")
    // The example inputs are not the author's photo: they ship as they are.
    for (const id of spec.examples) expect(byId(published as Node[], id).data).toEqual(byId(nodes, id).data)
    // "Your photo" ships as a fresh upload: its label and settings only.
    const { label, fieldMappings } = byId(nodes, "photo").data
    expect(byId(published as Node[], "photo").data).toEqual({ label, fieldMappings })
    // A runner who gives no photo of their own is refused; their photo, on the Creator card or the upload, runs.
    expect(ugcAppRunMissesPhoto(published, edges, undefined)).toBe(true)
    expect(ugcAppRunMissesPhoto(published, edges, { creator: { photoUrl: "https://example.com/me.png" } })).toBe(false)
    expect(ugcAppRunMissesPhoto(published, edges, { photo: { url: "https://example.com/me.png" } })).toBe(false)
  })

  it("is one UGC video whose finish nodes sit in its chain: a newer run replaces them, the server prices them with it", async () => {
    const { nodes, edges } = await get()
    const chains = ugcChains(nodes, edges)
    expect(chains).toHaveLength(1)
    const [video] = chains
    expect(video).toMatchObject({ clipsId: "clips", scriptId: "script", creatorId: "creator" })
    expect(Object.fromEntries(video!.members.map((m) => [m.id, m.part]))).toEqual({
      script: "script",
      creator: "creator",
      clips: null,
      clip: "clip",
      finish: null,
      cards: "cards",
      join: "join",
      overlay: "overlay",
      captions: "captions",
    })
  })

  it("its whole price is the video's: every node outside the chain is free", async () => {
    const { nodes, edges } = await get()
    const inChain = new Set(ugcChains(nodes, edges)[0]!.members.map((m) => m.id))
    const rest = nodes.filter((n) => !inChain.has(n.id))
    const restEdges = edges.filter((e) => !inChain.has(e.source) && !inChain.has(e.target))
    const listing = CreditsService.estimateWorkflowBaseListing(rest, restEdges, "template")
    expect(listing.preview + listing.final + listing.previewPerMinute + listing.finalPerMinute).toBe(0)
  })

  it("the estimate reads the graph as built as a 15-second video by a drawn creator, and the example inputs as the example run", async () => {
    const { nodes, edges } = await get()
    const video = ugcChains(nodes, edges)[0]!
    // The graph as built (publish, the API's estimate): every wired picture slot.
    expect(ugcChainInput(video, nodes, edges).input).toEqual({ targetDurationSec: 15, screenshotCount: spec.shots.length, source: "sampled" })
    // A run of the template as it stands: the slots holding an example picture (the example run's
    // quote form). The product photo is no card slot.
    const exampleShots = spec.examples.filter((id) => spec.shots.includes(id)).length
    expect(ugcChainInput(video, nodes, edges, { overrides: {} }).input).toEqual({ targetDurationSec: 15, screenshotCount: exampleShots, source: "sampled" })
    // An app run with three pictures: the slots that hold an image.
    const three = Object.fromEntries(spec.shots.map((id, i) => [id, { url: i < 3 ? `https://example.com/${id}.png` : "" }]))
    expect(ugcChainInput(video, nodes, edges, { overrides: three }).input).toEqual({ targetDurationSec: 15, screenshotCount: 3, source: "sampled" })
  })
})
