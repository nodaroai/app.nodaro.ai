/**
 * A trend's engine prompt changes, re-checked at publish (the publish route,
 * admin-trends.ts): the engine (`POST /v1/cast-swap/prompt-parts`, as the
 * draft's engine prompt PUT asks it) is asked for the draft's CURRENT state —
 * its clip preparation, prompt style, scene, roles and prompts may have
 * changed since the overrides were saved — once per prompt mode a run of it
 * sends (`promptModesOf`: the full run, and the 4 s preview with its own
 * texts). The request names the trend's `source` and no `style`, which the
 * engine reads as a trend's: its length is checked with room for a run's user
 * details (`TREND_DETAILS_MAX` more post prompt, the engine's
 * `TREND_DETAILS_HEADROOM_CHARS`), never added here as well.
 *
 * Only this environment's engine can be asked, and only when it takes prompt
 * parts (`castSwap.promptParts`); otherwise nothing is checked here (the
 * publish check's `prompt_parts_unsupported` holds the trend for every
 * environment whose engine does not take them). Every problem (`part_not_used`
 * for an override the trend's mode no longer uses among them) feeds the
 * publish check's `prompt_parts_invalid` blocker.
 */
import type { FastifyInstance, FastifyRequest } from "fastify"
import { promptModesOf } from "./prompt-budget.js"
import type { TrendPromptMode } from "./prompt-parts.js"
import { promptPartTexts, promptPartsRequestFor } from "./prompt-parts-store.js"
import { loadedEngineHasPromptParts, requestPromptParts, type PromptPartsFailure } from "../cast-swap-prompt-parts.js"
import type { PromptPartsAnswer } from "../../../lib/cast-swap-prompt-parts-contract.js"
import type { TrendVersionData } from "./types.js"

/** One problem the engine found, with the prompt mode it was found in (`"preview"` only when the full run does not have it). */
export type TrendPromptPartProblem = PromptPartsAnswer["problems"][number] & { mode?: TrendPromptMode }

const keyOf = (p: PromptPartsAnswer["problems"][number]) => `${p.part ?? ""}\u0000${p.code}\u0000${p.message}`

/**
 * The draft's prompt part problems, as the engine finds them now: `problems`
 * (empty = none), null when nothing was checked (no overrides, or an engine
 * without the route), or `failure` when the engine could not answer.
 */
export async function trendPromptPartProblems(
  app: FastifyInstance,
  req: FastifyRequest,
  data: TrendVersionData,
): Promise<{ problems: TrendPromptPartProblem[] } | { failure: PromptPartsFailure } | null> {
  const texts = promptPartTexts(data.promptParts)
  if (!texts || !loadedEngineHasPromptParts()) return null
  const out: TrendPromptPartProblem[] = []
  const seen = new Set<string>()
  for (const mode of promptModesOf(data)) {
    const asked = await requestPromptParts(app, req, promptPartsRequestFor(data, texts, mode))
    if (!asked.ok) return { failure: asked.failure }
    for (const p of asked.answer.problems) {
      if (seen.has(keyOf(p))) continue
      seen.add(keyOf(p))
      out.push(mode === "full" ? p : { ...p, mode })
    }
  }
  return { problems: out }
}
