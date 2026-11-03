/**
 * The check a save of Nodaro Motion's direct-run prompt part overrides passes
 * (admin-nodaro-motion-prompt-parts.ts), and a save of the Motion setting
 * re-runs on the Motion overrides already saved (admin-nodaro-motion-motion.ts):
 * the engine's problems for one engine and style on a LARGE direct run
 * (`largeDirectRun`: every role, picture and fixed reference the run takes,
 * the longest names and lines, and room for the user — a pre and a post
 * prompt of `DIRECT_RUN_USER_PROMPT_ROOM` characters each). Every problem
 * blocks, `prompt_too_long` included; a rarer, longer user prompt is refused
 * at run, as the user's to fix.
 *
 * The engine is asked with the prompt shape a direct run of the style uses
 * (`directRunPromptShape`, from the Motion setting `entry` — the one being
 * saved, or the saved one) only when it declares `castSwap.promptStyles`; an
 * older one is asked exactly as before (its parts follow `style` alone).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { CAST_SWAP_ENGINE_OF_NODARO_MOTION, CAST_SWAP_FACE_MASKING_DEFAULTS, type CastSwapStyle, type NodaroMotionEngine } from "@nodaro/shared/models"
import { largeDirectRun, type PromptPartTexts, type PromptPartsAnswer, type PromptPartsRequest } from "../../lib/cast-swap-prompt-parts-contract.js"
import {
  NODARO_MOTION_MOTION_DEFAULT_PROMPT_STYLE,
  directRunDepthLook,
  directRunDrawsFaceMesh,
  directRunPromptShape,
  type NodaroMotionMotionEntry,
} from "../../lib/nodaro-motion-motion.js"
import { depthColormapSent, faceMeshOn, faceMeshPartsSent, type FaceMasking } from "../../lib/cast-swap-face-masking.js"
import { getPluginSupports } from "../../lib/private-plugins/supports-registry.js"
import { loadedEngineTakesShotList, type CastSwapSteps } from "../../lib/cast-swap-steps.js"
import { overridesWordingPart, type CastSwapPromptWording } from "@nodaro/render-rules"
import { engineTakesPromptWording, type NodaroMotionPromptWording } from "../../lib/nodaro-motion-prompt-wording.js"
import { readNodaroMotionPromptWording } from "../../lib/nodaro-motion-prompt-wording-store.js"
import { askPromptParts } from "./cast-swap-prompt-parts.js"

/** One problem, naming the engine and style it was found for. */
export type DirectRunPromptProblem = PromptPartsAnswer["problems"][number] & { engine: NodaroMotionEngine; style: CastSwapStyle }

/** Whether the loaded engine words a direct run's prompt from the Motion setting (`castSwap.promptStyles`). */
export function loadedEngineHasPromptStyles(): boolean {
  return (getPluginSupports().castSwap?.promptStyles ?? []).length > 0
}

/**
 * What the engine is asked for a direct run of this engine and style, with
 * `body` (the run's roles, prompts and overrides). `preciseMasking` is the
 * engine's masking setting (`nodaro_motion_masking`): a run that draws the
 * face mesh says so (`faceMesh: true`, `directRunDrawsFaceMesh`), so the
 * engine counts the mesh's line (sent only to an engine that draws it,
 * `forLoadedEngine`). `steps` is the engine's steps setting
 * (`nodaro_motion_steps`): a Precise run whose shot list is on says so
 * (`shotList: true`). On an engine with the shot list (`castSwap.shotList`) a
 * Flex run is Full depth with a shot list whatever the Motion setting's
 * masking (`directRunPromptShape`). `wording` is the engine's Flex prompt
 * wording (`nodaro_motion_prompt_wording`, or a preview's choice): `"new"` is
 * said only for a Flex (`motion`) run worded Flexible (`flexRunWording`) —
 * never for Precise — and the request names its wording
 * (`promptWordingNamed`), reaching only an engine that lists it
 * (`forLoadedEngine`).
 */
export function directRunRequest(
  engine: NodaroMotionEngine,
  style: CastSwapStyle,
  entry: NodaroMotionMotionEntry | undefined,
  body: Omit<PromptPartsRequest, "engine" | "style">,
  preciseMasking?: FaceMasking,
  steps?: CastSwapSteps,
  wording?: CastSwapPromptWording,
): PromptPartsRequest {
  const shotList = loadedEngineTakesShotList()
  const named = promptWordingNamed(style, entry, wording, body.overrides)
  return {
    engine: CAST_SWAP_ENGINE_OF_NODARO_MOTION[engine],
    style,
    ...(loadedEngineHasPromptStyles() ? directRunPromptShape(style, entry, { shotList }) : {}),
    ...(directRunDrawsFaceMesh(style, entry, preciseMasking, { shotList }) ? { faceMesh: true as const } : {}),
    // A depth drawn in another map than its source's default: the defaults naming the depth look worded by it.
    ...directRunDepthLook(style, entry, preciseMasking, { shotList }),
    // The engine's Precise shot list on (its steps setting): the marker in its place.
    ...(style === "precise" && steps?.shotList?.precise?.mode === "on" ? { shotList: true as const } : {}),
    // The Flex wording a run of this style is worded with (named so the engine lists the new wording's parts).
    ...(named ? { promptWording: named } : {}),
    ...body,
  }
}

/**
 * The wording a prompt-parts request for a direct run of `style` names: a
 * Flex run worded Flexible, its wording (`flexRunWording`, "current"
 * included); any other run, "current" only when `overrides` hold one of the
 * new wording's parts (so the engine lists it, and the override can be seen
 * and reset); else none, the request of before.
 */
export function promptWordingNamed(
  style: CastSwapStyle,
  entry: NodaroMotionMotionEntry | undefined,
  wording: CastSwapPromptWording | undefined,
  overrides: PromptPartTexts | undefined,
): CastSwapPromptWording | undefined {
  if (style === "motion" && (entry?.promptStyle ?? NODARO_MOTION_MOTION_DEFAULT_PROMPT_STYLE) === "flexible") return flexRunWording(style, entry, wording)
  return overridesWordingPart(overrides) ? "current" : undefined
}

/**
 * The wording a direct run of `style` is worded with: `wording` (the
 * engine's setting) for a Flex (`motion`) run whose prompt style is
 * Flexible (the Motion setting's, left out = Flexible); `"current"` for every
 * other run, Precise above all.
 */
export function flexRunWording(
  style: CastSwapStyle,
  entry: NodaroMotionMotionEntry | undefined,
  wording: CastSwapPromptWording | undefined,
): CastSwapPromptWording {
  if (style !== "motion") return "current"
  if ((entry?.promptStyle ?? NODARO_MOTION_MOTION_DEFAULT_PROMPT_STYLE) !== "flexible") return "current"
  return wording === "new" ? "new" : "current"
}

/**
 * The saved Flex prompt wording per engine (`nodaro_motion_prompt_wording`),
 * read only when this environment's engine words a Flex prompt the new way
 * (`castSwap.promptWordings` lists "new"): an engine without it is never
 * sent a wording, so its checks need no read. Pass each engine's
 * (`promptWordingOf`) to `directRunRequest` / `directRunPromptProblems`, so
 * an override is checked worded as the engine's direct Flex runs are.
 */
export async function savedFlexWording(): Promise<NodaroMotionPromptWording | null> {
  if (!engineTakesPromptWording(getPluginSupports().castSwap, "new")) return null
  return (await readNodaroMotionPromptWording()).promptWording
}

/**
 * The problems of `texts` for this engine and style on a large direct run
 * (empty = they may be saved), worded in `wording` (the engine's saved Flex
 * wording, `savedFlexWording`; a Precise check ignores it). Null after replying (the engine could not
 * be asked or answered unusably).
 */
export async function directRunPromptProblems(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
  engine: NodaroMotionEngine,
  style: CastSwapStyle,
  texts: PromptPartTexts,
  entry: NodaroMotionMotionEntry | undefined,
  preciseMasking?: FaceMasking,
  steps?: CastSwapSteps,
  wording?: CastSwapPromptWording,
): Promise<DirectRunPromptProblem[] | null> {
  const run = largeDirectRun(CAST_SWAP_ENGINE_OF_NODARO_MOTION[engine])
  const answer = await askPromptParts(app, req, reply, directRunRequest(engine, style, entry, { ...run, overrides: texts }, preciseMasking, steps, wording))
  if (!answer) return null
  return answer.problems.map((p) => ({ ...p, engine, style }))
}

/** Reply 422 `prompt_parts_invalid` with every problem (nothing was saved). */
export function directRunPromptPartsInvalid(reply: FastifyReply, problems: readonly DirectRunPromptProblem[], message?: string) {
  return reply.status(422).send({
    error: {
      code: "prompt_parts_invalid",
      message: message ?? problems[0]?.message ?? "These prompt parts cannot be used.",
      problems,
    },
  })
}

/** What of an engine's Precise masking setting shapes its direct runs' prompt; null while it masks nothing (off). */
function promptShapeOf(m: FaceMasking | undefined) {
  if (!m || m.mode === "off") return null
  const mesh = faceMeshOn(m)
  return {
    mesh,
    fill: m.fill ?? CAST_SWAP_FACE_MASKING_DEFAULTS.fill,
    colormap: depthColormapSent(m) ?? null,
    parts: mesh ? (faceMeshPartsSent(m) ?? null) : null,
  }
}

/**
 * Whether saving `after` over `before` (an engine's Precise masking setting)
 * may make its direct runs' prompt longer, so the saved prompt overrides are
 * checked again: the masking turned on, the face mesh turned on, or the fill
 * (a fill's guard; the fill none's mesh line in place of the masked heads'),
 * the depth colormap or the face mesh's parts changed. Turning the mesh off,
 * or the masking off, only shortens it: not checked.
 */
export function directRunPromptMayGrow(before: FaceMasking | undefined, after: FaceMasking | undefined): boolean {
  const a = promptShapeOf(after)
  if (!a) return false
  const b = promptShapeOf(before)
  if (!b) return true
  return (a.mesh && !b.mesh) || a.fill !== b.fill || a.colormap !== b.colormap || a.parts !== b.parts
}
