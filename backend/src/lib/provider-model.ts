/**
 * What a node's `provider` value names, as a model restriction judges it.
 *
 * For most node types `provider` IS the id of the model the node runs. A few
 * put an engine, a vendor or a legacy alias there instead, and judging that
 * value as a model id refuses the node where an unrelated model is withheld
 * or switched off, while the model it does run goes unjudged:
 *  - Generate Music's `minimax` is the MiniMax MUSIC engine; the catalog's
 *    `minimax` is the MiniMax VIDEO model.
 *  - Motion Transfer's `kling` / `kling-3.0` run the catalog's
 *    `motion-transfer` / `kling-3.0-motion`.
 *  - Generate Script's `gemini` / `claude` / `gpt` are aliases for the LLM it
 *    resolves with `llmModel` (`resolveScriptModelId`).
 *  - Video Upscale's `topaz` is the catalog's `topaz-video`; Text to Speech's
 *    legacy `elevenlabs` runs as Turbo; QA Check's `claude` / `gpt` name no
 *    model at all (it runs `llmModel`).
 *
 * Each entry maps a value to the model it runs, read from the same source the
 * node's dispatch reads (`RESOLVED_MODEL_OF_JOB`, which decides as the
 * handler decides), or to null when it runs no catalog model. A node type
 * that is not listed names its model in `provider` itself.
 *
 * The deny at the door (the credit guard's raw-provider check and the
 * workflow build's named-model check, both asked on every deployment) judges
 * `provider` only when it names the model itself (`providerIsItsModel`). The
 * model an engine name runs is judged where a run's model is judged — the
 * route's `runModel` and the build's default-model judge — which only ask on
 * a deployment that restricts models. So a deployment that restricts nothing
 * sees only fewer refusals: an engine name that shares an id with a model an
 * admin switched off no longer refuses the node.
 *
 * `__tests__/provider-model-census.test.ts` fails a node type whose provider
 * vocabulary is not the ids of the models it runs and that has no entry here
 * (or a reason there).
 */
import { resolvedModelOfJob } from "./job-resolved-model.js"
import { llmFeatureDefault, textField } from "./run-model.js"

type Data = Readonly<Record<string, unknown>>

/** The model a node of this type runs when its `provider` holds `provider`, or null for no catalog model. */
export type ProviderModel = (provider: string, data: Data) => string | null

/** The resolved-model registry's answer for this job, with this `provider` on the node's own data. */
const asJob = (job: string): ProviderModel => (provider, data) => resolvedModelOfJob(job, { ...data, provider }) ?? null

/** Node types whose `provider` is not (always) the id of the model they run. */
export const PROVIDER_MODEL_OF_NODE: Readonly<Record<string, ProviderModel>> = Object.freeze({
  // The MiniMax music engine (MUSIC_PROVIDERS): no catalog model names it.
  "generate-music": () => null,
  "motion-transfer": asJob("motion-transfer"),
  "generate-script": asJob("generate-script"),
  "video-upscale": asJob("video-upscale"),
  "text-to-speech": asJob("text-to-speech"),
  // A legacy vendor alias: the check runs `llmModel`, else its feature's default.
  "qa-check": (_provider, data) => textField(data.llmModel) ?? llmFeatureDefault("qa-check") ?? null,
})

/**
 * The model a node of `nodeType` runs for `provider`: its entry's answer, or
 * `provider` itself for a node type that names its model there.
 */
export function providerModelOf(nodeType: string | undefined, provider: string, data: Data = {}): string | null {
  const map = nodeType !== undefined && Object.hasOwn(PROVIDER_MODEL_OF_NODE, nodeType) ? PROVIDER_MODEL_OF_NODE[nodeType]! : undefined
  return map ? map(provider, data) : provider
}

/**
 * Whether `provider` IS the id of the model a node of each of `nodeTypes`
 * runs — what the deny at the door judges. An engine name, an alias or a
 * value that runs no catalog model is not judged there; the model it runs is
 * judged with the run's own model (`runModel`, the build's default judge).
 */
export function providerIsItsModel(nodeTypes: readonly string[], provider: string, data: Data = {}): boolean {
  return nodeTypes.every((type) => providerModelOf(type, provider, data) === provider)
}
