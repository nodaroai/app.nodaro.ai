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
import { CAST_SWAP_ENGINE_OF_NODARO_MOTION, type CastSwapStyle, type NodaroMotionEngine } from "@nodaro/shared/models"
import { largeDirectRun, type PromptPartTexts, type PromptPartsAnswer, type PromptPartsRequest } from "../../lib/cast-swap-prompt-parts-contract.js"
import { directRunPromptShape, type NodaroMotionMotionEntry } from "../../lib/nodaro-motion-motion.js"
import { getPluginSupports } from "../../lib/private-plugins/supports-registry.js"
import { askPromptParts } from "./cast-swap-prompt-parts.js"

/** One problem, naming the engine and style it was found for. */
export type DirectRunPromptProblem = PromptPartsAnswer["problems"][number] & { engine: NodaroMotionEngine; style: CastSwapStyle }

/** Whether the loaded engine words a direct run's prompt from the Motion setting (`castSwap.promptStyles`). */
export function loadedEngineHasPromptStyles(): boolean {
  return (getPluginSupports().castSwap?.promptStyles ?? []).length > 0
}

/** What the engine is asked for a direct run of this engine and style, with `body` (the run's roles, prompts and overrides). */
export function directRunRequest(
  engine: NodaroMotionEngine,
  style: CastSwapStyle,
  entry: NodaroMotionMotionEntry | undefined,
  body: Omit<PromptPartsRequest, "engine" | "style">,
): PromptPartsRequest {
  return {
    engine: CAST_SWAP_ENGINE_OF_NODARO_MOTION[engine],
    style,
    ...(loadedEngineHasPromptStyles() ? directRunPromptShape(style, entry) : {}),
    ...body,
  }
}

/**
 * The problems of `texts` for this engine and style on a large direct run
 * (empty = they may be saved). Null after replying (the engine could not
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
): Promise<DirectRunPromptProblem[] | null> {
  const run = largeDirectRun(CAST_SWAP_ENGINE_OF_NODARO_MOTION[engine])
  const answer = await askPromptParts(app, req, reply, directRunRequest(engine, style, entry, { ...run, overrides: texts }))
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
