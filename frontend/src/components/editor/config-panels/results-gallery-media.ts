/**
 * Which medium the config-panel results gallery shows a node's results as,
 * and the node-data update that picking one of them writes.
 *
 * Picking a result selects it (`activeResultIndex`) and mirrors its URL into
 * the node's saved media field. The two engines read a saved node differently:
 * the canvas reads the selected result first, while a server run reads the
 * media field first for some node types — Apply EDL, Voice Changer and Dubbing
 * among them. So for those types the field the pick writes decides which take a
 * workflow run hands downstream, and a pick written to the wrong field splits
 * the engines.
 *
 * Each result is shown as the medium of its own file. When its URL names none,
 * the node's medium decides: it comes from @nodaro/shared's producer sets, the
 * single source of truth the canvas validators and the backend use, so a new
 * video or audio producer is typed right with no edit here. A dynamic producer
 * whose medium is a setting is typed from its data, the way its own canvas picker
 * reads it. results-gallery-medium-census.test.ts fails for a gallery type with
 * no medium.
 */
import { AUDIO_PRODUCER_TYPES, DYNAMIC_PRODUCER_TYPES, VIDEO_PRODUCER_TYPES } from "@nodaro/shared"
import { applyEdlCutFields, applyEdlMedium } from "@/lib/apply-edl-cut"
import { takeKeptTranscript, type ApplyEdlTake } from "@/lib/apply-edl-take-transcript"
import { isAudioUrl, isImageUrl, isVideoUrl } from "@/lib/media-type"

export type ResultsGalleryMediaType = "image" | "video" | "audio"

type NodeData = Readonly<Record<string, unknown>>

/** Gallery node types whose results are images. There is no shared image
 *  producer set; the census keeps this list from contradicting the shared ones. */
export const IMAGE_RESULT_TYPES: ReadonlySet<string> = new Set([
  "generate-image", "modify-image", "upscale-image", "remove-background", "generate-mask",
  "reference-sheet", "reference-board", "extract-frame", "image-collage", "image-overlay",
])

/** Gallery node types with no medium of their own: their result is text, JSON
 *  or a plan (a result with no URL shows no gallery), or, for Component,
 *  whatever its sub-workflow returns. Each result is typed by its own file. */
export const NO_MEDIUM_RESULT_TYPES: ReadonlySet<string> = new Set([
  "generate-script", "forced-alignment", "suno-lyrics", "suno-style-boost",
  "web-scrape", "meta-ads-scrape", "instagram-scrape", "social-search",
  "video-analysis", "video-audit", "content-recipe", "content-ideas",
  "video-composer", "after-effects", "lottie-overlay", "3d-title", "motion-graphics",
  "generate-3d-scene", "edit-3d-scene", "composite",
  "edit-plan", "camera-switch", "silence-detect", "audio-sync",
  "router", "component",
])

/** Video mode is "holds a video result" (voice-changer-node.tsx, dubbing-node.tsx). */
function holdsVideo(data: NodeData): "video" | "audio" {
  return data.generatedVideoUrl ? "video" : "audio"
}

/** Dynamic producers whose medium is a setting in their data, read the way each
 *  one's own canvas picker reads it. Every other dynamic producer (Split into
 *  Chunks, Choose Best, …) has results of either medium, typed one by one. */
export const NODE_DATA_MEDIUM: ReadonlyMap<string, (data: NodeData) => "video" | "audio"> = new Map([
  // Its `output` field, video when absent.
  ["apply-edl", applyEdlMedium],
  ["voice-changer", holdsVideo],
  ["voice-changer-pro", holdsVideo],
  ["dubbing", holdsVideo],
  // The input it last ran on (adjust-volume-node.tsx).
  ["adjust-volume", (data: NodeData) => (data.lastInputType === "video" ? "video" : "audio")],
])

/** The medium the node's type or settings fix, or `undefined` when each
 *  result's own file decides. */
function nodeMedium(nodeType: string, data: NodeData): ResultsGalleryMediaType | undefined {
  const fromData = NODE_DATA_MEDIUM.get(nodeType)
  if (fromData) return fromData(data)
  if (DYNAMIC_PRODUCER_TYPES.has(nodeType) || NO_MEDIUM_RESULT_TYPES.has(nodeType)) return undefined
  if (VIDEO_PRODUCER_TYPES.has(nodeType)) return "video"
  if (AUDIO_PRODUCER_TYPES.has(nodeType)) return "audio"
  if (IMAGE_RESULT_TYPES.has(nodeType)) return "image"
  return undefined
}

/** Whether the gallery knows how a node type's results are typed. The census
 *  requires it of every node type with a results gallery. */
export function resultsGalleryDeclaresMedium(nodeType: string): boolean {
  return (
    NODE_DATA_MEDIUM.has(nodeType) ||
    DYNAMIC_PRODUCER_TYPES.has(nodeType) ||
    NO_MEDIUM_RESULT_TYPES.has(nodeType) ||
    VIDEO_PRODUCER_TYPES.has(nodeType) ||
    AUDIO_PRODUCER_TYPES.has(nodeType) ||
    IMAGE_RESULT_TYPES.has(nodeType)
  )
}

/** The node's medium: its type's, or its setting's. "image" when neither fixes
 *  one (the gallery's historical default). */
export function resultsGalleryMediaType(nodeType: string, data: NodeData): ResultsGalleryMediaType {
  return nodeMedium(nodeType, data) ?? "image"
}

function mediumOfUrl(url: string): ResultsGalleryMediaType | undefined {
  if (isVideoUrl(url)) return "video"
  if (isAudioUrl(url)) return "audio"
  if (isImageUrl(url)) return "image"
  return undefined
}

/**
 * The medium of one result, `url`: its tile, and — for the selected one — the
 * Download name, the type Save to Library stores, whether Set as Thumbnail shows
 * and, for a node whose medium is not a setting, the field a pick writes.
 *
 * Each result is the medium of its own file, for every node type; the node's
 * medium (its type's, or its setting's) is only the fallback for a URL that
 * names none. A producer set says what a node type produces, not what one result
 * is: Social Media Format is in the video producer set but reformats an image
 * into an image, and a node whose medium is a setting keeps its results across a
 * change of that setting.
 */
export function resultsGalleryTakeMedium(nodeType: string, data: NodeData, url: string): ResultsGalleryMediaType {
  return mediumOfUrl(url) ?? resultsGalleryMediaType(nodeType, data)
}

const MEDIA_FIELD = {
  video: "generatedVideoUrl",
  audio: "generatedAudioUrl",
} as const

/**
 * Whether result `url` may NOT be picked: the medium of that take when it is
 * refused, else `undefined`.
 *
 * Apply EDL passes its selected take on as the medium its Output names — both
 * engines route the cut by Output. Its history keeps the takes rendered before
 * an Output switch, and a take of the other medium passed on as this one fails
 * downstream on both engines (an audio file handed to a video input). So such a
 * take cannot be picked until Output names its medium again (decided
 * 2026-10-04); the gallery disables its tile and says so. A take whose URL
 * names no medium is taken to be the Output's.
 */
export function resultsGalleryPickRefusal(nodeType: string, data: NodeData, url: string): "video" | "audio" | undefined {
  if (nodeType !== "apply-edl") return undefined
  const take = mediumOfUrl(url)
  if (take !== "video" && take !== "audio") return undefined
  return take === applyEdlMedium(data) ? undefined : take
}

/**
 * The update for picking result `index` (whose URL is `url`) on a node of type
 * `nodeType` holding `data`, or `undefined` when the pick is refused
 * (resultsGalleryPickRefusal).
 *
 * Apply EDL makes the picked take the node's one cut, as the medium its Output
 * renders: its field set, the other medium's field cleared (lib/apply-edl-cut.ts
 * says why), and its Transcript output set to the one that take was cut with
 * when the take kept it — every lane that lands a take keeps it there. A take
 * that kept none (a list run's renders after its first, or one saved before
 * landed takes kept theirs) CLEARS the Transcript output instead of leaving it as
 * it was: what it holds is another take's, timed to another cut, and captions
 * built from it would drift off the picked cut's speech. The gallery then reads
 * the take's own Transcript back from its job, when that job is provably this
 * take's (lib/apply-edl-take-transcript.ts).
 *
 * A node whose medium is a setting writes the URL into its current medium's
 * field, as its own canvas picker does. Every other node writes the medium of
 * the result's own file (resultsGalleryTakeMedium): generatedImageUrl for an
 * image, generatedVideoUrl for a video, and only the index for audio (both
 * engines read an audio node's selected result first).
 */
export function resultsGalleryPickPatch(
  nodeType: string,
  data: NodeData,
  url: string,
  index: number,
): Record<string, unknown> | undefined {
  if (resultsGalleryPickRefusal(nodeType, data, url)) return undefined
  if (nodeType === "apply-edl") {
    const take = (data.generatedResults as ReadonlyArray<ApplyEdlTake> | undefined)?.[index]
    return {
      activeResultIndex: index,
      ...applyEdlCutFields(applyEdlMedium(data), url),
      generatedJson: take && takeKeptTranscript(take) ? take.generatedJson : undefined,
    }
  }
  const fromData = NODE_DATA_MEDIUM.get(nodeType)
  if (fromData) return { activeResultIndex: index, [MEDIA_FIELD[fromData(data)]]: url }
  const medium = resultsGalleryTakeMedium(nodeType, data, url)
  const updates: Record<string, unknown> = { activeResultIndex: index }
  if (medium === "image") {
    updates.generatedImageUrl = url
  } else if (medium === "video") {
    updates.generatedVideoUrl = url
  }
  return updates
}
