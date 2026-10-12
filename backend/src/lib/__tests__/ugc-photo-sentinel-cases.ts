/**
 * The guard cases of the photo influence set (`ugcPhotoInfluence`, @nodaro/render-rules): workflows,
 * with the sub-workflow graphs they reference, in which every value that can flow into a UGC
 * Creator's photo input holds the sentinel `KILL`, and every other value — a control — holds `KEEP`.
 *
 * Every surface that hands a workflow to anyone but its author reads these cases:
 * (a) no `KILL` reaches its output — an app's, a component's or a template's snapshot, a
 *     re-publish, a share link's view, a public read and copy, the graphs a run of a published app
 *     or a share-link viewer executes;
 * (b) a run of each by anyone but the author, with nothing of the runner's own, is refused, and no
 *     creator's request body in a run carries `KILL`;
 * (c) every `KEEP` survives: nothing outside the set is emptied.
 *
 * `runnerGives` is a run's input that gives the runner's own photo to every My photo creator the
 * run reaches. The URLs and text are placeholders.
 */

export const KILL = "KILL"
export const KEEP = "KEEP"
export const RUNNERS_PHOTO = "https://cdn.example/runner-own.png"

type Data = Record<string, unknown>
export interface CaseNode {
  readonly id: string
  readonly type: string
  readonly position: { readonly x: number; readonly y: number }
  readonly data: Data
}
export interface CaseEdge {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly sourceHandle: string | null
  readonly targetHandle: string
}
export interface CaseGraph {
  readonly nodes: CaseNode[]
  readonly edges: CaseEdge[]
}
export interface SentinelCase {
  readonly name: string
  /** The workflow itself. */
  readonly graph: CaseGraph
  /** The author's own workflows it references, by id. */
  readonly workflows: Readonly<Record<string, CaseGraph>>
  /** The workflow's settings: the inputs an app or a share link shows. */
  readonly settings: Data
  /** A run's input giving the runner's own photo to every My photo creator the run reaches; none for a control. */
  readonly runnerGives?: Readonly<Record<string, Data>>
  /**
   * The node the author picks as the thumbnail. The pick is theirs: it ships as the preview exactly
   * as they chose it, whatever it holds; the snapshot itself still holds none of it.
   */
  readonly thumbnailNodeId?: string
  /** A component's input handles: node ids of the graph. */
  readonly componentInputs?: readonly string[]
  /** A component's exposed settings, each with its default as the editor copies it from the node. */
  readonly exposed?: ReadonlyArray<{ readonly nodeId: string; readonly field: string; readonly type: "text" | "select" | "number"; readonly defaultValue: unknown }>
  /** Published components the graph's component nodes run, by slug: their snapshot and its creator. */
  readonly components?: Readonly<Record<string, { readonly graph: CaseGraph; readonly creatorId: string }>>
}

type Mark = typeof KILL | typeof KEEP
const link = (mark: Mark, slot: string) => `https://cdn.example/${mark}-${slot}.png`
const node = (id: string, type: string, data: Data = {}): CaseNode => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } })
const wire = (source: string, target: string, targetHandle: string, sourceHandle: string | null = null): CaseEdge => ({
  id: `${source}>${target}:${targetHandle}`,
  source,
  target,
  sourceHandle,
  targetHandle,
})

/** An Upload Image as the editor stores one: every slot its file is held in. */
const upload = (id: string, mark: Mark): CaseNode =>
  node(id, "upload-image", {
    url: link(mark, id), r2Url: link(mark, id), externalUrl: link(mark, `${id}-external`), thumbnailUrl: link(mark, `${id}-thumb`),
    assetId: `${mark}-asset-${id}`, filename: `${mark}-${id}.png`, mimeType: "image/png", fileSize: 1234,
    metadata: { width: 800, height: 800, sourceUrl: link(mark, `${id}-source`) },
    generatedResults: [{ url: link(mark, id), jobId: `${mark}-job-${id}`, timestamp: "t" }], activeResultIndex: 0,
  })
const text = (id: string, mark: Mark, words = `${mark} words of ${id}`): CaseNode => node(id, "text-prompt", { text: words })
const list = (id: string, mark: Mark): CaseNode =>
  node(id, "list", { items: [`${mark}-item-${id}`, link(mark, `${id}-item`)], rows: [[link(mark, `${id}-row`)]], columns: [{ id: "photo", name: "Photo", handleId: "col_photo", type: "image" }] })
/**
 * A library entity on the canvas after the author's run: the pointer to its row, the author's trained
 * LoRA, its pictures — everything a run would put the author's likeness back with — and its name.
 */
const entity = (id: string, kind: "character" | "object" | "creature" | "location"): CaseNode =>
  node(id, kind, {
    [`${kind}DbId`]: `${KILL}-${kind}-row`, [`${kind}Name`]: `${KEEP} ${kind} name`,
    loraReplicateVersion: `${KILL}-lora-version`, loraTriggerWord: `${KILL}-trigger`, loraTrainingStatus: `${KILL}-trained`,
    sourceImageUrl: link(KILL, `${id}-source`), defaultAssetUrl: link(KILL, `${id}-default`), expressions: [{ name: "smile", url: link(KILL, `${id}-smile`) }],
  })
/** A UGC video's take after the author's run. */
const take = (id = "clip") => node(id, "ugc-clip", { generatedVideoUrl: link(KILL, `${id}-take`), generatedResults: [{ url: link(KILL, `${id}-take`), jobId: "j", timestamp: "t" }], ugcOutputs: { "video-out": link(KILL, `${id}-out`) } })
/** A step that made something in a run: its results, and an address under keys no rule names. */
const step = (id: string, type: string, mark: Mark, data: Data = {}): CaseNode =>
  node(id, type, {
    generatedImageUrl: link(mark, id), generatedResults: [{ url: link(mark, id), jobId: `${mark}-job-${id}`, timestamp: "t" }], activeResultIndex: 0,
    futureImage: link(mark, `${id}-future`), nested: { deep: [{ picture: link(mark, `${id}-deep`) }] },
    // A key no node type declares, holding no address: only an allowlist takes it off.
    privateNote: `${mark} private note of ${id}`, ...data,
  })
const send = (id: string, channel: string, mark: Mark) => node(id, "teleport-send", { channel, result: link(mark, id) })
const receive = (id: string, channel: string, mark: Mark) => node(id, "teleport-receive", { channel, result: link(mark, id) })
/** A UGC Creator set to My photo after the author's own run: their photo and its image everywhere it keeps them. */
const creator = (id = "creator"): CaseNode =>
  node(id, "ugc-creator", {
    source: "photo", gender: "woman", photoUrl: link(KILL, `${id}-photo`), keepResult: true, generatedImageUrl: link(KILL, `${id}-image`),
    ugcOutputs: { creator: "{}", image: link(KILL, `${id}-out`) }, result: { v: 1, identityImages: [link(KILL, `${id}-identity`)] },
  })
/** A sub-workflow node: by the reference a run reads, or the one the editor writes (with the editor's route snapshot). */
const sub = (id: string, ref: string, shape: "run" | "editor" = "run", data: Data = {}): CaseNode =>
  node(id, "sub-workflow", {
    ...(shape === "run"
      ? { workflowId: ref }
      : { referencedWorkflowId: ref, selectedRouteId: "default", routeSnapshot: { inputPorts: [{ id: "i1", mediaType: "image" }], outputPorts: [{ id: "p1", mediaType: "image" }] } }),
    ...data,
  })
const input = (data: Data = {}) => node("in", "sub-workflow-input", { ports: [{ id: "i1", mediaType: "image" }], ...data })
const output = () => node("out", "sub-workflow-output", { ports: [{ id: "p1", mediaType: "image" }] })

/**
 * The controls every case holds: a site and a screenshot the script reads, and a render outside the
 * video. None of them can flow into a creator's photo.
 */
function withControls(graph: CaseGraph, creatorId: string | null): CaseGraph {
  return {
    nodes: [
      ...graph.nodes,
      text("site", KEEP, `${KEEP} site words`),
      upload("shot", KEEP),
      node("script", "ugc-script", { targetDurationSec: 15 }),
      step("lone", "generate-image", KEEP, { prompt: `${KEEP} lone prompt` }),
    ],
    edges: [
      ...graph.edges,
      wire("site", "script", "site", "prompt"),
      wire("shot", "script", "screenshot", "image"),
      ...(creatorId ? [wire("script", creatorId, "category", "category")] : []),
    ],
  }
}

const photoCase = (
  name: string,
  nodes: CaseNode[],
  edges: CaseEdge[],
  runnerGives: Record<string, Data>,
  more: Partial<Pick<SentinelCase, "workflows" | "settings" | "thumbnailNodeId" | "componentInputs" | "exposed" | "components">> & { creatorId?: string | null } = {},
): SentinelCase => ({
  name,
  graph: withControls({ nodes, edges }, more.creatorId === undefined ? "creator" : more.creatorId),
  workflows: more.workflows ?? {},
  settings: more.settings ?? {},
  runnerGives,
  ...(more.thumbnailNodeId ? { thumbnailNodeId: more.thumbnailNodeId } : {}),
  ...(more.componentInputs ? { componentInputs: more.componentInputs } : {}),
  ...(more.exposed ? { exposed: more.exposed } : {}),
  ...(more.components ? { components: more.components } : {}),
})
const shows = (...ids: string[]) => ({ presentationSettings: { inputItems: ids.map((nodeId) => ({ type: "node", nodeId })) } })
const toPhoto = (from: string, sourceHandle: string | null = "image", to = "creator") => wire(from, to, "photo", sourceHandle)
const runnersUpload = (id: string) => ({ [id]: { url: RUNNERS_PHOTO } })
const runnersOwnPhoto = { creator: { photoUrl: RUNNERS_PHOTO } }

/** A sub-workflow graph handing out the author's upload through a step. */
const handsOutUpload = (): CaseGraph => ({
  nodes: [upload("up", KILL), step("st", "upscale-image", KILL, { upscaleFactor: 2 }), output()],
  edges: [wire("up", "st", "image", "image"), wire("st", "out", "p1", "image")],
})

/** Every case: the sentinel on everything that can flow into a creator's photo. */
export const SENTINEL_CASES: readonly SentinelCase[] = [
  photoCase("an upload wired into the photo", [upload("up", KILL), creator()], [toPhoto("up")], runnersUpload("up")),
  photoCase(
    "an upload through a step",
    [upload("up", KILL), step("st", "upscale-image", KILL, { upscaleFactor: 2 }), creator()],
    [wire("up", "st", "image", "image"), toPhoto("st")],
    runnersUpload("up"),
  ),
  photoCase(
    "an upload through a teleport pair",
    [upload("up", KILL), send("ts", "P", KILL), receive("tr", "P", KILL), creator()],
    [wire("up", "ts", "in", "image"), toPhoto("tr", "out")],
    runnersUpload("up"),
  ),
  photoCase(
    "a Text node handing an upload its link",
    [text("link", KILL, link(KILL, "link-text")), upload("up", KILL), creator()],
    [wire("link", "up", "in", "prompt"), toPhoto("up")],
    // Text is no image: the runner's photo is the upload's.
    runnersUpload("up"),
  ),
  photoCase("a List whose rows are the photo", [list("rows", KILL), creator()], [toPhoto("rows", "items")], { rows: { items: [RUNNERS_PHOTO] } }),
  photoCase("an upload the app shows as an input", [upload("up", KILL), creator()], [toPhoto("up")], runnersUpload("up"), {
    settings: shows("up"),
    componentInputs: ["up"],
  }),
  photoCase(
    "a Text node the app shows as an input, handing an upload its link",
    [text("link", KILL, link(KILL, "shown-link")), upload("up", KILL), creator()],
    [wire("link", "up", "in", "prompt"), toPhoto("up")],
    runnersUpload("up"),
    { settings: shows("link"), componentInputs: ["link"] },
  ),
  photoCase("the creator's own photo, kept from the author's run", [creator()], [], runnersOwnPhoto),
  photoCase("a sub-workflow's output, referenced as a run reads it", [sub("sub", "wf-hands-out"), creator()], [toPhoto("sub", "out_p1")], runnersOwnPhoto, {
    workflows: { "wf-hands-out": handsOutUpload() },
  }),
  photoCase(
    "a sub-workflow's output, referenced as the editor writes it",
    [sub("sub", "wf-hands-out", "editor"), creator()],
    [toPhoto("sub", "out_p1")],
    runnersOwnPhoto,
    { workflows: { "wf-hands-out": handsOutUpload() } },
  ),
  photoCase("a teleport pair inside a sub-workflow", [sub("sub", "wf-teleports"), creator()], [toPhoto("sub", "out_p1")], runnersOwnPhoto, {
    workflows: {
      "wf-teleports": {
        nodes: [upload("up", KILL), send("ts", "Q", KILL), receive("tr", "Q", KILL), output()],
        edges: [wire("up", "ts", "in", "image"), wire("tr", "out", "p1", "out")],
      },
    },
  }),
  photoCase(
    "an upload fed through a sub-workflow's input to a creator inside it",
    [upload("up", KILL), sub("sub", "wf-inner-creator")],
    [wire("up", "sub", "in_i1", "image")],
    runnersUpload("up"),
    {
      creatorId: null,
      workflows: {
        "wf-inner-creator": {
          nodes: [input({ __injectedPortValues: { i1: link(KILL, "injected") } }), creator("inner")],
          edges: [wire("in", "inner", "photo", "i1")],
        },
      },
    },
  ),
  photoCase(
    "the same upload as one of the app's inputs",
    [upload("up", KILL), sub("sub", "wf-inner-creator")],
    [wire("up", "sub", "in_i1", "image")],
    runnersUpload("up"),
    {
      creatorId: null,
      settings: shows("up"),
      componentInputs: ["up"],
      workflows: { "wf-inner-creator": { nodes: [input(), creator("inner")], edges: [wire("in", "inner", "photo", "i1")] } },
    },
  ),
  photoCase(
    "two sub-workflows down and back up",
    [upload("up", KILL), sub("s1", "wf-level-1"), creator()],
    [wire("up", "s1", "in_i1", "image"), toPhoto("s1", "out_p1")],
    runnersUpload("up"),
    {
      workflows: {
        "wf-level-1": { nodes: [input(), sub("s2", "wf-level-2"), output()], edges: [wire("in", "s2", "in_i1", "i1"), wire("s2", "out", "p1", "out_p1")] },
        "wf-level-2": {
          nodes: [input(), upload("own", KILL), step("mix", "image-collage", KILL), output()],
          edges: [wire("in", "mix", "in", "i1"), wire("own", "mix", "in", "image"), wire("mix", "out", "p1", "image")],
        },
      },
    },
  ),
  photoCase(
    "a Text node prompting the generator that makes the photo",
    [text("brief", KILL), step("gen", "generate-image", KILL, { prompt: `${KEEP} the generator's own prompt`, aspectRatio: "1:1" }), creator()],
    [wire("brief", "gen", "prompt", "prompt"), toPhoto("gen")],
    { brief: { text: "me, smiling" } },
    // A setting a component exposes on the generator: its prompt is a setting, and stays.
    { exposed: [{ nodeId: "gen", field: "prompt", type: "text", defaultValue: `${KEEP} the generator's own prompt` }] },
  ),
  photoCase(
    "an LLM handing an upload its link, its input exposed on a component",
    [
      node("writer", "llm-chat", { userInput: link(KILL, "writer-input"), systemPrompt: `${KEEP} the writer's system prompt`, generatedText: link(KILL, "writer-out") }),
      upload("up", KILL),
      creator(),
    ],
    [wire("writer", "up", "in", "text"), toPhoto("up")],
    runnersUpload("up"),
    { exposed: [{ nodeId: "writer", field: "userInput", type: "text", defaultValue: link(KILL, "writer-input") }] },
  ),
  photoCase(
    "what a sub-workflow can hand out when its output node hands out nothing (a terminal node)",
    [sub("sub", "wf-terminal"), creator()],
    [toPhoto("sub", "out_p1")],
    runnersOwnPhoto,
    {
      workflows: {
        "wf-terminal": {
          nodes: [upload("aside", KILL), step("made", "generate-image", KILL), output()],
          edges: [wire("made", "out", "p1", "image")],
        },
      },
    },
  ),
  photoCase(
    "a frozen sub-workflow's saved output",
    [sub("sub", "wf-frozen", "run", { skipped: true, outputResults: { p1: link(KILL, "frozen-out") }, generatedResults: [{ url: link(KILL, "frozen-result"), jobId: "j", timestamp: "t" }] }), creator()],
    [toPhoto("sub", "out_p1")],
    runnersOwnPhoto,
    { workflows: { "wf-frozen": handsOutUpload() } },
  ),
  photoCase(
    "a Character, an Object, a Creature and a Location on the photo's path",
    [entity("who", "character"), entity("prop", "object"), entity("pet", "creature"), entity("where", "location"), step("mix", "image-collage", KILL), creator()],
    [wire("who", "mix", "in", "image"), wire("prop", "mix", "in", "image"), wire("pet", "mix", "in", "image"), wire("where", "mix", "in", "image"), toPhoto("mix")],
    runnersOwnPhoto,
  ),
  photoCase(
    "a Character straight into the photo, and through a generator's references",
    [entity("who", "character"), step("gen", "generate-image", KILL, { prompt: `${KEEP} a portrait` }), creator(), creator("second")],
    [wire("who", "gen", "assets", "image"), toPhoto("gen"), toPhoto("who", "image", "second")],
    { creator: { photoUrl: RUNNERS_PHOTO }, second: { photoUrl: RUNNERS_PHOTO } },
  ),
  photoCase(
    "what is made from the photo's upload off the path: a Preview of it, an upscale of it, a second Receive on its channel",
    [
      upload("up", KILL), send("ts", "P", KILL), receive("tr", "P", KILL), receive("tr2", "P", KILL), creator(),
      node("shown", "preview", { previewItems: [{ type: "image", value: link(KILL, "previewed"), sourceNodeId: "up", itemKey: "up:image" }], itemOrder: ["up:image"] }),
      step("side", "upscale-image", KILL, { upscaleFactor: 2 }), step("sibling", "generate-image", KILL, { prompt: `${KEEP} a sibling` }),
    ],
    [wire("up", "ts", "in", "image"), toPhoto("tr", "out"), wire("up", "side", "image", "image"), wire("up", "sibling", "reference", "image"), wire("tr2", "side", "mask", "out")],
    runnersUpload("up"),
  ),
  photoCase(
    "a published component holding a UGC video: its stored take, the upload on its image handle, the handle's own value",
    [
      upload("up", KILL),
      node("comp", "component", {
        appSlug: "ugc-maker", pinnedVersion: 1, componentMetadata: { inputs: [{ id: "in::face", name: "Face", type: "image", required: true, fieldKey: "url" }], outputs: [], exposedSettings: [] },
        exposedSettings: { "in::face:url": link(KILL, "handle-value"), "tone:tone": `${KEEP}-tone` }, outputResults: { out: link(KILL, "component-take") }, generatedResults: [{ url: link(KILL, "component-take"), jobId: "j", timestamp: "t" }],
      }),
      step("after", "trim-video", KILL, { keepFirstSeconds: 5 }),
    ],
    [wire("up", "comp", "in::face", "image"), wire("comp", "after", "in", "out")],
    runnersUpload("up"),
    {
      creatorId: null,
      components: {
        "ugc-maker": {
          creatorId: "00000000-0000-4000-8000-0000000000c1",
          graph: { nodes: [input(), creator("inner")], edges: [wire("in", "inner", "photo", "i1")] },
        },
      },
    },
  ),
  photoCase(
    "what is made from the video keeps no copy of its input: Manual Edit, After Effects, 3D Title, Composite",
    [
      take(), node("cut", "manual-edit", { mode: `${KEEP}-mode`, inputVideoUrl: link(KILL, "cut-input"), inputAssets: [{ url: link(KILL, "cut-asset") }], generatedVideoUrl: link(KILL, "cut-out") }),
      // Each plan a run rebuilds from the input holds more of it than its address.
      node("fx", "after-effects", { effectPrompt: `${KEEP} glow`, inputVideoUrl: link(KILL, "fx-input"), effectPlan: { sourceVideo: link(KILL, "fx-plan"), sourceNote: `${KILL} fx plan note` } }),
      node("title", "3d-title", { titlePrompt: `${KEEP} big title`, backgroundMediaUrl: link(KILL, "title-bg"), titlePlan: { backgroundMedia: link(KILL, "title-plan"), backgroundNote: `${KILL} title plan note` } }),
      node("stack", "composite", { aspectRatio: "9:16", compositePlan: { layers: [{ sourceVideo: link(KILL, "stack-layer") }], sourceNote: `${KILL} stack plan note` } }),
      creator(),
    ],
    [wire("clip", "cut", "in", "video-out"), wire("cut", "fx", "in", "video"), wire("fx", "title", "background", "video"), wire("title", "stack", "in", "video")],
    runnersOwnPhoto,
  ),
  photoCase(
    "what is made from the video and sends it out: a publisher keeps its account, a webhook its address; the post and the reply go",
    [
      take(),
      // Where it sends is the app's (a setting); what the author's run sent back is not.
      node("post", "x-post", { platform: "x", connectionId: `${KEEP}-connection`, privacy: "public", caption: `${KEEP} caption`, platformPostUrl: link(KILL, "posted"), platformPostId: `${KILL}-post-id` }),
      node("hook", "webhook-output", { url: `https://hooks.example/${KEEP}-hook`, webhookStatusCode: 200, webhookResponseBody: `${KILL} reply body` }),
      creator(),
    ],
    [wire("clip", "post", "video", "video-out"), wire("clip", "hook", "in", "video-out")],
    runnersOwnPhoto,
  ),
  photoCase(
    "an overlay made from the video: the author's logo ships; a layer naming the take does not — by its address with a query, or by its asset id",
    [
      node("clip", "ugc-clip", { generatedVideoUrl: link(KILL, "clip-take"), generatedResults: [{ url: link(KILL, "clip-take"), assetId: `${KILL}-asset-0001-take`, jobId: "j", timestamp: "t" }] }),
      node("overlay", "video-overlay", { layers: [{ imageUrl: link(KEEP, "logo") }, { videoUrl: `${link(KILL, "clip-take")}?token=abc` }, { assetId: `${KILL}-asset-0001-take` }], layerCount: 3 }),
      creator(),
    ],
    [wire("clip", "overlay", "video", "video-out")],
    runnersOwnPhoto,
  ),
  photoCase(
    "a character definition a generator on the photo's path draws on, and another drawn on elsewhere",
    [
      step("gen", "generate-image", KILL, { prompt: `${KEEP} a portrait`, characterDefinitionIds: ["def-me"] }),
      step("mascot", "generate-image", KEEP, { prompt: `${KEEP} a mascot`, characterDefinitionIds: ["def-brand"] }),
      creator(),
    ],
    [toPhoto("gen")],
    runnersOwnPhoto,
    {
      settings: {
        characterDefinitions: [
          { id: "def-me", name: "Me", type: "reference", referenceImageUrl: link(KILL, "def-me") },
          { id: "def-brand", name: "Mascot", type: "reference", referenceImageUrl: link(KEEP, "def-brand") },
        ],
      },
    },
  ),
  photoCase(
    "a copy of the photo's upload, wired to nothing that reaches a creator, and what it feeds",
    [upload("up", KILL), node("upCopy", "upload-image", { ...upload("up", KILL).data, label: "upCopy" }), step("side", "upscale-image", KILL, { upscaleFactor: 2 }), creator()],
    [toPhoto("up"), wire("upCopy", "side", "image", "image")],
    runnersUpload("up"),
  ),
  photoCase(
    "a take dropped into an Upload Video nothing wires after the video",
    [take(), node("dropped", "upload-video", { url: link(KILL, "clip-take"), r2Url: link(KILL, "clip-take"), filename: `${KILL}-take.mp4` }), creator()],
    [],
    runnersOwnPhoto,
  ),
  photoCase(
    "the photo's address quoted in a sentence: an LLM's prompt handing the upload its link, and a generator's prompt on the path",
    [
      node("writer", "llm-chat", { userInput: `Return exactly this link: ${link(KILL, "up")}`, systemPrompt: `${KEEP} answer with a link only` }),
      upload("up", KILL),
      step("gen", "generate-image", KILL, { prompt: `a portrait in the style of ${link(KILL, "style")}, soft light` }),
      creator(),
    ],
    [wire("writer", "up", "in", "text"), wire("up", "gen", "image", "image"), toPhoto("gen")],
    runnersUpload("up"),
  ),
  photoCase(
    "earlier renders a node keeps under its own key, made from the creator's image: Paint Mask's source, a generator's refine base",
    [
      creator(),
      node("mask", "paint-mask", { sourceImageUrl: link(KILL, "earlier-face"), maskUrl: link(KEEP, "mask") }),
      step("refine", "generate-image", KILL, { prompt: `${KEEP} sharper`, baseImageUrl: link(KILL, "earlier-face") }),
    ],
    [wire("creator", "mask", "image", "image"), wire("creator", "refine", "reference", "image")],
    runnersOwnPhoto,
  ),
  photoCase(
    "a sub-workflow whose graph can no longer be read, with the outputs it left",
    [sub("gone", "wf-deleted", "run", { outputResults: { p1: link(KILL, "gone-out") }, generatedResults: [{ url: link(KILL, "gone-result"), jobId: "j", timestamp: "t" }] }), step("after", "trim-video", KILL), creator()],
    [wire("gone", "after", "in", "out_p1")],
    runnersOwnPhoto,
  ),
  photoCase(
    "a frozen sub-workflow inside a sub-workflow, whose own graph holds a UGC video",
    [sub("outer", "wf-holds-frozen"), step("after", "trim-video", KILL), creator()],
    [wire("outer", "after", "in", "out_p1")],
    runnersOwnPhoto,
    {
      workflows: {
        "wf-holds-frozen": {
          nodes: [sub("frozen", "wf-ugc-inside", "run", { skipped: true, outputResults: { p1: link(KILL, "frozen-take") }, generatedResults: [{ url: link(KILL, "frozen-result"), jobId: "j", timestamp: "t" }] }), step("trim", "trim-video", KILL), output()],
          edges: [wire("frozen", "trim", "in", "out_p1"), wire("trim", "out", "p1", "video")],
        },
        "wf-ugc-inside": { nodes: [take("inner-clip"), output()], edges: [wire("inner-clip", "out", "p1", "video-out")] },
      },
    },
  ),
  photoCase(
    "the author picks a node on the photo's path as the thumbnail: the pick ships as chosen, the snapshot holds none of it",
    [upload("up", KILL), step("st", "upscale-image", KILL, { upscaleFactor: 2 }), creator()],
    [wire("up", "st", "image", "image"), toPhoto("st")],
    runnersUpload("up"),
    { thumbnailNodeId: "st" },
  ),
]

/** Controls: nothing here can flow into a creator's photo, so everything keeps what it holds. */
export const CONTROL_CASES: readonly SentinelCase[] = [
  {
    name: "no creator: an upload into a step",
    graph: withControls({ nodes: [upload("up", KEEP), step("st", "upscale-image", KEEP, { upscaleFactor: 2 })], edges: [wire("up", "st", "image", "image")] }, null),
    workflows: {},
    settings: {},
  },
  {
    name: "a sub-workflow whose output feeds no creator",
    graph: withControls(
      { nodes: [sub("sub", "wf-keeps"), step("after", "upscale-image", KEEP)], edges: [wire("sub", "after", "image", "out_p1")] },
      null,
    ),
    workflows: { "wf-keeps": { nodes: [upload("up", KEEP), output()], edges: [wire("up", "out", "p1", "image")] } },
    settings: {},
  },
  {
    name: "a frozen sub-workflow whose graph holds no UGC video still stands in with its outputs",
    graph: withControls(
      { nodes: [sub("frozen", "wf-plain", "run", { skipped: true, outputResults: { p1: link(KEEP, "frozen-out") } }), step("after", "upscale-image", KEEP)], edges: [wire("frozen", "after", "image", "out_p1")] },
      null,
    ),
    // A frozen node's graph does not run: what stands in for it is its own outputs.
    workflows: { "wf-plain": { nodes: [node("g", "generate-image", { prompt: "plain" }), output()], edges: [wire("g", "out", "p1", "image")] } },
    settings: {},
  },
  {
    name: "what feeds a creator's other inputs",
    graph: withControls(
      { nodes: [creator(), upload("bg", KEEP), upload("up", KILL)], edges: [wire("bg", "creator", "pickers", "image"), toPhoto("up")] },
      "creator",
    ),
    workflows: {},
    settings: {},
    runnerGives: runnersUpload("up"),
  },
]

/** Every string a case's graph (and, with `withWorkflows`, the sub-workflow graphs) holds that carries `mark`. */
export function marked(c: SentinelCase, mark: Mark, withWorkflows = false): string[] {
  const found = new Set<string>()
  const walk = (value: unknown) => {
    if (typeof value === "string") {
      if (value.includes(mark)) found.add(value)
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item)
    } else if (value && typeof value === "object") {
      for (const item of Object.values(value)) walk(item)
    }
  }
  walk(c.graph.nodes)
  if (withWorkflows) for (const graph of Object.values(c.workflows)) walk(graph.nodes)
  return [...found].sort()
}
