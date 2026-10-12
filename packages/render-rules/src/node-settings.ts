/**
 * A node's configuration, by key: what a node in a publish strip set keeps (`stripUgcPublishState`).
 * Read as an ALLOWLIST: the keys its type declares (its data type's fields, inherited ones
 * included, and its default data's keys — `NODE_DATA_FIELDS`, generated from the editor's
 * declarations), the keys any node may carry (`UNIVERSAL_NODE_SETTINGS`), and a type's own extras —
 * minus what a node HOLDS rather than how it is set up, even when its type declares it:
 * - what a run left (`isRunResultKey`);
 * - its own value (`ugcPhotoValueKey`): a file's address, a library asset, an upload's file and its
 *   facts, the value an input writes when it is text or a file, a List's rows;
 * - the copies of its inputs a run wrote (`RUN_INPUT_COPY_KEYS`) and the plans rebuilt from them;
 * - a pointer that puts a library entity, a trained LoRA or a workflow-level character back on a run
 *   (`LIBRARY_POINTER_KEYS`).
 * A key no rule names is not configuration: it goes.
 */
import { getInputFieldSchema } from "@nodaro/shared"
import { NODE_DATA_FIELDS } from "./generated/node-data-fields"
import { isRunResultKey } from "./run-result-keys"

/**
 * Keys any node may carry as its setup, whatever its type declares: the editor writes them on every
 * node (its name, its field mappings, prompt text around its prompt, freeze, its place in an app's
 * inputs and outputs, a fan-out clone's origin, the prompt view, the preset it came from, its size).
 */
export const UNIVERSAL_NODE_SETTINGS: readonly string[] = [
  "label",
  "fieldMappings",
  "promptPrefix",
  "promptSuffix",
  "skipped",
  "presentationInput",
  "presentationOutput",
  "presentationVisible",
  "__expandedFrom",
  "__expandedClone",
  "__promptFinalView",
  "__activePresetId",
  "zoom",
  // A picker's display mode (its tiles or its list).
  "displayMode",
]

/** Settings a type carries that its data type does not declare. */
export const EXTRA_NODE_SETTINGS: Readonly<Record<string, readonly string[]>> = {
  // The reference a run reads (`subWorkflowReference`); the editor writes `referencedWorkflowId`.
  "sub-workflow": ["workflowId"],
  // Settings the editor and the templates write that the node's data type does not declare
  // (the template guard, tutorial-template-settings.test.ts, names any new one).
  "add-captions": ["backgroundColor", "captions", "captionStyle", "captionPosition", "auto_transcribe", "transcribe_provider"],
  "generate-video": ["cameraMotion", "sound", "motionPrompt", "mode", "kling3Mode", "kling3Sound", "cfgScale", "removeWatermark", "fps"],
  person: ["bodyProportions", "build"],
  "qa-check": ["userInput"],
  "trim-audio": ["startTime", "endTime"],
  // Levers the server's executor reads that the data type does not declare (the executor guard,
  // executor-reads-node-settings.test.ts, names any new one): video settings the editor writes,
  // and the older or API-written spellings of a setting.
  "image-to-video": ["mode", "sound", "kling3Mode", "kling3Sound", "cfgScale", "removeWatermark"],
  "text-to-video": ["mode", "sound", "kling3Mode", "kling3Sound", "cfgScale", "removeWatermark", "multiShot", "shots", "elements", "videoSize"],
  "loop-video": ["loops"],
  "mix-audio": ["volumes"],
  "resize-video": ["aspectRatio"],
  "text-to-speech": ["voice"],
  "voice-changer": ["voice"],
  slideshow: ["imageDurations", "transition"],
  "image-collage": ["imageSizes"],
  "motion-graphics": ["width", "height"],
  "suno-extend": ["continueFrom"],
  "suno-upload-extend": ["instrumental"],
  "generate-video-pro": ["suppressedCanonicalCharacterIds"],
  "reference-board": ["entityName", "entityDescription"],
  "generate-image": ["subject"],
}

/** The copies of a node's inputs its run wrote, and the plans rebuilt from them each run. */
export const RUN_INPUT_COPY_KEYS: readonly string[] = [
  // Manual Edit, After Effects: the upstream video (and assets) captured for the editor.
  "inputVideoUrl",
  "inputAssets",
  // 3D Title: the resolved background input.
  "backgroundMediaUrl",
  // Composite, After Effects, 3D Title: plans that embed the input and are rebuilt when the node runs.
  "compositePlan",
  "effectPlan",
  "titlePlan",
]

/**
 * The copies of an input one node type keeps under a key that means something else on other types:
 * Paint Mask's `sourceImageUrl` is the upstream image it was painted on (an entity's is its own
 * picture), and Generate Image's `baseImageUrl` is its own earlier result, set by "Refine from this
 * result". Each goes with the copies above, on that type only.
 */
export const RUN_INPUT_COPY_KEYS_BY_TYPE: Readonly<Record<string, readonly string[]>> = {
  "paint-mask": ["sourceImageUrl"],
  "generate-image": ["baseImageUrl"],
}

/** Is `key` a copy of an input on a `type` node (`RUN_INPUT_COPY_KEYS`, `RUN_INPUT_COPY_KEYS_BY_TYPE`)? */
export function isRunInputCopyKey(key: string, type: string): boolean {
  return RUN_INPUT_COPY_KEYS.includes(key) || (Object.hasOwn(RUN_INPUT_COPY_KEYS_BY_TYPE, type) && RUN_INPUT_COPY_KEYS_BY_TYPE[type]!.includes(key))
}

/**
 * Pointers a run follows back to the author's library: an entity's row (an entity node re-reads its
 * pictures from it), a trained LoRA (the author's likeness as a model), the workflow-level
 * character definitions a generator draws reference images from.
 */
export const LIBRARY_POINTER_KEYS: readonly string[] = [
  "characterDbId",
  "objectDbId",
  "creatureDbId",
  "locationDbId",
  "faceDbId",
  "loraReplicateVersion",
  "loraTriggerWord",
  "loraTrainingStatus",
  "characterDefinitionIds",
]

/** The upload nodes: each holds a file of the author's, and takes a link into its own input. */
export const UGC_UPLOAD_NODE_TYPES: ReadonlySet<string> = new Set(["upload-image", "upload-video", "upload-audio"])

/**
 * An upload's keys that hold or describe its file — every copy of its address, its asset, its file's
 * name and facts, and the check of it.
 */
export const UGC_PHOTO_UPLOAD_KEYS: readonly string[] = [
  "url", "r2Url", "externalUrl", "assetId", "filename", "fileSize", "mimeType", "metadata", "width", "height", "moderationStatus", "moderationReason",
]

const UPLOAD_KEYS: ReadonlySet<string> = new Set(UGC_PHOTO_UPLOAD_KEYS)
/** A key named as a file's address — the codebase's one naming rule for such a field. */
const ADDRESS_KEY = /url$|urls$|urllist$/i
/** A List's value: its rows, as each run reads them. */
const LIST_VALUE_KEYS: readonly string[] = ["items", "rows"]
/** The input-field types whose value is the node's own value: text, or a file. Select and number fields are settings. */
const VALUE_FIELD_TYPES: ReadonlySet<string> = new Set(["text", "image-url", "video-url", "audio-url"])

/** A key named as a file's address or a library asset: whatever it holds is a file. */
function addressNamedKey(key: string): boolean {
  return ADDRESS_KEY.test(key) || key === "assetId"
}

/**
 * A node's own value, however its key is named: an upload's file (every address of it, its asset, its
 * name and facts), a List's rows, the value an input writes when it is text or a file (a Text node's
 * text).
 */
export function ugcOwnValueKey(key: string, type: string): boolean {
  if (UGC_UPLOAD_NODE_TYPES.has(type) && (UPLOAD_KEYS.has(key) || addressNamedKey(key))) return true
  if (type === "list" && LIST_VALUE_KEYS.includes(key)) return true
  const field = getInputFieldSchema(type)
  return field !== undefined && field.key === key && VALUE_FIELD_TYPES.has(field.type)
}

/**
 * A key that holds a node's own value: a file's address (`…url`, `…urls`, `…urllist`), a library
 * asset, an upload's file and its facts, the value an input writes when it is text or a file (a
 * Text node's text), a List's rows. A run's own overrides on these keys are the runner's own value.
 */
export function ugcPhotoValueKey(key: string, type: string): boolean {
  return addressNamedKey(key) || ugcOwnValueKey(key, type)
}

const NOT_SETTINGS: ReadonlySet<string> = new Set([...RUN_INPUT_COPY_KEYS, ...LIBRARY_POINTER_KEYS])

/** Is this key held, not configured: a run's result, the node's value, an input copy, a library pointer? */
export function isHeldKey(key: string, type: string): boolean {
  return isRunResultKey(key, type) || ugcPhotoValueKey(key, type) || NOT_SETTINGS.has(key) || isRunInputCopyKey(key, type)
}

const settingsCache = new Map<string, ReadonlySet<string>>()
const addressSettingsCache = new Map<string, ReadonlySet<string>>()

/**
 * The keys a node of `type` keeps as its configuration (see the file comment). A type the table
 * does not know keeps the universal settings alone. With `addressSettings`, a declared key named as
 * a file's address or an asset (a Lottie's `lottieUrl`, a generator's reference images) is
 * configuration too, unless it is the node's own value: what a node made only from the video keeps,
 * its addresses cleared only where they are tainted (ugc-taint.ts).
 */
export function nodeSettingKeys(type: string, opts: { readonly addressSettings?: boolean } = {}): ReadonlySet<string> {
  const cache = opts.addressSettings ? addressSettingsCache : settingsCache
  const known = cache.get(type)
  if (known) return known
  const declared = Object.hasOwn(NODE_DATA_FIELDS, type) ? NODE_DATA_FIELDS[type]!.fields : []
  const extra = Object.hasOwn(EXTRA_NODE_SETTINGS, type) ? EXTRA_NODE_SETTINGS[type]! : []
  const held = opts.addressSettings
    ? (key: string) => isRunResultKey(key, type) || ugcOwnValueKey(key, type) || NOT_SETTINGS.has(key) || isRunInputCopyKey(key, type)
    : (key: string) => isHeldKey(key, type)
  const keys = new Set([...declared, ...UNIVERSAL_NODE_SETTINGS, ...extra].filter((key) => !held(key)))
  cache.set(type, keys)
  return keys
}

/** Is `key` part of a `type` node's configuration? */
export function isNodeSetting(key: string, type: string): boolean {
  return nodeSettingKeys(type).has(key)
}
