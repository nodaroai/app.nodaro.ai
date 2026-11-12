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
 * video, audio, image; several = any of them, video + audio = any media; and
 * look, a JSON input: any JSON producer, `ACCEPTS_JSON`, never beside another
 * kind). The canvas judges every unit input by them
 * (frontend/src/lib/unit-connections.ts). A unit needing another kind adds its
 * rule there and its kind here in its own PR (decided 2026-10-16: a node that
 * needs a missing seam builds it).
 */
export const ACCEPTS_KINDS = ["video", "audio", "image", "look"]

/** The kinds an input taking every wire (`handles.inputs[].many: true`) may accept: media streams, each wire one source row. */
export const MANY_KINDS = ["video", "audio"]

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
 * The keys of a manifest's `contract`: the whitelist of what a unit adds to
 * @nodaro/shared (rows of packages/shared/src/generated/unit-contracts.ts) —
 * type ids, pip ids and closed vocabularies, never a price, prompt or doctrine.
 * manifest.mjs refuses any other key; use-case-rules.mjs holds each one's rules.
 */
export const CONTRACT_KEYS = ["producer", "jsonPips", "nonPromptInputs", "reviewHold", "presents", "fanOutEach"]

/**
 * The categories a unit may have today: the ones the editor's NodeCategory
 * shares with the server's (`NodeCategory` of backend/src/lib/node-registry.ts),
 * so its /v1/nodes descriptor needs no second category. A unit in another
 * category (ai, scene, character, …) adds a `registry.category` seam first.
 */
export const REGISTRY_CATEGORIES = ["input", "parameter", "processing", "output", "utility"]

/**
 * `NodeCategory` of backend/src/lib/node-registry.ts — every category /v1/nodes
 * lists. A unit whose editor category is not one of REGISTRY_CATEGORIES (ai,
 * scene, character, …) names its /v1/nodes category here in `registry.category`
 * ("ai-image" for an AI image node); a unit whose category is shared names none.
 */
export const SERVER_CATEGORIES = ["input", "parameter", "ai-image", "ai-video", "ai-audio", "ai-text", "processing", "composition", "trigger", "output", "control", "entity", "utility"]

/**
 * The output kinds that may carry a LIST (`handles.outputs[].list: true`): one
 * run's several files on one pip (each layer of a split image). An Each wire
 * runs the next node once per item; a plain wire reads the first item.
 */
export const LIST_OUTPUT_KINDS = ["image", "video", "audio"]

/** `OutputType | "none"` of backend/src/lib/node-registry.ts (`NodeDescriptor.outputType`). */
export const OUTPUT_TYPES = ["image", "video", "audio", "text", "data", "none"]

/**
 * How a node runs, and which unit files that requires:
 *   source   — nothing runs (an input or a picker-free source); no files
 *   inline   — the editor computes it (exec.ts)
 *   sync     — one HTTP call answers it (route.ts + exec.ts + api.ts)
 *   worker   — a route queues a job a worker runs (route.ts + payload.ts + worker.ts + exec.ts + api.ts)
 *   use-case — a route factory builds it into a hidden inline chain (use-case.ts + price.ee.ts; its graph builder is a USE_CASE_SPECS entry in @nodaro/render-rules)
 */
export const EXECUTION_KINDS = ["source", "inline", "sync", "worker", "use-case"]

/**
 * The input pips a use-case node may have: `UseCaseInputHandle` of
 * packages/render-rules/src/use-case-registry.ts — what routeUseCaseInput
 * routes (into useCaseMedia / useCaseMusic / useCaseIntroCard / useCaseMasterAudio).
 */
export const USE_CASE_INPUT_HANDLES = ["media", "music", "introCard", "masterAudio"]

/**
 * The add-node picker tabs a family can own (`NodeFamily["tab"]` of
 * frontend/src/lib/node-families.ts: every PickerTab but "common" and "all",
 * plus "controls") — what `picker.alsoOnTabs` may name.
 */
export const PICKER_TABS = ["image", "video", "audio", "models", "assets", "automate", "publish", "controls"]

/** What a JSON (kind "look") output pip carries: `JsonOutputDeclaration` of packages/shared/src/json-kinds.ts. */
export const JSON_PIP_KINDS = ["transcript", "edl", "other"]

/** How a published app shows a node's result (`contract.presents`): `OutputType` of packages/shared/src/presentation-utils.ts but "data". */
export const PRESENTS = ["image", "video", "audio", "text"]

/**
 * The kinds of setting a unit may expose to a published app (`appFields[].kind`,
 * tools/units/app-field-rules.mjs): each is a card the app-field system
 * already renders — `select`, a fixed list of string values (a select card),
 * and `integer`, a whole number with min / max / step (a slider card). The
 * editor maps each to its card (`UNIT_APP_FIELD_CARDS`,
 * frontend/src/components/presentation/exposable-fields.ts) and the server
 * holds a run to each (backend/src/lib/exposed-unit-field-check.ts);
 * units-vocabulary.test.ts pins this list to both. A new kind comes with its
 * card, its server check and its MCP shape, in its own PR.
 */
export const APP_FIELD_KINDS = ["select", "integer"]

/** BullMQ queues a worker unit may run on (`videoQueue` in backend/src/lib/queue.ts). */
export const QUEUES = ["video"]

/** Locales a `strings.json` key must cover: the five complete dicts. */
export const DICT_LOCALES = ["en", "he", "ja", "ko", "pt-br"]

/** Locales of the node-label tables (`labels.<locale>.ts`); English is the label itself. */
export const LABEL_LOCALES = ["he", "ja", "ko", "pt-br"]

/** Manifest values that are never a unit (out of scope for v1 units). */
export const NOT_A_UNIT = { "parameter-picker": "parameter pickers have five registries, two of them in packages — not units yet", macro: "canvas macros are not node types (CANVAS_MACROS) — never a unit" }
