/**
 * The named parts of the prompt Nodaro Motion (Cast Swap) writes for a run,
 * each overridable by an admin — per trend (`TrendVersionData.promptParts`)
 * and per engine and style for direct runs (the `nodaro_motion_prompt_parts`
 * setting). The engine owns each part's default text and validates every
 * override; the platform stores the overrides and sends them as text.
 * Internal only: not an Apache grant — the platform's own trend tooling, not
 * a public API.
 */

/** Every prompt part, in the order the engine assembles them. */
export const CAST_SWAP_PROMPT_PART_IDS = [
  "opener",
  "original",
  "scene",
  "quality",
  "keep",
  "audio",
  "face",
  "depthGuard",
  "person",
  "pet",
  "product",
  "location",
  "avoid",
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
  // Depth-reference runs only.
  original: ["{original}"],
  // Flexible full-depth runs whose scene is "description" only: the scene description the engine writes per run.
  scene: ["{scene}"],
  quality: [],
  keep: ["{video}"],
  audio: [],
  face: [],
  depthGuard: ["{video}"],
  person: ["{name}", "{image}", "{face}", "{outfit}", "{body}", "{hair}"],
  pet: ["{name}", "{image}", "{body}", "{coat}"],
  product: ["{name}", "{image}", "{shape}", "{finish}"],
  location: ["{name}", "{image}"],
  avoid: [],
  postHeader: [],
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
 * original clip is sent as a second video: clips up to 27.5 s) or
 * `"none"` (depth only: the admin writes the scene, or adds pictures).
 */
export const CAST_SWAP_FULL_DEPTH_SCENES = ["description", "original", "none"] as const
export type CastSwapFullDepthScene = (typeof CAST_SWAP_FULL_DEPTH_SCENES)[number]

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
