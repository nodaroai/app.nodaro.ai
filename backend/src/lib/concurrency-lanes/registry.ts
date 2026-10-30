// @registry-lookup asks the lane of the one job type it is given (laneOf)
// backend/src/lib/concurrency-lanes/registry.ts — which class every job a
// lane-gated worker can receive belongs to: a leaf of the provider, llm or
// local lane, or a coordinator (a top-level one holds a run slot, a nested
// one none). Total by a guard (__tests__/registry.test.ts): a job name with
// no entry fails the build.
//
// Three sources, in the order the worker itself resolves a handler:
//   1. a plugin job type (video queue) — its own declaration
//      (registerPluginJobLanes), else a coordinator: a coordinator never holds a
//      leaf slot and each of its toolkit calls acquires its own, so a wrong
//      default cannot deadlock, it only costs a run slot. On Cloud a plugin
//      replaces the community relay's handler, so its declaration wins over
//      the static entry for the same name;
//   2. a node unit's worker — its one `lane:*` capability, read through
//      lib/unit-descriptors.ts (no central list names a unit);
//   3. the static table below, keyed by queue and name: the pipeline queue's
//      only name is `run`, which means nothing on the video queue.
// Anything else is a coordinator.
//
// Deliberately light: no handler map is imported here (importing them pulls
// in the ffmpeg and provider runtimes), so the table is written out and the
// guard test checks it against the maps.
import { laneOf } from "../unit-descriptors.js"
import { isLeafLane, type LeafLane } from "./leaf-lanes.js"
import type { LaneClass, LaneQueueName } from "./types.js"

const leaf = (lane: LeafLane): LaneClass => Object.freeze({ kind: "leaf", lane })
const PROVIDER = leaf("provider")
const LLM = leaf("llm")
const LOCAL = leaf("local")
const COORDINATOR: LaneClass = Object.freeze({ kind: "coordinator" })

/** The queue whose job-name vocabulary a live or in-process call of a job type uses. */
const JOB_TYPE_QUEUE = "video-generation"

const rows = (queue: LaneQueueName, cls: LaneClass, names: readonly string[]): Array<[string, LaneClass]> =>
  names.map((n) => [`${queue}:${n}`, cls])

/**
 * The class of every core job, keyed `<queue>:<job name>`. Node units are not
 * here (their lane is their `lane:*` capability), nor are plugin types.
 */
export const JOB_LANE_CLASSES: Readonly<Record<string, LaneClass>> = Object.freeze(Object.fromEntries([
  // In-house compute: ffmpeg (handlers/ffmpeg.ts, and the two ffmpeg passes of
  // handlers/video-mask.ts), sharp compositing (image-collage, image-overlay,
  // reference-sheet — composed from stored images, no AI call).
  ...rows("video-generation", LOCAL, [
    "combine-videos", "apply-edl", "assemble-narrated-video", "image-collage", "image-overlay", "merge-video-audio",
    "trim-audio", "trim-video", "extract-frame", "speed-ramp", "loop-video", "fade-video", "video-overlay",
    "still-to-video", "slideshow", "resize-video", "adjust-volume", "audio-fx", "pitch-tempo", "add-captions",
    "mix-audio", "combine-audio", "transcode-video", "social-media-format", "split-media", "extract-audio",
    "silence-detect", "audio-sync", "mask-composite", "mask-erase", "reference-sheet",
  ]),
  // LLM-only jobs.
  ...rows("video-generation", LLM, ["generate-script", "llm-structured", "motion-graphics-lottie", "generate-3d-scene", "edit-3d-scene"]),
  // Calls to an external AI provider: image, video, audio, Suno, entities.
  ...rows("video-generation", PROVIDER, [
    "generate-image", "edit-image", "image-to-image", "reference-board",
    "image-to-video", "voiced-video", "video-to-video", "text-to-video", "lip-sync", "speech-to-video",
    "motion-transfer", "video-upscale", "extend-video", "video-retake", "face-swap", "generate-mask", "ai-avatar",
    "cinematic-avatar", "switchx", "video-sfx", "video-depth", "video-mask",
    "text-to-speech", "generate-music", "text-to-audio", "transcribe", "extract-youtube-audio", "audio-isolation",
    "audio-separation", "text-to-dialogue", "voice-changer", "dubbing", "voice-remix", "voice-design", "forced-alignment",
    "suno-generate", "suno-cover", "suno-extend", "suno-lyrics", "suno-separate", "suno-music-video", "suno-mashup",
    "suno-replace-section", "suno-add-instrumental", "suno-add-vocals", "suno-convert-wav", "suno-upload-extend",
    "generate-character", "generate-face", "generate-character-asset", "generate-object", "generate-object-asset",
    "generate-creature", "generate-creature-asset", "generate-location", "generate-location-asset",
    "generate-character-motion", "generate-location-motion", "generate-object-motion", "generate-creature-motion",
  ]),
  // Coordinators: the community relay of the nodaro.ai-exclusive nodes
  // (handlers/nodaro-exclusive-relay.ts) and surround continuation.
  ...rows("video-generation", COORDINATOR, [
    "generate-video-pro", "edit-video-pro", "voice-changer-pro", "video-analysis", "video-audit", "edit-plan",
    "camera-switch", "speaker-view", "speaker-frames", "generate-surround-continuation",
  ]),
  // The render queue: the Remotion render, the add-captions burn hand-off, the 3D scene child.
  ...rows("video-render", LOCAL, ["render-video", "render", "scene-render-child"]),
  ...rows("workflow-orchestration", COORDINATOR, ["workflow-execution"]),
  ...rows("pipeline-orchestration", COORDINATOR, ["run"]),
  ...rows("video-director", COORDINATOR, ["video-director"]),
]))

/** The plugin job types the loader merged handlers for, and the classes plugins declared. */
const pluginJobTypes = new Set<string>()
const pluginJobLanes = new Map<string, LaneClass>()

function validLaneClass(cls: unknown): LaneClass | null {
  if (cls === null || typeof cls !== "object") return null
  const c = cls as { kind?: unknown; lane?: unknown }
  if (c.kind === "coordinator") return COORDINATOR
  if (c.kind === "leaf" && isLeafLane(c.lane)) return leaf(c.lane)
  return null
}

/**
 * The class of a job named `jobName` on `queue`. A `live` or `inline` call of a
 * job type is classified as that job type on the video queue. `data` is the
 * job's payload, for a job whose class would depend on it (none today).
 */
export function laneClassOf(queue: LaneQueueName, jobName: string, _data: unknown): LaneClass {
  const ns: LaneQueueName = queue === "live" || queue === "inline" ? JOB_TYPE_QUEUE : queue
  if (ns === JOB_TYPE_QUEUE) {
    const declared = pluginJobLanes.get(jobName)
    if (declared) return declared
    if (pluginJobTypes.has(jobName)) return COORDINATOR
    const unitLane = laneOf(jobName)
    if (unitLane) return leaf(unitLane)
  }
  const key = `${ns}:${jobName}`
  return Object.hasOwn(JOB_LANE_CLASSES, key) ? JOB_LANE_CLASSES[key]! : COORDINATOR
}

/**
 * Plugin declarations (a plugin's `jobLanes()`), merged last-write-wins like
 * its handlers. An entry that is not a valid class is ignored, so its type
 * stays undeclared (a coordinator).
 */
export function registerPluginJobLanes(entries: Record<string, LaneClass>): void {
  for (const [type, cls] of Object.entries(entries)) {
    const valid = validLaneClass(cls)
    if (valid) pluginJobLanes.set(type, valid)
    else console.warn(`[concurrency-lanes] plugin job type "${type}" declares no valid lane class — treated as a coordinator`)
  }
}

/** Whether the loader has recorded this process's plugin job types (notePluginJobTypes ran at least once). */
let pluginJobTypesRecorded = false

/**
 * The plugin job types the loader merged handlers for (each plugin's
 * `handlers()` keys). The loader calls it once its load is done, with no types
 * at all when there is no plugin, so "every plugin job type declares its lane"
 * is never reported as met before anyone looked.
 */
export function notePluginJobTypes(types: Iterable<string>): void {
  pluginJobTypesRecorded = true
  for (const t of types) pluginJobTypes.add(t)
}

/** Whether this process has recorded its plugin job types; until it has, undeclaredPluginJobTypes() proves nothing. */
export function pluginJobTypesKnown(): boolean {
  return pluginJobTypesRecorded
}

/** The plugin handler keys with no declaration, sorted — every one declared is an enforcement precondition. */
export function undeclaredPluginJobTypes(): string[] {
  return [...pluginJobTypes].filter((t) => !pluginJobLanes.has(t)).sort()
}
