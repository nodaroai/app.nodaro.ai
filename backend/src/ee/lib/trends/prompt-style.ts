/**
 * A trend's prompt style and full depth's scene source (pure; no I/O).
 *
 * - `promptStyle` (`TrendVersionData.promptStyle`, stored as given): how the
 *   engine words the run's prompt, `"precise"` or `"flexible"`. Left out =
 *   Flexible for a full-depth clip, Precise for everything else
 *   (`defaultPromptStyleFor`) — exactly what an engine that predates the
 *   choice runs, so a trend that leaves it out runs the same on every engine.
 * - `faceMasking.scene` (full depth only, stored as given): where the run's
 *   scene comes from — `"description"` (the default), `"original"` (the
 *   original clip as a second video: clips up to 27.5 s) or `"none"`.
 *   It shapes the run, never the stored clip, so it is not in the settings key.
 *
 * What an engine takes is in its supports (`castSwap.promptStyles`;
 * `castSwap.fullDepthScenes`, absent = `["original"]`, what an engine before
 * the choice always does). A run sends both resolved (compose.ts) and is
 * stripped of either key an engine does not declare (`withoutUnsupportedFields`,
 * run-helpers.ts); publishing holds back a trend an environment would run
 * otherwise than it says (`promptStyleBlockers`), and a full-depth trend that
 * sends the original with a clip longer than the engines take
 * (`full_depth_clip_too_long`).
 *
 * - `promptWording` (`TrendVersionData.promptWording`, stored as given): how
 *   the engine words a FLEXIBLE prompt, `"current"` (the default) or `"new"`.
 *   A run says `"new"` only when the trend names it and its prompt style is
 *   Flexible (`trendPromptWordingSent`), so every other run's body is exactly
 *   as before; the engine prompt's request names the wording, "current"
 *   included (`trendPromptWordingNamed`); both are stripped for an engine
 *   whose `castSwap.promptWordings` does not list it (run-helpers.ts), and
 *   publishing holds back a trend that says it from such an environment
 *   (`PROMPT_WORDING_NEED`, publish-check.ts).
 *
 * HIDDEN: all three are the trend's recipe; none may reach a public response.
 */
import {
  CAST_SWAP_FULL_DEPTH_ORIGINAL_PUBLISH_MAX_SEC,
  defaultPromptStyleFor,
  fullDepthSceneSendsOriginal,
  overridesWordingPart,
  type CastSwapPromptPartId,
  type CastSwapPromptStyle,
  type CastSwapPromptWording,
} from "@nodaro/render-rules"
import { faceMaskingOn, faceMaskingSourceOf, fullDepthSceneOf, type FaceMaskingScene, type FaceMaskingSource } from "../../../lib/cast-swap-face-masking.js"
import type { TrendVersionData } from "./types.js"

/** What an engine declares about prompt styles and scenes (`castSwap`'s two fields). */
export interface PromptStyleSupports {
  readonly promptStyles?: readonly CastSwapPromptStyle[]
  readonly fullDepthScenes?: readonly FaceMaskingScene[]
}

/** How the trend prepares its clip, as a run reads it: `"faces"` when it does not mask. */
export function trendSourceOf(data: Pick<TrendVersionData, "faceMasking">): FaceMaskingSource {
  return faceMaskingOn(data.faceMasking) ? faceMaskingSourceOf(data.faceMasking) : "faces"
}

/** The prompt style a trend that names none runs with (its clip preparation's). */
export function defaultPromptStyleOf(data: Pick<TrendVersionData, "faceMasking">): CastSwapPromptStyle {
  return defaultPromptStyleFor(trendSourceOf(data))
}

/**
 * The Flex wording a run of this trend says: `"new"` when the trend names it
 * and its prompt style is Flexible (a Precise prompt never reads it);
 * undefined otherwise (the current wording: no key is sent).
 */
export function trendPromptWordingSent(data: Pick<TrendVersionData, "faceMasking" | "promptStyle" | "promptWording">): "new" | undefined {
  return data.promptWording === "new" && promptStyleOf(data) === "flexible" ? "new" : undefined
}

/**
 * The wording the trend's engine prompt request names (`promptPartsRequestFor`):
 * a Flexible trend's, "current" included (the engine lists the new wording's
 * parts only when a request names one); a Precise trend's "current" only when
 * `overrides` hold one of those parts (so it can be seen and reset); else
 * none, the request of before.
 */
export function trendPromptWordingNamed(
  data: Pick<TrendVersionData, "faceMasking" | "promptStyle" | "promptWording">,
  overrides: Readonly<Partial<Record<CastSwapPromptPartId, string>>> | undefined,
): CastSwapPromptWording | undefined {
  if (promptStyleOf(data) === "flexible") return trendPromptWordingSent(data) ?? "current"
  return overridesWordingPart(overrides) ? "current" : undefined
}

/** The trend's prompt style, resolved. */
export function promptStyleOf(data: Pick<TrendVersionData, "faceMasking" | "promptStyle">): CastSwapPromptStyle {
  return data.promptStyle ?? defaultPromptStyleOf(data)
}

/** A full-depth trend's scene source, resolved; null for any other preparation (or none). */
export function trendSceneOf(data: Pick<TrendVersionData, "faceMasking">): FaceMaskingScene | null {
  return faceMaskingOn(data.faceMasking) ? fullDepthSceneOf(data.faceMasking) : null
}

/** The scenes an engine takes; absent = the original alone (an engine before the choice). */
export function fullDepthScenesOf(cs: PromptStyleSupports | undefined): readonly FaceMaskingScene[] {
  return cs?.fullDepthScenes ?? ["original"]
}

/** Whether the engine takes `promptStyle` naming this style. */
export function engineTakesPromptStyle(cs: PromptStyleSupports | undefined, style: CastSwapPromptStyle): boolean {
  return (cs?.promptStyles ?? []).includes(style)
}

/** Whether the engine takes `faceMasking.scene` naming this scene (an engine that declares none takes no key). */
export function engineTakesScene(cs: PromptStyleSupports | undefined, scene: FaceMaskingScene): boolean {
  return (cs?.fullDepthScenes ?? []).includes(scene)
}

/** The longest source clip a full-depth trend that sends the original may publish with. */
export const FULL_DEPTH_ORIGINAL_PUBLISH_MAX_SEC = CAST_SWAP_FULL_DEPTH_ORIGINAL_PUBLISH_MAX_SEC

/** A full-depth trend that sends the original as a second video, with a source clip too long for it. */
export function fullDepthClipTooLong(data: Pick<TrendVersionData, "faceMasking" | "source">): boolean {
  return fullDepthSceneSendsOriginal(trendSceneOf(data) ?? undefined) && !!data.source && data.source.durationSec > FULL_DEPTH_ORIGINAL_PUBLISH_MAX_SEC
}

export type PromptStyleBlockerCode = "prompt_style_unsupported" | "full_depth_scene_unsupported"

const STYLE_NAMES: Readonly<Record<CastSwapPromptStyle, string>> = { precise: "Precise", flexible: "Flexible" }
const SCENE_NAMES: Readonly<Record<FaceMaskingScene, string>> = {
  description: "Description",
  original: "Original video",
  none: "None",
  "description-and-original": "Description + original",
}

/**
 * What one environment's engine would run otherwise than the trend says: a
 * prompt style other than the preparation's default it does not declare, or
 * a full-depth scene it does not take (an engine without `fullDepthScenes`
 * always sends the original).
 */
export function promptStyleBlockers(
  data: Pick<TrendVersionData, "faceMasking" | "promptStyle">,
  env: string,
  cs: PromptStyleSupports | undefined,
): Array<{ code: PromptStyleBlockerCode; env: string; need: string; message: string }> {
  const out: Array<{ code: PromptStyleBlockerCode; env: string; need: string; message: string }> = []
  const style = promptStyleOf(data)
  if (style !== defaultPromptStyleOf(data) && !engineTakesPromptStyle(cs, style)) {
    out.push({
      code: "prompt_style_unsupported",
      env,
      need: `promptStyle:${style}`,
      message: `${env}: this environment's Cast Swap engine cannot run the ${STYLE_NAMES[style]} prompt style for this clip preparation yet.`,
    })
  }
  const scene = trendSceneOf(data)
  if (scene && !fullDepthScenesOf(cs).includes(scene)) {
    out.push({
      code: "full_depth_scene_unsupported",
      env,
      need: `scene:${scene}`,
      message: `${env}: this environment's Cast Swap engine cannot take the Full depth scene "${SCENE_NAMES[scene]}" yet.`,
    })
  }
  return out
}
