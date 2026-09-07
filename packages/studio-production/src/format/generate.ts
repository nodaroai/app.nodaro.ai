import { buildFormatRegistry } from "./registry"
import { renderStructuralJsonSchema } from "./json-schema"
import { renderSystemPrompt } from "./render-skill"
import type { LookSelectionMap } from "../shot"
import type { LlmStructuredBody as LlmStructuredInput } from "../llm-structured-body"

/**
 * "Prompt → production" — the WIRE half of a draft: the brief plus the
 * registry-rendered skill, shaped for the platform's generic forced-schema
 * route. Studio sends it to the ASYNC run route, `llm.structuredJob`, through
 * `useStartDirectorRun` (spec 2026-09-02 D15: a draft is a resumable platform
 * run, never a synchronous minutes-long request). The output is NOT trusted:
 * it goes through `importProduction` like a pasted file (one validator).
 *
 * The schema on the wire is the STRUCTURAL one (no enums, D6): the platform
 * measured the full legend at ~53k tokens, so the vocabulary rides the system
 * prompt once and enforcement is the importer's repair step.
 */

/** D10 — Fable is the default; Astra and Flash 3.8 are the other two the toggle
 *  offers. ONE union for the dialog's toggle, the run request and the run row's
 *  Retry (a stored `llmModel` outside this list is not retried — it is not a
 *  model the toggle offers, unless `LEGACY_LLM_MODEL_ALIASES` maps it onto one). */
export type LlmModel = "claude-fable-5" | "gpt-6-astra" | "gemini-3.8-flash"
export const LLM_MODELS: ReadonlyArray<LlmModel> = ["claude-fable-5", "gpt-6-astra", "gemini-3.8-flash"]
export const DEFAULT_LLM_MODEL: LlmModel = "claude-fable-5"

/** ROLLOUT RULE (CLAUDE.md: platform changes must be LIVE on the target
 *  environment before studio adopts them). Every id above is the PLATFORM's own
 *  LLM-registry id: `llm.structuredJob` rejects an id its registry doesn't know
 *  with a 400 `validation_error`, and nothing client-side can soften that —
 *  `GET /v1/models` enumerates image/video/audio models only, so studio has no
 *  listing to hide an unknown pick behind. `gpt-6-astra` and `gemini-3.8-flash`
 *  were registered platform-side on 2026-09-06 (app repo, KIE lanes); that
 *  change must be live on the environment this build talks to — next.nodaro.ai
 *  for staging, app.nodaro.ai for prod — BEFORE studio ships there, or both new
 *  picks (and every stored `gpt-5.6-sol` run's Retry, which the alias below now
 *  sends as Astra) 400 instead of drafting. Adding a fourth model carries the same
 *  order: platform first, studio second. */

/** Models the toggle USED to offer, each mapped onto the model that REPLACED it,
 *  so a run stored under the old id keeps its Retry instead of losing it the day
 *  the option went away: `gpt-5.6-sol` → `gpt-6-astra` (2026-09-06 — Astra took
 *  Sol's slot as the premium OpenAI generator). An id that is neither current nor
 *  aliased still has no retry: studio would be guessing which model the user
 *  meant, and the route 400s on an `llmModel` its registry doesn't know. */
export const LEGACY_LLM_MODEL_ALIASES: Readonly<Record<string, LlmModel>> = {
  "gpt-5.6-sol": "gpt-6-astra",
}

/** The route's own error-fed retries (its Zod-validated structured output). */
const MAX_RETRIES = 2
/** EVERY selectable model's `maxOutputTokens`. A 20-scene, 3-shot plan is ≈12k
 *  output tokens; an overrun truncates, fails `JSON.parse` identically on every
 *  retry and ends as a 502 — which is why the skill caps productions at ~20 scenes.
 *  One number for all three: Fable and Astra both declare 16384, and the platform
 *  measured Gemini 3.8 Flash honouring a 20k cap on its own lane (2026-09-06 probe:
 *  14,892 completion tokens, finish_reason "stop"), so 16384 truncates none of them. */
const MAX_OUTPUT_TOKENS = 16384

/**
 * THE request body every draft sends to `llm.structuredJob`. One builder for
 * the story lane and the movie lane alike, so the two can never disagree about
 * the prompt, the schema or the wire ids (`schemaName` is what the runs list
 * narrows on; `origin` is what `jobs.list` filters on).
 */
export function buildLlmStructuredBody(args: {
  readonly input: string
  readonly llmModel: LlmModel
}): LlmStructuredInput {
  const registry = buildFormatRegistry()
  return {
    system: renderSystemPrompt(registry),
    input: args.input,
    jsonSchema: renderStructuralJsonSchema(registry),
    schemaName: "studio_production",
    llmModel: args.llmModel,
    maxRetries: MAX_RETRIES,
    maxTokens: MAX_OUTPUT_TOKENS,
    origin: "studio",
  }
}

/** What the model is told about the OPEN production when the plan appends to it (§6.4). */
export interface GenerateContext {
  readonly cast: ReadonlyArray<{ readonly kind: string; readonly name: string }>
  readonly film?: LookSelectionMap
  readonly scenes: ReadonlyArray<string>
  readonly folders: ReadonlyArray<string>
}

/** Keep the block small: an old production can hold hundreds of scenes. */
const CONTEXT_MAX_NAMES = 60

/** The block's first line — hoisted so a stored run input can be cut at it. */
export const GENERATE_CONTEXT_HEADER = "## This plan APPENDS to an existing production"

export function renderGenerateInput(brief: string, context?: GenerateContext): string {
  if (!context) return brief
  const lines = [GENERATE_CONTEXT_HEADER]
  const cast = context.cast.slice(0, CONTEXT_MAX_NAMES)
  if (cast.length > 0) {
    lines.push(
      `Cast already in the production — mention them with exactly these names: ${cast.map((c) => `@${c.name} (${c.kind})`).join(", ")}.`,
    )
  }
  const film = Object.entries(context.film ?? {}).filter((e): e is [string, string] => typeof e[1] === "string")
  if (film.length > 0) {
    lines.push(
      `Film look already set (ids): ${film.map(([k, v]) => `${k}=${v}`).join(", ")}. Write \`film\` only if the brief asks to change it.`,
    )
  }
  if (context.scenes.length > 0) {
    lines.push(`Existing scenes (${context.scenes.length}): ${context.scenes.slice(0, CONTEXT_MAX_NAMES).join("; ")}.`)
  }
  if (context.folders.length > 0) lines.push(`Folders: ${context.folders.join("; ")}.`)
  return `${brief}\n\n${lines.join("\n")}`
}
