/**
 * What kind of thing a job row made — the admin Jobs page's Type filter.
 *
 * A row's type is `input_data.type` (the node or step that ran), falling back
 * to the bare `job_type` (the queue or pipeline step name) when it is not a
 * non-empty string — the same rule the server filters on. A kind is
 * read from the node registries (the producer sets, the output handles), so a
 * new node is classified with no edit here; `JOB_TYPE_KINDS` names only the
 * row types that are not canvas node types, and `OTHER_JOB_TYPES` the ones
 * that make none of the five kinds — a node unit joins it from its own
 * manifest when its outputs give it no kind. A guard test reads the backend
 * for every type it writes and fails one that is in neither.
 */
import { AUDIO_PRODUCER_TYPES, DYNAMIC_PRODUCER_TYPES, IMAGE_PRODUCER_TYPES, VIDEO_PRODUCER_TYPES } from "@nodaro/shared/nodes"
import type { SceneNodeType } from "@/types/nodes"
import type { AdminJob } from "@/ee/hooks/queries/use-admin-queries"
import { HANDLE_OUTPUT_TYPES } from "@/lib/handle-output-types"
import { OWNER_FAMILY_BY_TYPE } from "@/lib/node-families"
import { composeSet } from "@/lib/unit-compose"
import { UNIT_NODE_DEFINITIONS } from "@/lib/unit-definitions"
// @registry-enumerates OTHER_JOB_TYPES carries every worker node unit whose declared outputs give it none of the five kinds

export type JobKind = "video" | "image" | "audio" | "music" | "text"

/** The family whose audio is music, not speech or sound. Above
 *  OTHER_JOB_TYPES, which calls nodeKindOf while the module loads. */
const MUSIC_FAMILY = "audio-music"

/** Row types that are not canvas node types: streamed and per-entity variants
 *  of a node's step, bare queue / pipeline step names, internal steps. */
export const JOB_TYPE_KINDS: Readonly<Record<string, JobKind>> = {
  // Bare `job_type` values: queue and pipeline step names.
  character: "image",
  scene: "video",
  video: "video",
  image: "image",
  llm: "text",
  "llm-structured": "text",
  "pipeline-final-merge": "video",
  "cast-swap": "video",
  "cast-swap-full-quality": "video",
  "cast-swap-face-mask": "video",
  "trend-face-mask-variant": "video",
  "ugc-finish": "video",
  "suno-voice-create": "music",
  "suno-voice-validate": "music",
  // A node's step under its own name: the entity generators and their steps.
  "generate-character": "image",
  "generate-creature": "image",
  "generate-location": "image",
  "generate-object": "image",
  "generate-face": "image",
  "generate-character-asset": "image",
  "generate-creature-asset": "image",
  "generate-location-asset": "image",
  "generate-object-asset": "image",
  "generate-surround-continuation": "image",
  "image-edit": "image",
  "generate-character-motion": "video",
  "generate-creature-motion": "video",
  "generate-location-motion": "video",
  "generate-object-motion": "video",
  "video-face-mesh": "video",
  "mask-erase": "video",
  "mask-outline": "video",
  "extract-youtube-audio": "audio",
  "generate-dialogue": "audio",
  "voice-clone": "audio",
  // Language-model steps: streamed variants, captions, suggestions.
  "llm-chat-stream": "text",
  "ai-writer": "text",
  "ai-writer-stream": "text",
  "character-llm-caption": "text",
  "creature-llm-caption": "text",
  "location-llm-caption": "text",
  "object-llm-caption": "text",
  "character-portrait-approval": "text",
  "creature-main-image-approval": "text",
  "location-main-image-approval": "text",
  "object-main-image-approval": "text",
  "image-overlay-suggest": "text",
  "llm-suggest-description": "text",
  "regenerate-scene": "text",
  "scene-graph-ai": "text",
  "text-to-picker": "text",
  "video-director": "text",
  // `prompt-wizard:${action}` (the AI prompt helper), one per action.
  "prompt-wizard:analyze": "text",
  "prompt-wizard:generate": "text",
  "prompt-wizard:enhance": "text",
}

/**
 * Row types that make none of the five kinds: the Type filter's "Other",
 * still filterable by exact type. A type that starts making media or text
 * moves into a kind instead; a test fails a type that is both. The hand list
 * is the legacy nodes and steps; a worker node unit (one that writes a row of
 * its own type) joins from its manifest when its outputs give it no kind.
 */
export const OTHER_JOB_TYPES: ReadonlySet<string> = composeSet("OTHER_JOB_TYPES", new Set([
  "social-publish", // posts finished media to a social account; makes nothing
  "webhook-output", // sends a payload to a webhook; makes nothing
  "collection-write", // writes a record to a collection; makes nothing
  "save-to-storage", // copies a result to storage; makes nothing
  "qa-check", // an approve / reject gate
  "image-critic", // an approve / reject gate
  "describe-to-picker", // writes picker settings (JSON)
  "audio-sync", // an analysis (JSON)
  "forced-alignment", // an analysis (word timings JSON)
  "silence-detect", // an analysis (JSON)
  "web-scrape", // fetched page content (JSON)
  "site-capture", // a page capture: a screenshot plus JSON, not in the image producer set
  "3d-title", // writes a composition a render step turns into video
  "after-effects", // writes a composition a render step turns into video
  "generate-3d-scene", // writes a composition a render step turns into video
  "edit-3d-scene", // writes a composition a render step turns into video
  "lottie-overlay", // writes a composition a render step turns into video
  "motion-graphics", // writes a composition a render step turns into video
  "motion-graphics-lottie", // the Lottie step of motion-graphics: an animation document
  "edit-plan", // an edit decision list (JSON)
  "camera-switch", // a switched edit decision list (JSON)
  "speaker-frames", // a face-track file (JSON)
  "character-lora-training", // trains a character model; makes no media
]), UNIT_NODE_DEFINITIONS.filter((u) => u.execution.kind === "worker" && nodeKindOf(u.type) === null).map((u) => u.type))

/** The Other types, sorted. */
export function otherJobTypes(): string[] {
  return [...OTHER_JOB_TYPES].sort()
}

export function jobKindOf(type: string): JobKind | null {
  // Own keys only: `constructor` or `toString` is no row type.
  return (Object.hasOwn(JOB_TYPE_KINDS, type) ? JOB_TYPE_KINDS[type] : undefined) ?? nodeKindOf(type)
}

/** The kind the node registries alone give a type — null for a type they
 *  cannot classify (which is what `JOB_TYPE_KINDS` is for). */
export function nodeKindOf(type: string): JobKind | null {
  if (VIDEO_PRODUCER_TYPES.has(type)) return "video"
  if (IMAGE_PRODUCER_TYPES.has(type)) return "image"
  if (AUDIO_PRODUCER_TYPES.has(type)) return OWNER_FAMILY_BY_TYPE.get(type as SceneNodeType) === MUSIC_FAMILY ? "music" : "audio"
  // Runtime-decided video or audio (Apply EDL): listed under video.
  if (DYNAMIC_PRODUCER_TYPES.has(type)) return "video"
  const outputs = Object.hasOwn(HANDLE_OUTPUT_TYPES, type) ? HANDLE_OUTPUT_TYPES[type] : undefined
  if (outputs && Object.values(outputs).includes("text")) return "text"
  return null
}

let byKind: ReadonlyMap<JobKind, readonly string[]> | null = null

/** Every node type and table type of `kind`, sorted — the server's `types` list. */
export function typesOfKind(kind: JobKind): string[] {
  if (!byKind) {
    const universe = new Set<string>([
      ...Object.keys(JOB_TYPE_KINDS),
      ...VIDEO_PRODUCER_TYPES,
      ...IMAGE_PRODUCER_TYPES,
      ...AUDIO_PRODUCER_TYPES,
      ...DYNAMIC_PRODUCER_TYPES,
      ...Object.keys(HANDLE_OUTPUT_TYPES),
    ])
    const map = new Map<JobKind, string[]>()
    for (const type of [...universe].sort()) {
      const k = jobKindOf(type)
      if (k) map.set(k, [...(map.get(k) ?? []), type])
    }
    byKind = map
  }
  return [...(byKind.get(kind) ?? [])]
}

/** A row's type: `input_data.type` when it is a non-empty string, else `job_type`. */
export function rowJobType(job: Pick<AdminJob, "job_type" | "input_data">): string | null {
  const own = job.input_data?.type
  if (typeof own === "string" && own !== "") return own
  return job.job_type || null
}
