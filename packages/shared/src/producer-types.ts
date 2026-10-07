/**
 * Producer-type sets — single source of truth for the node types whose
 * primary output is a video URL, audio URL, etc.
 *
 * Consumed by:
 *   - backend/src/services/workflow-engine/execution-graph.ts (orchestrator
 *     dispatch + asset-type tagging in payload-builder, output-extractor,
 *     inline-executor — re-exported there as VIDEO_SOURCE_TYPES /
 *     AUDIO_SOURCE_TYPES for backwards compatibility).
 *   - frontend/src/lib/generate-video-handles.ts (handle connection
 *     validation on the Generate Video node).
 *
 * Lifting these here ensures the frontend handle validator can never reject
 * a connection from a node type that the backend would happily route at
 * execution time (the prior drift bug, see issue 1 of the Task 4.1 review).
 */

/**
 * Source node types whose primary output is a video URL.
 * Mirrors the backend execution-graph VIDEO_SOURCE_TYPES verbatim.
 */
export const VIDEO_PRODUCER_TYPES: ReadonlySet<string> = new Set([
  "image-to-video",
  "video-to-video",
  "switchx", // Beeble SwitchX relight/composite
  "text-to-video",
  // Unified video node — emits videoUrl identically to i2v/t2v (its payload-builder
  // case dispatches dynamically to "image-to-video" or "text-to-video" jobName based
  // on whether a start frame is wired). Without this, getPrimaryOutput would fall
  // through to the imageUrl/videoUrl/audioUrl/text default and downstream consumers
  // could silently misroute the output.
  "generate-video",
  // Generate Video Pro — Seedance-2-family multi-segment stitch variant of
  // generate-video (same "emits videoUrl" contract; a trimmed provider +
  // handle set). Must mirror generate-video here or its output can't connect
  // downstream (the recurring "cannot connect the outputs" bug class).
  "generate-video-pro",
  // Edit Video Pro — Seedance-2-family span-replace sibling of generate-
  // video-pro (same "emits videoUrl" contract; source video + prompt in,
  // ONE video out). Must mirror generate-video-pro here or its output can't
  // connect downstream (the recurring "cannot connect the outputs" bug class).
  "edit-video-pro",
  "upload-video",
  "youtube-video",
  "combine-videos",
  "lip-sync",
  "speech-to-video",
  "motion-transfer",
  "video-upscale",
  "extend-video",
  // face-swap output is video (writes generatedVideoUrl, per-result `url`).
  // Frontend execution-graph already includes it in VIDEO_SOURCE_TYPES; this
  // entry brings the shared set in line so canvas typed-handle validation
  // doesn't reject face-swap → video-consumer edges that the orchestrator
  // would happily route at runtime.
  "face-swap",
  // Speaker View (C3.2): an EDL rendered with its speakers framed — one VIDEO
  // out (no audio-only render). Registered in RENDER_NODE_TYPES as well.
  "speaker-view",
  "video-retake",
  // video-sfx: adds an SFX track to a video → emits a video URL. Belongs here so
  // canvas handle validation accepts video-sfx → video-consumer edges and the
  // backend routes its output as video (it was previously relying on a fallback).
  "video-sfx",
  "suno-music-video",
  "merge-video-audio",
  "add-captions",
  "resize-video",
  "social-media-format",
  "trim-video",
  "render-video",
  "speed-ramp",
  "loop-video",
  "fade-video",
  "transcode-video",
  "manual-edit",
  // Remove Audio: strips the audio track, emits a silent video.
  "remove-audio",
  // AI Avatar (HeyGen): avatar + voice/audio → video.
  "ai-avatar",
  // Cinematic Avatar (HeyGen cinematic_avatar): prompt + 1–3 avatar looks → video.
  "cinematic-avatar",
  // Assemble Narrated Video: fits N (clip, voice) blocks into one MP4 → video.
  "assemble-narrated-video",
  // Still to Video: one still image + one audio track → MP4 (local FFmpeg,
  // no provider). Emits generatedVideoUrl like every other ffmpeg video node.
  "still-to-video",
  // Slideshow: 2-100 stills + one optional audio track → MP4 (local FFmpeg,
  // no provider). Same contract; images arrive via the image-collage lane.
  "slideshow",
  // GIF to Video: animated GIF → H.264 MP4 (local FFmpeg, no provider).
  // Emits generatedVideoUrl so it connects to any downstream video consumer
  // (e.g. a Seedance video-reference input) by an ordinary edge.
  "gif-to-video",
  // 3D Render Pro: authors a scene AND exports it in one operation, settling
  // with the standard `videoUrl` field. It is a video producer as much as it
  // is a composition producer — omitting it here is the "cannot connect the
  // outputs" bug, and its `composition` handle is typed separately.
  "pro-3d-render",
  // Video Overlay: timed image layers over a video in one local FFmpeg pass
  // (the base audio copied) — emits a video URL on `video-out`.
  "video-overlay",
])

/**
 * Source node types whose output media-type cannot be classified
 * statically — iterators, dynamic dispatchers, sub-workflow wrappers.
 * The orchestrator decides their actual output type at execution time
 * based on what's wired upstream (loop iterates upstream column type;
 * sub-workflow emits its leaf node's type; adjust-volume passes through
 * video or audio based on its `lastInputType` runtime field;
 * voice-changer emits audio in audio mode, video+audio in video mode).
 *
 * Typed-handle validators (frontend/src/lib/{generate-image,generate-
 * video,ffmpeg}-handles.ts) must include these as acceptors on EVERY
 * media-typed input handle — otherwise the canvas validator hard-
 * rejects edges that the orchestrator would happily route at runtime.
 *
 * Lifted here from `frontend/src/lib/ffmpeg-handles.ts` (where the
 * escape hatch was first added) so the same set drives ALL handle
 * validators uniformly. Adding a new dynamic-output node type means
 * one edit here instead of N across sibling validator files.
 *
 * Intentionally OMITTED:
 *  - `webhook-trigger` / `schedule-trigger` — their outputs are
 *    user-defined JSON shapes, not media URLs. Accepting them as
 *    media producers creates false-positive drops at the canvas
 *    that fail at execution. Users wanting trigger → media flows
 *    should wire through an upload node.
 */
export const DYNAMIC_PRODUCER_TYPES: ReadonlySet<string> = new Set([
  "list",
  "sub-workflow",
  "adjust-volume",
  // Dual-mode: audio in → audio out; video in → video out (+ revoiced audio).
  // Listed here so canvas validators accept its output on BOTH audio and video
  // input handles (it also stays in AUDIO_PRODUCER_TYPES as its default).
  "voice-changer",
  // voice-changer-pro (renamed from voice-recast in #3581) is a behavioral
  // twin of voice-changer — identical dual-mode output. Must mirror it in
  // EVERY producer set or its outputs can't connect (was the "cannot connect
  // the outputs of voice-changer-pro" bug). Guarded by producer-types.test.ts.
  "voice-changer-pro",
  // Dubbing joined the dual-mode family with the full-surface upgrade:
  // audio in → dubbed audio; video in (or a video sourceUrl) → dubbed VIDEO
  // (+ audio sidecar). Same wiring contract as voice-changer; stays in
  // AUDIO_PRODUCER_TYPES as its default. Explicitly asserted in
  // producer-types.test.ts (the suite does not fail on omission).
  "dubbing",
  "reduce",
  // Dual-output time chunker (UI label "Split into Chunks"; type id stays
  // "split-media"): video in → video chunks, audio in → audio chunks — two
  // independent lanes on two output handles. Like voice-changer, the canvas
  // validator only sees the source NODE type, not which handle a wire leaves,
  // so it lives here to be accepted on BOTH audio and video input handles. The
  // backend routes the correct lane by sourceHandle in getPrimaryOutput
  // (output-extractor.ts); the frontend does so in extractNodeOutput.
  "split-media",
  // apply-edl renders an EDL into ONE media output whose type is decided at
  // run time by the node's `output` setting (video OR audio) — so its static
  // medium is genuinely unknown and it belongs here, letting canvas validators
  // accept its default media handle on BOTH audio and video input handles. It
  // ALSO emits a fixed `json` handle (the remapped Transcript); that half lives
  // in JSON_PRODUCER_TYPES (frontend/src/lib/data-handles.ts). The FIRST node
  // with both a dynamic media handle and a fixed json handle. Because
  // getOutputType (presentation-utils.ts) deliberately returns "data" for
  // DYNAMIC members, apply-edl is ALSO added to the literal VIDEO_OUTPUT_TYPES
  // there so a published app renders the cut as video, mirroring the
  // voice-changer/dubbing precedent. Asserted in producer-types.test.ts (the
  // suite does not fail on omission).
  "apply-edl",
])

/**
 * Source node types whose primary output is an audio URL.
 * Mirrors the backend execution-graph AUDIO_SOURCE_TYPES verbatim.
 */
export const AUDIO_PRODUCER_TYPES: ReadonlySet<string> = new Set([
  "text-to-speech",
  "text-to-audio",
  "generate-music",
  "upload-audio",
  "suno-generate",
  "suno-cover",
  "suno-extend",
  "suno-separate",
  "audio-separation",
  "suno-mashup",
  "suno-replace-section",
  "suno-add-instrumental",
  "suno-add-vocals",
  "suno-convert-wav",
  "suno-upload-extend",
  "trim-audio",
  "mix-audio",
  "combine-audio",
  "adjust-volume",
  "audio-fx",
  "reference-audio",
  "audio-isolation",
  "text-to-dialogue",
  "voice-changer",
  // Twin of voice-changer (see DYNAMIC_PRODUCER_TYPES note). Audio is its
  // default output mode; video mode is handled via DYNAMIC membership.
  "voice-changer-pro",
  "dubbing",
  "voice-remix",
  "voice-design",
  // Extract Audio: demuxes a video's audio track to a standalone MP3.
  "extract-audio",
])

/**
 * Source node types whose output is an IMAGE URL — what feeds a References
 * input. ONE set for the canvas validators (`frontend/src/lib/
 * generate-image-handles.ts` re-exports it), the backend's Generate Image
 * handle migration and the MCP edge normalizer (`llm-chat`'s legacy `in`):
 * they used to keep separate copies, and the backend's lagged by eight types.
 */
export const IMAGE_PRODUCER_TYPES: ReadonlySet<string> = new Set([
  "upload-image", "generate-image", "edit-image", "image-to-image", "modify-image", "upscale-image", "remove-background",
  // extract-frame produces a single still image extracted from a video source.
  "extract-frame",
  // generate-mask emits the source image AND a mask PNG; its `image` source
  // pip is the passthrough (the same image as the input).
  "generate-mask",
  // paint-mask emits the hand-painted mask PNG (a plain image at runtime).
  // Membership is what makes mask targets accept it — mask is an advisory
  // color, not a gated type.
  "paint-mask",
  // reference-sheet's `sheet` is one composited image and `panels` carries
  // clean reference images; both resolve to image URLs at runtime.
  "reference-sheet",
  // reference-board's `image` pip emits a real generated board image.
  "reference-board",
  // image-collage composites N images → ONE image.
  "image-collage",
  // image-overlay places layers on a base → ONE image.
  "image-overlay",
  // 3D Render Pro's `stills` handle carries one PNG per shot of the exported
  // composition (spread into referenceImageUrls like reference-sheet
  // `panels`). A validator sees only the source NODE type, so this also makes
  // its `video` pip droppable on an image input — the handle-blind trade
  // reference-sheet and split-media already make; the input resolvers route
  // by handle, so only `stills` becomes an image at runtime. Deliberately NOT
  // in IMAGE_SOURCE_TYPES on either engine: that set types the node's PRIMARY
  // asset, and 3D Render Pro's is the MP4.
  "pro-3d-render",
])

/**
 * Source node types whose primary output is a LIST that, by default, fans out
 * one downstream execution per element when an edge leaves them WITHOUT an
 * explicit `outputMode` (all other edges default to "last"). `selector` is
 * included because its picked/rest channels are lists too.
 *
 * Single source of truth for the fan-out "each" default, consumed by:
 *   - backend/src/services/workflow-engine/input-resolver.ts (DEFAULT_EACH_TYPES)
 *   - frontend/src/components/editor/workflow-editor/types.ts (FAN_OUT_EACH_TYPES)
 *   - frontend/src/components/editor/workflow-editor/node-input-resolver.ts
 *
 * These three previously kept independent copies; the backend copy drifted
 * (missing the four list-transform types), so server-side workflow runs
 * silently dropped all-but-the-first item for filter-list / deduplicate /
 * merge-lists / sort-list sources while the canvas fanned out N ways. Lifting
 * the set here makes that drift impossible.
 */
export const FAN_OUT_EACH_TYPES: ReadonlySet<string> = new Set([
  "list",
  "split-text",
  "filter-list",
  "deduplicate",
  "merge-lists",
  "sort-list",
  "selector",
  // edit-plan `clips` mode emits a bare `Edl[]` on `data.generatedJson`, so an
  // edge leaving it defaults to "each" — one downstream execution (typically an
  // apply-edl render) per clip. The `tighten`/`chapters` modes emit an OBJECT,
  // for which the list extractors return undefined, so an "each" edge falls back
  // to the scalar `edl` value (no fan-out) — the same graceful degradation
  // web-scrape relies on. See `unwrapEditPlanOutput` in `edit-plan-contract.ts`.
  "edit-plan",
  // Content Ideas emits one creative brief per idea on `listResults`, so an
  // edge leaving it defaults to "each" — the node after it (typically
  // Generate Script) runs once per idea, on the server too.
  "content-ideas",
])

/**
 * Per-HANDLE "each" defaults, for a node whose outputs differ in kind: on the
 * `each` handles an edge without an explicit `outputMode` defaults to "each",
 * on its other handles to "last". `primary` is the handle an edge with no
 * `sourceHandle` reads (agent-written workflow JSON often omits it).
 *
 * The list an "each" edge reads is the node's per-iteration results
 * (`listResults`) — it exists only when the node itself ran once per item, so
 * after a single run the edge degrades to the single value, exactly like a
 * `FAN_OUT_EACH_TYPES` member with one item.
 */
export const FAN_OUT_EACH_HANDLES: Readonly<Record<string, { readonly each: readonly string[]; readonly primary: string }>> = {
  // Camera Switch run once per clip (Edit Plan in clips mode): each clip's
  // switched EDL is its own Apply EDL render. Its transcript is the same for
  // every clip (the master clock, renamed), so that handle stays one value
  // (decided 2026-10-04).
  "camera-switch": { each: ["edl"], primary: "edl" },
}

/**
 * Fan-out nodes whose iterations must ALL succeed: one failed item fails the
 * node (today's rule tolerates a partial list). UGC Clip — a missing clip
 * silently drops a beat from the script (spec R17). Already-started items
 * finish and settle; their jobs are reused on the next run.
 */
export const FAN_OUT_ALL_OR_NOTHING_TYPES: ReadonlySet<string> = new Set(["ugc-clip"])

/**
 * Nodes whose saved list is the list their last run PRODUCED — `__listResults`
 * (Extract Field's JSON value on `generatedJson`) — and never a history in
 * `generatedResults`: Extract Field and JSON Process. No run of either writes
 * one; earlier builds' server runs did (the run's text, the links of a list of
 * links), and both engines' list readers leave it out for these two (decided
 * 2026-10-05). Single source of truth for the backend engine and the editor.
 */
export const OWN_LIST_NODE_TYPES: ReadonlySet<string> = new Set(["extract-field", "json-process"])

/** Whether a node's saved list is its own `__listResults`, never a history. */
export function ownsItsList(nodeType: string | null | undefined): boolean {
  return typeof nodeType === "string" && OWN_LIST_NODE_TYPES.has(nodeType)
}

/** The `outputMode` an edge has when none is set on it — the ONE rule both
 *  engines, the credit estimate and the editor read. */
export function defaultEdgeOutputMode(
  sourceType: string | null | undefined,
  sourceHandle: string | null | undefined,
): "each" | "last" {
  if (typeof sourceType !== "string") return "last"
  if (FAN_OUT_EACH_TYPES.has(sourceType)) return "each"
  const entry = FAN_OUT_EACH_HANDLES[sourceType]
  if (!entry) return "last"
  return entry.each.includes(sourceHandle || entry.primary) ? "each" : "last"
}

/** Whether an edge from `sourceHandle` reads the node's per-iteration results
 *  (`listResults` — each iteration's PRIMARY output). False on the other
 *  handles of a `FAN_OUT_EACH_HANDLES` node: Camera Switch's transcript is one
 *  value, never the list of switched EDLs, whatever mode its edge is set to. */
export function listResultsServeHandle(
  sourceType: string | null | undefined,
  sourceHandle: string | null | undefined,
): boolean {
  const entry = typeof sourceType === "string" ? FAN_OUT_EACH_HANDLES[sourceType] : undefined
  return !entry || entry.each.includes(sourceHandle || entry.primary)
}

/**
 * FAN-IN targets: nodes that FOLD everything wired into them into ONE run,
 * instead of running once per upstream item. Keyed by node type; the value
 * names the target handles that fold (`"*"` = every handle). An edge into any
 * other handle of such a node is routed normally — Content Ideas folds its
 * recipes but reads its brand from a `field-brand` wire like any field.
 *
 * Single source of truth for both engines' input resolvers (the backend and
 * the editor each used to keep a private `new Set(["reduce"])`). A fan-in
 * node is never itself fanned out by an upstream list.
 */
export const FAN_IN_TARGETS: Readonly<Record<string, "*" | readonly string[]>> = {
  // Choose Best — every wire is a candidate.
  reduce: "*",
  // Content Ideas — one or more recipes, from several Content Recipe nodes
  // and/or one that ran once per post.
  "content-ideas": ["recipes"],
  // Telegram Reply — one message per run, whatever is wired into its text
  // input: a list (or a writer that ran once per item) arrives as one
  // message, never as a burst of sends to the owner's chat.
  "telegram-account-send": ["in"],
  // The list operators — they READ the whole list wired into them (their
  // executors collect every upstream item themselves) and emit a list. Run
  // once per item by an "each" wire (a Split Text, a List, a node that ran per
  // item), every iteration saw the same whole list and answered with its
  // first match: a Filter List fed 11 stories handed 11 copies of story one
  // downstream, and every paid stage after it ran 11 times on it
  // (2026-10-06). A list operator is never fanned out, on any wire.
  "filter-list": "*",
  deduplicate: "*",
  "merge-lists": "*",
  "sort-list": "*",
  selector: "*",
}

export function isFanInNodeType(nodeType: string | undefined | null): boolean {
  return typeof nodeType === "string" && Object.prototype.hasOwnProperty.call(FAN_IN_TARGETS, nodeType)
}

/** True when an edge into `targetHandle` of a `targetType` node is folded.
 *  An edge with NO target handle (workflow JSON written by an agent often
 *  omits it) lands on the node's primary input, which is the folding one. */
export function isFanInEdge(targetType: string | undefined | null, targetHandle: string | null | undefined): boolean {
  if (!isFanInNodeType(targetType)) return false
  const spec = FAN_IN_TARGETS[targetType as string]!
  if (spec === "*") return true
  return targetHandle == null || targetHandle === "" || spec.includes(targetHandle)
}
