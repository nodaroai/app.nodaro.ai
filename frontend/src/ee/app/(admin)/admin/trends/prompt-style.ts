/**
 * A trend's prompt style and full depth's scene source (pure), as the admin
 * editor shows them — the server's rules in backend/src/ee/lib/trends/prompt-style.ts.
 *
 * - Prompt style (`promptStyle`): Precise (the edit prompt: match the clip as
 *   closely as possible) or Flexible (looser: the clip for the movement, the
 *   rest from the pictures and the text). Left out: Flexible for Full depth,
 *   Precise otherwise.
 * - Scene (`faceMasking.scene`, Full depth only): a description the engine
 *   writes on each run (the default), the original clip as a second video
 *   (clips up to 27.5 s), or none.
 */
import {
  CAST_SWAP_FULL_DEPTH_ORIGINAL_PUBLISH_MAX_SEC,
  CAST_SWAP_FULL_DEPTH_SCENE_DEFAULT,
  defaultPromptStyleFor,
} from "@nodaro/render-rules"
import type { AdminTrendFaceMasking, AdminTrendFullDepthScene, CastSwapPromptStyleId, TrendEngineEnvironment } from "@/lib/api"
import { clipPreparationOf } from "./clip-preparation"

export const PROMPT_STYLES: ReadonlyArray<{ value: CastSwapPromptStyleId; label: string; hint: string }> = [
  { value: "precise", label: "Precise", hint: "Matches the clip as closely as possible: the engine edits it." },
  { value: "flexible", label: "Flexible", hint: "Follows the clip's movement and takes the rest from the pictures and the text, more freely." },
]

export const FULL_DEPTH_SCENES: ReadonlyArray<{ value: AdminTrendFullDepthScene; label: string; hint: string }> = [
  {
    value: "description",
    label: "Description (automatic)",
    hint: "On each run the engine describes the clip (setting, lighting, props, shots) into the prompt. No length limit.",
  },
  {
    value: "original",
    label: `Original video (up to ${CAST_SWAP_FULL_DEPTH_ORIGINAL_PUBLISH_MAX_SEC} s)`,
    hint: `The original clip is sent as a second video, and the scene comes from it. Clips up to ${CAST_SWAP_FULL_DEPTH_ORIGINAL_PUBLISH_MAX_SEC} s.`,
  },
  {
    value: "none",
    label: "None (write it yourself)",
    hint: "Depth only: describe the scene in the trend prompt, or add reference images. No length limit.",
  },
]

/** The prompt style a trend that names none runs with: its clip preparation's. */
export function defaultPromptStyleOf(m: AdminTrendFaceMasking | undefined): CastSwapPromptStyleId {
  return defaultPromptStyleFor(m && m.mode !== "off" ? clipPreparationOf(m) : "faces")
}

/** The trend's prompt style, resolved. */
export function promptStyleOfForm(form: { promptStyle?: CastSwapPromptStyleId; faceMasking?: AdminTrendFaceMasking }): CastSwapPromptStyleId {
  return form.promptStyle ?? defaultPromptStyleOf(form.faceMasking)
}

/** Full depth's scene, resolved (a description when left out). */
export function sceneOf(m: Pick<AdminTrendFaceMasking, "scene"> | undefined): AdminTrendFullDepthScene {
  return m?.scene ?? CAST_SWAP_FULL_DEPTH_SCENE_DEFAULT
}

/** The longest clip a trend that sends the original may publish with. */
export const ORIGINAL_SCENE_MAX_SEC = CAST_SWAP_FULL_DEPTH_ORIGINAL_PUBLISH_MAX_SEC

/** A Full depth trend that sends the original, with a clip too long for it (publishing is held: `full_depth_clip_too_long`). */
export function originalSceneTooLong(m: AdminTrendFaceMasking | undefined, clipSec: number | undefined): boolean {
  return !!m && m.mode !== "off" && clipPreparationOf(m) === "full-depth" && sceneOf(m) === "original" && clipSec !== undefined && clipSec > ORIGINAL_SCENE_MAX_SEC
}

/** The environments whose engine cannot run this prompt style (none for the preparation's default). */
export function environmentsLackingStyle(
  style: CastSwapPromptStyleId,
  m: AdminTrendFaceMasking | undefined,
  envs: readonly TrendEngineEnvironment[] | undefined,
): string[] {
  if (!envs || style === defaultPromptStyleOf(m)) return []
  return envs.filter((e) => !(e.supports.castSwap?.promptStyles ?? []).includes(style)).map((e) => e.env)
}

/** The environments whose engine cannot take this scene (an engine before scenes sends the original only). */
export function environmentsLackingScene(scene: AdminTrendFullDepthScene, envs: readonly TrendEngineEnvironment[] | undefined): string[] {
  if (!envs) return []
  return envs.filter((e) => !(e.supports.castSwap?.fullDepthScenes ?? ["original"]).includes(scene)).map((e) => e.env)
}
