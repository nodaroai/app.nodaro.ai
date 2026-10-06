/**
 * Legacy handle ids and the canonical id each one means today.
 *
 * A node's handle ids are declared ONCE, in the editor's `NODE_DEFINITIONS`
 * (`frontend/src/types/nodes.ts`), which generates the MCP handle map, the
 * node skills and the public tool docs. Saved workflows, though, still carry
 * the ids a node rendered before a rename, and an MCP client may send a name
 * it read in an older doc. These tables map those spellings to the current
 * ids, keyed by node TYPE, so every reader rewires an edge the same way:
 *
 *   - the editor, when it loads a workflow (`use-workflow-store.ts`);
 *   - the server, when an MCP client writes one (`workflow-edge-normalization.ts`),
 *     and the Workflow Copilot's own edge check.
 *
 * Structural vocabulary only — no behaviour, no prompt content. A guard test
 * in the frontend fails when an alias points at a handle the node no longer
 * declares, or when a "legacy" spelling is still a declared handle.
 *
 * NOTE: five ffmpeg-overlapping nodes (merge-video-audio, trim-audio,
 * mix-audio, combine-audio, adjust-volume) are deliberately absent — their
 * ids shipped through a different migration with the single `in` retained,
 * and a second rewrite would silently double-apply.
 */
import { AUDIO_PRODUCER_TYPES, VIDEO_PRODUCER_TYPES } from "./producer-types.js"

/** Legacy SOURCE handle id → canonical id, per node type. */
export const LEGACY_SOURCE_HANDLE_ALIASES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  // Batch 1
  "generate-music": { "audio-out": "audio" },
  // Batch 2 — Suno output id normalization
  "suno-add-instrumental": { "audio-out": "audio" },
  "suno-add-vocals": { "audio-out": "audio" },
  "suno-convert-wav": { "audio-out": "audio" },
  "suno-mashup": { "audio-out": "audio" },
  "suno-replace-section": { "audio-out": "audio" },
  "suno-upload-extend": { "audio-out": "audio" },
  "suno-music-video": { "video-out": "video" },
  "suno-style-boost": { "text-out": "text" },
  "suno-separate": { "vocal-out": "vocals", "instrumental-out": "instrumental" },
  // Batch 4 — Processing output id normalization (non-ffmpeg ones only)
  "split-text": { out: "text" },
  // split-media produces dual-typed outputs; map each leg of the legacy
  // `*-out` pair to the new single-word form.
  "split-media": { "audio-out": "audio", "video-out": "video" },
  // Phase 20 — Image-producer output id normalization. Pre-migration these
  // nodes shipped a single generic `out` source handle; after the typed-handle
  // migration their source pip is the canonical type name.
  "edit-image": { out: "image" },
  "modify-image": { out: "image" },
  "image-to-image": { out: "image" },
  "upscale-image": { out: "image" },
  "remove-background": { out: "image" },
  "face-swap": { out: "video" },
  // Phase 21 — Video-producer output id normalization.
  "motion-transfer": { out: "video" },
  // Phase 22 — Upload/source-node output id normalization.
  "reference-audio": { "audio-out": "audio" },
  // Phase 24c — Compositing-stragglers output id normalization.
  "speed-ramp": { "video-out": "video" },
  "fade-video": { "video-out": "video" },
  "transcode-video": { "video-out": "video" },
  "manual-edit": { "video-out": "video" },
  "social-media-format": { "media-out": "media", "text-out": "text" },
  // Telegram Channel Feed: the pip was `out` until it took the platform's
  // text id (`text`), which its definition and docs always named.
  "telegram-channel-feed": { out: "text" },
  // Telegram Trigger: the docs once named six outputs; the component renders
  // one, `out`, and media rides it by kind on both engines.
  "telegram-trigger": { text: "out", imageUrl: "out", videoUrl: "out", audioUrl: "out" },
}

/** Legacy TARGET handle id → canonical id, per node type. */
export const LEGACY_TARGET_HANDLE_ALIASES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  // Batch 1
  "text-to-speech": { in: "prompt" },
  "text-to-audio": { in: "prompt" },
  "generate-music": { in: "prompt" },
  "audio-isolation": { in: "audio" },
  "text-to-dialogue": { in: "prompt" },
  "voice-changer": { in: "audio" },
  dubbing: { in: "audio" },
  // voice-remix / voice-design keep the legacy `audio-style` target id intact
  // — that name is hard-coded in the runtime hint composers. Only `in` moves.
  "voice-remix": { in: "audio" },
  "voice-design": { in: "prompt" },
  "forced-alignment": { in: "audio" },
  // Batch 2 — Suno target id normalization
  "suno-generate": { in: "prompt" },
  "suno-lyrics": { in: "prompt" },
  "suno-style-boost": { text: "prompt" },
  // Batch 3 — Script & Text target id normalization
  "generate-script": { in: "prompt" },
  transcribe: { in: "audio" },
  // Batch 4 — Processing target id normalization (non-ffmpeg only)
  "combine-text": { in: "text" },
  "split-text": { in: "text" },
  "split-media": { "video-in": "video", "audio-in": "audio" },
  // Phase 20 — Image-producer target id normalization.
  "face-swap": { in: "video" },
  // Phase 21 — Video-producer target id normalization.
  "video-to-video": { in: "video" },
  "video-upscale": { in: "video" },
  "extend-video": { in: "video" },
  "motion-transfer": { in: "video" },
  "lip-sync": { videoIn: "video" },
  // Phase 24c — Compositing-stragglers target id normalization.
  "after-effects": { in: "video" },
  "motion-graphics": { in: "video" },
  "lottie-overlay": { in: "video" },
  // video-composer renders ONE target pip, `in` ("Media"). An earlier table
  // sent saved edges to a `video` pip the node never had; this heals those.
  "video-composer": { video: "in" },
  "render-video": { in: "composition" },
  "speed-ramp": { in: "video" },
  "fade-video": { in: "video" },
  "transcode-video": { in: "video" },
  // (manual-edit keeps `in` as a multi-asset target.)
  "social-media-format": { "media-in": "media", "text-in": "text" },
}

/**
 * Node types whose handles are created at run time — a column per list field,
 * a lane per Router route, a slot per overlay layer, a sub-workflow's ports —
 * so an edge into them cannot be checked against the declared handle list.
 */
export const DYNAMIC_HANDLE_NODE_TYPES: ReadonlySet<string> = new Set([
  "list",
  "loop",
  "group",
  "collect",
  "router",
  "component",
  "sub-workflow",
  "sub-workflow-input",
  "sub-workflow-output",
  "selector",
  // Payload parameters become handles.
  "webhook-trigger",
  // One `variant:<id>` handle per layer.
  "image-overlay",
])

/** The canonical source handle id for a legacy spelling on this node type, or the spelling itself. */
export function canonicalSourceHandle(nodeType: string | undefined, handle: string): string {
  return (nodeType && LEGACY_SOURCE_HANDLE_ALIASES[nodeType]?.[handle]) || handle
}

/** The canonical target handle id for a legacy spelling on this node type, or the spelling itself. */
export function canonicalTargetHandle(nodeType: string | undefined, handle: string): string {
  return (nodeType && LEGACY_TARGET_HANDLE_ALIASES[nodeType]?.[handle]) || handle
}

// ---------------------------------------------------------------------------
// The classifiers that follow the tables — a target handle decided by the
// SOURCE node's type. The editor applied these on load with five private
// sets; they live beside the tables so the server's write-time pass
// (backend/src/lib/workflow-edge-normalization.ts) makes the same decision.
// ---------------------------------------------------------------------------

/** Suno nodes whose typed shape split the legacy `in` into `audio` + `prompt`. */
const SUNO_IN_CLASSIFIER_TARGETS: ReadonlySet<string> = new Set([
  "suno-cover", "suno-extend", "suno-replace-section", "suno-upload-extend",
])
/** Suno nodes with a typed `voice` target — the resolvers that wire personaId
 *  (suno-upload-extend's payload takes none). */
const SUNO_VOICE_CAPABLE_TARGETS: ReadonlySet<string> = new Set(["suno-generate", "suno-cover", "suno-extend"])
/** motion-transfer's legacy `in` took an image, a video or a text; the blanket
 *  `in → video` rewrite loses the first and the last. The editor's own list,
 *  less face-swap: its one output is a video (the source table above says so),
 *  and an image lane for it fed the resolver a video as `imageUrl`. */
const IMAGE_SOURCE_TYPES_FOR_CLASSIFIER: ReadonlySet<string> = new Set([
  "generate-image", "upload-image", "edit-image", "image-to-image",
  "modify-image", "upscale-image", "remove-background", "generate-mask",
  "scene",
])
/** Identity entities route to the `assets` typed handle (mirrors generate-video's). */
const IDENTITY_TYPES_FOR_CLASSIFIER: ReadonlySet<string> = new Set([
  "character", "face", "object", "creature", "location",
])
/** The video producers — the ONE set the canvas validators and the
 *  orchestrator read, so a node is a video source here the day it is added.
 *  (A frozen copy of the editor's list missed thirteen of them — youtube-video,
 *  face-swap, slideshow, ai-avatar, … — and sent their legacy wires to
 *  `prompt` / `audio`.) A dynamic producer (list, sub-workflow, the dual-mode
 *  media nodes) is deliberately NOT one: its lane is unknown until run time,
 *  and the rules treat it as they always did. */
const VIDEO_SOURCE_TYPES_FOR_CLASSIFIER: ReadonlySet<string> = VIDEO_PRODUCER_TYPES
/** The audio producers plus youtube-video (audio-extractable on the backend). */
const AUDIO_SOURCE_TYPES_FOR_CLASSIFIER: ReadonlySet<string> = new Set([...AUDIO_PRODUCER_TYPES, "youtube-video"])
/** Dual-mode revoice nodes: `audio` in → audio out, `video` in → video out. Their
 *  legacy `in` was both, and the table alone would send a video to `audio`. */
const DUAL_MODE_REVOICE_TARGETS: ReadonlySet<string> = new Set(["voice-changer", "voice-changer-pro", "dubbing"])

/**
 * The target handle an edge lands on AFTER the alias table, decided by the
 * source node's type. `handle` is the id after the table; `sentHandle` the id
 * as written, for the rule that only reinterprets a legacy `in`. Returns the
 * handle unchanged when no rule applies — a no-op for every typed wire.
 */
export function classifyLegacyTargetHandle(
  targetType: string | undefined,
  handle: string | null | undefined,
  sourceType: string | undefined,
  sentHandle: string | null | undefined = handle,
): string | null | undefined {
  if (!targetType) return handle
  const source = sourceType ?? ""
  // suno-voice → a Suno node with a typed voice handle: the persona ref, even
  // when the table already sent its `in` to `prompt`.
  if (
    source === "suno-voice" &&
    SUNO_VOICE_CAPABLE_TARGETS.has(targetType) &&
    (handle === "in" || handle === "prompt" || handle == null)
  ) {
    return "voice"
  }
  // Legacy `in` on the Suno continuation nodes → `audio` for an audio source, else `prompt`.
  if (SUNO_IN_CLASSIFIER_TARGETS.has(targetType) && (handle === "in" || handle == null)) {
    return AUDIO_SOURCE_TYPES_FOR_CLASSIFIER.has(source) ? "audio" : "prompt"
  }
  // motion-transfer's `video` (the table's choice for its legacy `in`) by source.
  if (targetType === "motion-transfer" && handle === "video") {
    if (IDENTITY_TYPES_FOR_CLASSIFIER.has(source)) return "assets"
    if (IMAGE_SOURCE_TYPES_FOR_CLASSIFIER.has(source)) return "image"
    if (!VIDEO_SOURCE_TYPES_FOR_CLASSIFIER.has(source)) return "prompt"
    return handle
  }
  // video-to-video / extend-video: the pre-migration `in` also took a prompt.
  if (
    (targetType === "video-to-video" || targetType === "extend-video") &&
    handle === "video" &&
    !VIDEO_SOURCE_TYPES_FOR_CLASSIFIER.has(source)
  ) {
    return "prompt"
  }
  // A legacy `in` (or no handle) on a dual-mode revoice node: the lane the source is.
  if (DUAL_MODE_REVOICE_TARGETS.has(targetType) && (sentHandle === "in" || sentHandle == null)) {
    return VIDEO_SOURCE_TYPES_FOR_CLASSIFIER.has(source) ? "video" : "audio"
  }
  return handle
}

/**
 * Source pips a component renders that its NODE_DEFINITIONS entry does not
 * declare, or declares under another name — the burn-down list of issue
 * #1877, pinned to the rendered JSX by the frontend guard
 * (node-output-handles-completeness.test.ts). The server treats these as the
 * node's real outputs: an edge on one draws; an edge on the declared-only id
 * does not, so the write-time pass moves it onto the one pip that draws. An
 * entry leaves this table the day its definition is fixed.
 */
export const RENDERED_OUTPUT_HANDLES: Readonly<Record<string, readonly string[]>> = {
  // The ffmpeg family shipped `video-out` / `audio-out` pips through a
  // different migration (single `in` retained) and was left out of the alias
  // pass on purpose.
  "add-captions": ["video-out"],
  "adjust-volume": ["audio-out", "video-out"],
  "audio-fx": ["audio-out"],
  "combine-audio": ["audio-out"],
  "loop-video": ["video-out"],
  "merge-video-audio": ["video-out"],
  "mix-audio": ["audio-out"],
  "resize-video": ["video-out"],
  "trim-video": ["video-out"],
  // Output nodes: a pass-through `out` pip the definition does not declare.
  "save-to-storage": ["out"],
  "sub-workflow-output": ["out"],
  "webhook-output": ["out"],
  // Stem separator: one declared `audio` output, a pip per stem rendered.
  "audio-separation": ["bass", "drums", "guitar", "instrumental", "other", "piano", "vocals"],
  // Dual-mode revoice: the video pip is rendered but undeclared.
  "voice-changer": ["audio", "video"],
}

/**
 * The pip that draws for a source handle a node DECLARES but does not render
 * (a `RENDERED_OUTPUT_HANDLES` node): `<handle>-out` when that is a rendered
 * pip (the ffmpeg family), else the node's single rendered pip; null when the
 * handle is not such a case, or several pips could be meant (never guessed).
 * `declaredOutputs` is the node's definition list — `NODE_HANDLES[type].outputs`
 * on the server, `NODE_DEF_MAP.get(type).outputs` in the editor. The editor
 * applies it when it LOADS a graph, the server when it WRITES one: the same
 * move, from one place.
 */
export function renderedSourceHandle(
  nodeType: string | undefined,
  handle: string | null | undefined,
  declaredOutputs: ReadonlyArray<string> | undefined,
): string | null {
  if (!nodeType || !handle) return null
  const rendered = RENDERED_OUTPUT_HANDLES[nodeType]
  if (!rendered || rendered.includes(handle) || !declaredOutputs?.includes(handle)) return null
  if (rendered.includes(`${handle}-out`)) return `${handle}-out`
  return rendered.length === 1 ? rendered[0]! : null
}
