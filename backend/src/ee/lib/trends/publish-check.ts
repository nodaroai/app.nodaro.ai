/**
 * Whether a trend's draft may be published, and if not, every reason why
 * (pure; the admin route reads the engine environments and calls this).
 *
 * The draft needs a source clip, at least one required slot, at least one
 * example, pictures for every slot in every example, valid data
 * (`trendVersionDataSchema`), and pre and trend prompts that leave room for
 * the user's details (`promptBudget`). And the Cast Swap engine of EVERY
 * environment in `TREND_PUBLISH_ENVIRONMENTS` must support it: the slot kinds
 * it uses, fixed references when it has some, face masking when it masks
 * (mode not "off"), a trend pre prompt when it has one, all three
 * resolutions, Full Quality and trend runs. An environment with no recorded
 * row is unknown, which blocks like an unsupported one.
 */
import type { EngineEnvironment } from "../engine-environments.js"
import { faceMaskingOn } from "../../../lib/cast-swap-face-masking.js"
import { trendVersionDataSchema } from "./schemas.js"
import { promptBudget, TREND_DETAILS_MAX } from "./prompt-budget.js"
import type { TrendResolution, TrendSlotKind, TrendVersionData } from "./types.js"

export interface PublishBlocker {
  code:
    | "source_missing"
    | "no_required_slot"
    | "no_example"
    | "example_slots_incomplete"
    | "invalid_data"
    | "prompt_budget"
    | "engine_unknown"
    | "engine_unsupported"
  env?: string
  /** What the engine lacks: a slot kind, "fixedReferences", "faceMasking", "trendPrePrompt", a resolution, "fullQuality", "trendRun" or "castSwap". */
  need?: string
  /** 1-based example, for `example_slots_incomplete`. */
  example?: number
  /** The slot keys an example has no pictures for, for `example_slots_incomplete`. */
  slots?: string[]
  /** What is wrong, for `invalid_data` and `prompt_budget`. */
  message?: string
}

const RESOLUTIONS: readonly TrendResolution[] = ["480p", "720p", "1080p"]

/** What every environment's engine must support for this draft, in report order. */
function needsOf(data: TrendVersionData): string[] {
  const kinds: TrendSlotKind[] = []
  for (const s of data.slots) if (!kinds.includes(s.kind)) kinds.push(s.kind)
  return [
    "trendRun",
    ...kinds,
    ...(data.references.length > 0 ? ["fixedReferences"] : []),
    ...(faceMaskingOn(data.faceMasking) ? ["faceMasking"] : []),
    ...(data.prePrompt ? ["trendPrePrompt"] : []),
    ...RESOLUTIONS,
    "fullQuality",
  ]
}

function missingNeeds(env: EngineEnvironment, needs: string[]): string[] {
  const cs = env.supports.castSwap
  if (!cs) return ["castSwap"]
  return needs.filter((need) => {
    if (need === "trendRun") return cs.trendRun !== true
    if (need === "fullQuality") return cs.fullQuality !== true
    if (need === "fixedReferences") return cs.fixedReferences !== true
    if (need === "faceMasking") return cs.faceMasking !== true
    if (need === "trendPrePrompt") return cs.trendPrePrompt !== true
    if ((RESOLUTIONS as readonly string[]).includes(need)) return !(cs.resolutions ?? []).includes(need as TrendResolution)
    return !(cs.roleKinds ?? []).includes(need as TrendSlotKind)
  })
}

export function publishBlockers(
  data: TrendVersionData,
  environments: readonly EngineEnvironment[],
  required: readonly string[],
): PublishBlocker[] {
  const out: PublishBlocker[] = []
  if (!data.source) out.push({ code: "source_missing" })
  if (!data.slots.some((s) => s.required)) out.push({ code: "no_required_slot" })
  if (data.examples.length === 0) out.push({ code: "no_example" })
  data.examples.forEach((ex, i) => {
    const missing = data.slots
      .filter((s) => !(Object.hasOwn(ex.slots, s.key) && (ex.slots[s.key]?.length ?? 0) > 0))
      .map((s) => s.key)
    if (missing.length > 0) out.push({ code: "example_slots_incomplete", example: i + 1, slots: missing })
  })
  const parsed = trendVersionDataSchema.safeParse(data)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    out.push({ code: "invalid_data", message: issue ? `${issue.path.join(".") || "data"}: ${issue.message}` : "Invalid trend data." })
  }
  const budget = promptBudget(data)
  const trendLen = data.trendPrompt?.length ?? 0
  if (trendLen > budget.trendPromptMax) {
    out.push({
      code: "prompt_budget",
      message: `The trend prompt is ${trendLen} characters; with the user's details (up to ${TREND_DETAILS_MAX}) the most is ${budget.trendPromptMax}.`,
    })
  } else if (budget.room < 0) {
    out.push({
      code: "prompt_budget",
      message: `The pre and trend prompts are ${(data.prePrompt?.length ?? 0) + trendLen} characters together; with the engine's own text and the user's details the most is ${budget.promptsMax}.`,
    })
  }

  const needs = needsOf(data)
  for (const env of required) {
    const row = environments.find((e) => e.env === env)
    if (!row) {
      out.push({ code: "engine_unknown", env })
      continue
    }
    for (const need of missingNeeds(row, needs)) out.push({ code: "engine_unsupported", env, need })
  }
  return out
}
