/**
 * From the body a verb sends to a route to the canvas node that sends the
 * same request when the user presses Run.
 *
 * Verbs inject the very routes the editor's single-node Run calls, so the
 * mapping is "route body → node data", keyed by the route, never by the tool:
 * two verbs that reach one route share its mapper.
 *
 * A mapper only maps what the node can carry. A body holding any field the
 * mapper does not list (a fan-out, a count, a direction the node cannot hold)
 * maps to NO node, rather than to a node whose Run would make something else:
 * a node that does not reproduce the call is worse than no node. The job is
 * still filed in the conversation's executions list.
 */

export type FlowMediaKind = "image" | "video" | "audio"

/** A media input of the call, wired into the node on `targetHandle`. */
export interface FlowNodeInput {
  readonly url: string
  readonly kind: FlowMediaKind
  readonly targetHandle: string
}

export interface FlowNodeSpec {
  readonly type: string
  readonly data: Readonly<Record<string, unknown>>
  readonly inputs: readonly FlowNodeInput[]
  /** The node-data field holding the node's result. */
  readonly outputKey: "generatedImageUrl" | "generatedVideoUrl" | "generatedAudioUrl"
  /** The prompt the assistant sent, for naming a conversation the user's words did not name. */
  readonly prompt?: string
}

type Body = Readonly<Record<string, unknown>>

interface RouteMapper {
  /** Body fields this mapper carries into the node. */
  readonly fields: ReadonlySet<string>
  readonly map: (body: Body) => FlowNodeSpec | null
}

/** Fields every verb body carries that are about the request, not the node. */
const TRANSPORT_FIELDS: ReadonlySet<string> = new Set(["mcp_client", "userId", "workflowId", "nodeId"])

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function urls(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0) : []
}

/** The defined entries only: an undefined field is not written into node data. */
function defined(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined))
}

function inputsOf(kind: FlowMediaKind, targetHandle: string, list: readonly string[]): FlowNodeInput[] {
  return list.map((url) => ({ url, kind, targetHandle }))
}

const generateImage: RouteMapper = {
  fields: new Set([
    "prompt", "provider", "aspectRatio", "resolution", "quality", "negativePrompt",
    "referenceImageUrls", "strength", "guidanceScale", "baseImageUrl", "maskUrl",
  ]),
  map(body) {
    const prompt = str(body.prompt)
    const provider = str(body.provider)
    if (!prompt || !provider) return null
    return {
      type: "generate-image",
      outputKey: "generatedImageUrl",
      prompt,
      inputs: inputsOf("image", "references", urls(body.referenceImageUrls)),
      data: defined({
        label: "Generate Image",
        prompt,
        provider,
        model: provider,
        style: "",
        aspectRatio: str(body.aspectRatio) ?? "1:1",
        negativePrompt: str(body.negativePrompt) ?? "",
        resolution: str(body.resolution),
        quality: str(body.quality),
        strength: typeof body.strength === "number" ? body.strength : undefined,
        guidanceScale: typeof body.guidanceScale === "number" ? body.guidanceScale : undefined,
        baseImageUrl: str(body.baseImageUrl),
        maskUrl: str(body.maskUrl),
        fieldMappings: {},
      }),
    }
  },
}

const modifyImage: RouteMapper = {
  fields: new Set([
    "imageUrl", "prompt", "provider", "aspectRatio", "resolution", "quality", "negativePrompt",
    "referenceImageUrls", "strength", "seed", "maskUrl",
  ]),
  map(body) {
    const imageUrl = str(body.imageUrl)
    const provider = str(body.provider)
    if (!imageUrl || !provider) return null
    const prompt = str(body.prompt) ?? ""
    // The node's first wired image is the one it edits; the others are references.
    return {
      type: "modify-image",
      outputKey: "generatedImageUrl",
      prompt,
      inputs: inputsOf("image", "image", [imageUrl, ...urls(body.referenceImageUrls)]),
      data: defined({
        label: "Modify Image",
        prompt,
        provider,
        aspectRatio: str(body.aspectRatio),
        resolution: str(body.resolution),
        quality: str(body.quality),
        negativePrompt: str(body.negativePrompt),
        strength: typeof body.strength === "number" ? body.strength : undefined,
        seed: typeof body.seed === "number" ? body.seed : undefined,
        maskUrl: str(body.maskUrl),
        fieldMappings: {},
      }),
    }
  },
}

const generateVideo: RouteMapper = {
  fields: new Set([
    "prompt", "provider", "duration", "aspectRatio", "resolution", "sound", "generateAudio",
    "negativePrompt", "seed", "draft", "keepOriginalSound",
    "imageUrl", "endFrameUrl", "referenceImageUrls", "referenceVideoUrls", "referenceAudioUrls",
  ]),
  map(body) {
    const provider = str(body.provider)
    if (!provider) return null
    const prompt = str(body.prompt)
    const start = str(body.imageUrl)
    const end = str(body.endFrameUrl)
    return {
      type: "generate-video",
      outputKey: "generatedVideoUrl",
      prompt,
      inputs: [
        ...(start ? inputsOf("image", "startFrame", [start]) : []),
        ...(end ? inputsOf("image", "endFrame", [end]) : []),
        ...inputsOf("image", "imageReferences", urls(body.referenceImageUrls)),
        ...inputsOf("video", "videoReferences", urls(body.referenceVideoUrls)),
        ...inputsOf("audio", "audioReferences", urls(body.referenceAudioUrls)),
      ],
      data: defined({
        label: "Generate Video",
        prompt,
        provider,
        duration: typeof body.duration === "number" ? body.duration : undefined,
        aspectRatio: str(body.aspectRatio),
        resolution: str(body.resolution),
        sound: typeof body.sound === "boolean" ? body.sound : undefined,
        generateAudio: typeof body.generateAudio === "boolean" ? body.generateAudio : undefined,
        negativePrompt: str(body.negativePrompt),
        seed: typeof body.seed === "number" ? body.seed : undefined,
        draft: body.draft === true ? true : undefined,
        keepOriginalSound: typeof body.keepOriginalSound === "boolean" ? body.keepOriginalSound : undefined,
        fieldMappings: {},
      }),
    }
  },
}

/** Route → mapper. A route listed here becomes a node; any other route's job is listed only. */
const ROUTE_MAPPERS: Readonly<Record<string, RouteMapper>> = {
  "/v1/generate-image": generateImage,
  "/v1/image-to-image": modifyImage,
  "/v1/generate-video": generateVideo,
  "/v1/text-to-video": generateVideo,
}

/** The routes whose calls become nodes. */
export const MAPPED_ROUTES: readonly string[] = Object.keys(ROUTE_MAPPERS)

/** The body's fields that are about the node: set, and not transport. */
function nodeFields(body: Body): string[] {
  return Object.entries(body)
    .filter(([key, value]) => !TRANSPORT_FIELDS.has(key) && value !== undefined && value !== null)
    .map(([key]) => key)
}

/** The node a call to `route` with `body` becomes, or null when the node could not reproduce it. */
export function flowNodeFor(route: string, body: unknown): FlowNodeSpec | null {
  const mapper = ROUTE_MAPPERS[route]
  if (!mapper || !body || typeof body !== "object" || Array.isArray(body)) return null
  const record = body as Body
  if (nodeFields(record).some((key) => !mapper.fields.has(key))) return null
  return mapper.map(record)
}
