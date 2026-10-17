// tools/units/vocabulary.mjs
// The closed vocabularies a unit manifest (frontend/src/nodes/<type>/unit.json)
// may use. Built-ins only: the tools self-test job runs without npm install.
// Each list mirrors a product source of truth, and
// frontend/src/__tests__/units-vocabulary.test.ts pins it to that source, so
// a value added in the product without being added here (or the reverse)
// fails the build instead of drifting.

/** `NodeCategory` in frontend/src/types/nodes.ts. */
export const CATEGORIES = ["input", "parameter", "ai", "processing", "output", "scene", "character", "face", "object", "creature", "location", "utility"]

/** The keys of `HANDLE_COLORS` in frontend/src/lib/handle-colors.ts — what a handle carries. */
export const HANDLE_KINDS = ["text", "image", "imageRef", "endFrame", "video", "audio", "audioRef", "look", "pickerJson", "reference", "identity", "negative", "face", "mask", "approve", "list", "variables", "control"]

/**
 * The handle kinds a unit INPUT may accept today: the ones the editor has a
 * connection rule for (`unitInputAccepts` in frontend/src/lib/ffmpeg-handles.ts —
 * video, audio, or both = any media). A unit needing another kind adds its
 * rule there and its kind here in its own PR (decided 2026-10-16: a node that
 * needs a missing seam builds it).
 */
export const ACCEPTS_KINDS = ["video", "audio"]

/** What `execution.requires.kind` may name: `RequiredMediaInput.kind` of the server's payload builder. */
export const MEDIA_INPUT_KINDS = ["video", "audio", "image"]

/**
 * The producer sets of packages/shared/src/producer-types.ts a node can join
 * (`AUDIO_` / `VIDEO_` / `IMAGE_` / `DYNAMIC_PRODUCER_TYPES`). `contract.producer`
 * is the only key a unit contributes to @nodaro/shared (decided 2026-10-16):
 * a type id and its producer kind, never a price, prompt or doctrine string.
 */
export const PRODUCER_KINDS = ["audio", "video", "image", "dynamic"]

/**
 * The categories a unit may have today: the ones the editor's NodeCategory
 * shares with the server's (`NodeCategory` of backend/src/lib/node-registry.ts),
 * so its /v1/nodes descriptor needs no second category. A unit in another
 * category (ai, scene, character, …) adds a `registry.category` seam first.
 */
export const REGISTRY_CATEGORIES = ["input", "parameter", "processing", "output", "utility"]

/** `OutputType | "none"` of backend/src/lib/node-registry.ts (`NodeDescriptor.outputType`). */
export const OUTPUT_TYPES = ["image", "video", "audio", "text", "data", "none"]

/**
 * How a node runs, and which unit files that requires:
 *   source  — nothing runs (an input or a picker-free source); no files
 *   inline  — the editor computes it (exec.ts)
 *   sync    — one HTTP call answers it (route.ts + exec.ts + api.ts)
 *   worker  — a route queues a job a worker runs (route.ts + payload.ts + worker.ts + exec.ts + api.ts)
 */
export const EXECUTION_KINDS = ["source", "inline", "sync", "worker"]

/** BullMQ queues a worker unit may run on (`videoQueue` in backend/src/lib/queue.ts). */
export const QUEUES = ["video"]

/** Locales a `strings.json` key must cover: the five complete dicts. */
export const DICT_LOCALES = ["en", "he", "ja", "ko", "pt-br"]

/** Locales of the node-label tables (`labels.<locale>.ts`); English is the label itself. */
export const LABEL_LOCALES = ["he", "ja", "ko", "pt-br"]

/** Manifest values that are never a unit (out of scope for v1 units). */
export const NOT_A_UNIT = { "parameter-picker": "parameter pickers have five registries, two of them in packages — not units yet", macro: "canvas macros are not node types (CANVAS_MACROS) — never a unit" }
