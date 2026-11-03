/**
 * The named parts of the prompt Nodaro Motion (Cast Swap) writes for a run,
 * each overridable by an admin — per trend (`TrendVersionData.promptParts`)
 * and per engine and style for direct runs (the `nodaro_motion_prompt_parts`
 * setting). The engine owns each part's default text and validates every
 * override; the platform stores the overrides and sends them as text.
 * Internal only: not an Apache grant — the platform's own trend tooling, not
 * a public API.
 */

/**
 * Every prompt part, in the engine's own order (its `PROMPT_PART_IDS`). The
 * new wording's movement lock comes right after the opener here, though the
 * engine writes a Flex run's art style line before both.
 */
export const CAST_SWAP_PROMPT_PART_IDS = [
  "opener",
  "motionLock",
  "artStyle",
  "artStyleMandatory",
  "original",
  "scene",
  "quality",
  "keep",
  "audio",
  "face",
  "depthGuard",
  "faceMesh",
  "faceMeshFillNone",
  "roleOutlines",
  "person",
  "pet",
  "product",
  "location",
  "pictureRoles",
  "avoid",
  "restate",
  "postHeader",
] as const
export type CastSwapPromptPartId = (typeof CAST_SWAP_PROMPT_PART_IDS)[number]

/**
 * The placeholders each part may use, filled by the engine as it assembles
 * the prompt. `{image}` is required in every role part (`person`, `pet`,
 * `product`, `location`); any other placeholder is refused.
 */
export const CAST_SWAP_PROMPT_PART_PLACEHOLDERS: Readonly<Record<CastSwapPromptPartId, readonly string[]>> = {
  opener: ["{video}"],
  // The new Flexible wording only (`promptWording: "new"`): every person moves exactly as in the clip.
  motionLock: ["{video}"],
  // Flex (flexible) direct runs with an art style only: the style's own wording (the platform's `style` catalog).
  artStyle: ["{style}"],
  // Flex (flexible) direct runs with an art style only: the line under the style's wording that holds every frame
  // to it, worded per medium by the engine.
  artStyleMandatory: [],
  // Depth-reference runs only.
  original: ["{original}"],
  // Flexible full-depth runs whose scene is "description" only: the scene description the engine writes per run.
  scene: ["{scene}"],
  quality: [],
  keep: ["{video}"],
  audio: [],
  face: [],
  depthGuard: ["{video}"],
  // Runs whose clip has the face mesh drawn on it only (`faceMasking.faceMesh`, faces drawn > 0): what the lines mean.
  faceMesh: ["{video}"],
  // Runs whose Faces hidden fill is "none" only (the faces kept as filmed, the face mesh alone drawn on them): the
  // mesh line in place of `faceMesh`'s. Listed only when the request carries `maskFill: "none"`.
  faceMeshFillNone: ["{video}"],
  // Trends whose stored clip has role outlines drawn on it only (`faceMasking.roleOutlines`, a run sent
  // `storedFaceMask.outlines`): which colour is which role. `{outlines}` is the engine's list of them.
  roleOutlines: ["{video}", "{outlines}"],
  person: ["{name}", "{image}", "{face}", "{outfit}", "{body}", "{hair}"],
  pet: ["{name}", "{image}", "{body}", "{coat}"],
  product: ["{name}", "{image}", "{shape}", "{finish}"],
  location: ["{name}", "{image}"],
  // The new Flexible wording only, on a run with a person, pet or product role: what to take from their pictures.
  pictureRoles: ["{video}"],
  avoid: [],
  // The new Flexible wording only: the closing restatement of the movement and the looks.
  restate: ["{video}"],
  postHeader: [],
}

/**
 * How the engine words a Flexible prompt (`"current"`, today's, or `"new"`:
 * the movement lock, the picture roles, the closing restatement and the
 * avoid part as a failure list). Absent = `"current"`. Read only by the
 * Flexible prompt set: every Precise set ignores it. Set per Nodaro Motion
 * engine for direct runs (`nodaro_motion_prompt_wording`) and per trend
 * (`TrendVersionData.promptWording`); sent only to an engine whose
 * `castSwap.promptWordings` lists it.
 */
export const CAST_SWAP_PROMPT_WORDINGS = ["current", "new"] as const
export type CastSwapPromptWording = (typeof CAST_SWAP_PROMPT_WORDINGS)[number]

/**
 * The parts only the new wording writes. The engine lists them in a
 * prompt-parts answer only when the request names a wording (either one),
 * so a request that may carry an override of one names it.
 */
export const CAST_SWAP_PROMPT_WORDING_PART_IDS = ["motionLock", "pictureRoles", "restate"] as const satisfies readonly CastSwapPromptPartId[]

/** Whether `overrides` holds a non-empty text for one of the new wording's parts. */
export function overridesWordingPart(overrides: Readonly<Partial<Record<CastSwapPromptPartId, string>>> | undefined): boolean {
  return CAST_SWAP_PROMPT_WORDING_PART_IDS.some((id) => (overrides?.[id] ?? "").trim() !== "")
}

/**
 * How the engine words a run's prompt, chosen apart from how its clip is
 * prepared: `"precise"` (the edit prompt: match the source as closely as
 * possible) or `"flexible"` (a looser prompt: the clip for movement, the
 * rest from the pictures and the text).
 */
export const CAST_SWAP_PROMPT_STYLES = ["precise", "flexible"] as const
export type CastSwapPromptStyle = (typeof CAST_SWAP_PROMPT_STYLES)[number]

/**
 * Where a full-depth run's scene (setting, lighting, props, wardrobe, shots)
 * comes from, as `faceMasking.scene` names it (full depth only):
 * `"description"` (the default: the engine describes the clip on each run and
 * the description goes into the prompt's `scene` part), `"original"` (the
 * original clip is sent as a second video: clips up to 27.5 s),
 * `"description-and-original"` (both: the description in words and the
 * original as the second video, with the original's clip limit; only to an
 * engine whose `castSwap.fullDepthScenes` lists it) or `"none"` (depth only:
 * the admin writes the scene, or adds pictures).
 */
export const CAST_SWAP_FULL_DEPTH_SCENES = ["description", "original", "none", "description-and-original"] as const
export type CastSwapFullDepthScene = (typeof CAST_SWAP_FULL_DEPTH_SCENES)[number]

/** Whether a full-depth scene is written in words (the clip described: `"description"`, `"description-and-original"`). */
export function fullDepthSceneDescribes(scene: string | undefined): boolean {
  const s = scene ?? CAST_SWAP_FULL_DEPTH_SCENE_DEFAULT
  return s === "description" || s === "description-and-original"
}

/** Whether a full-depth scene sends the original as the second video (`"original"`, `"description-and-original"`): its clip limit applies. */
export function fullDepthSceneSendsOriginal(scene: string | undefined): boolean {
  const s = scene ?? CAST_SWAP_FULL_DEPTH_SCENE_DEFAULT
  return s === "original" || s === "description-and-original"
}

/** A full-depth setting's scene left out. */
export const CAST_SWAP_FULL_DEPTH_SCENE_DEFAULT: CastSwapFullDepthScene = "description"

/**
 * The longest clip a full-depth run with the original as its second video
 * takes: the engines cap reference videos at 30 s combined, and the original
 * beside the depth clip needs its 2 s and a 0.1 s margin (the cast-swap
 * plugin's `DEPTH_REFERENCE_MAX_CLIP_SEC`, refused past it as
 * `clip_too_long_for_style`). Publishing holds a trend to it with
 * `CAST_SWAP_FULL_DEPTH_ORIGINAL_SLACK_SEC` to spare (27.5 s), so a clip the
 * engine measures a little longer than its upload did (a re-encode, a depth
 * map a frame long) is never refused at run.
 */
export const CAST_SWAP_FULL_DEPTH_ORIGINAL_MAX_SEC = 27.9
export const CAST_SWAP_FULL_DEPTH_ORIGINAL_SLACK_SEC = 0.4
/** The longest source clip a full-depth trend that sends the original may publish with (27.5 s). */
export const CAST_SWAP_FULL_DEPTH_ORIGINAL_PUBLISH_MAX_SEC = CAST_SWAP_FULL_DEPTH_ORIGINAL_MAX_SEC - CAST_SWAP_FULL_DEPTH_ORIGINAL_SLACK_SEC

/**
 * A trend's prompt style when it names none: Flexible for full depth (its
 * one video has no faces or scene to match), Precise for everything else.
 */
export function defaultPromptStyleFor(source: "faces" | "full-depth" | "keep-people"): CastSwapPromptStyle {
  return source === "full-depth" ? "flexible" : "precise"
}
