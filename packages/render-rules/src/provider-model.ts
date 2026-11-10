/**
 * What a node's `provider` value names, as a model restriction judges it — one
 * rule for the server's checks and the editor's model menus.
 *
 * For most node types `provider` IS the id of the model the node runs. A few
 * put an engine, a vendor or a legacy alias there instead, and judging that
 * value as a model id refuses the node (or hides its menu row) where an
 * unrelated model is withheld or switched off, while the model it does run
 * goes unjudged:
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
 * Each entry maps a value to the model it runs, or to null when it runs no
 * catalog model. A node type that is not listed names its model in `provider`
 * itself. The server's resolved-model registry (the model a job runs, decided
 * as its handler decides) reads the same functions for these jobs, so the
 * menus, the door and the run cannot disagree.
 */
import { buildMotionCreditModelIdentifier } from "@nodaro/shared/credits"
import { LLM_FEATURE_DEFAULTS, llmDefaultsFeature, resolveScriptModelId } from "@nodaro/shared/llm-models"
import { DEFAULT_TTS_PROVIDER, getMaxTtsChars, type TtsProvider } from "@nodaro/shared/models"

type Data = Readonly<Record<string, unknown>>

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined)

/** The default model of an LLM feature (through `llmDefaultsFeature`); undefined for an unknown one. */
export function llmFeatureDefaultModel(feature: string): string | undefined {
  const own = llmDefaultsFeature(feature)
  return Object.hasOwn(LLM_FEATURE_DEFAULTS, own) ? (LLM_FEATURE_DEFAULTS as Record<string, string>)[own] : undefined
}

/**
 * Motion Transfer's option ("kling", "kling-3.0", …) as the catalog model it
 * runs: the base of the credit id the route bills it under (Kling 2.6 is
 * catalog `motion-transfer`, Kling 3.0 `kling-3.0-motion`).
 */
export function motionTransferModelOf(provider: string): string {
  return buildMotionCreditModelIdentifier(provider, "720p").split(":")[0]!
}

/** Video Upscale's option as the catalog model: its "topaz" is the catalog's `topaz-video`. */
export function videoUpscaleModelOf(provider: string): string {
  return provider === "topaz" ? "topaz-video" : provider
}

/**
 * The speech model a request runs on when nothing names one: the default
 * speech model takes the text up to its own per-request cap
 * (`getMaxTtsChars`); longer text runs on turbo, so it is never billed for a
 * model that cannot take it. `text` is the text actually sent.
 */
export function resolveOmittedTtsProvider(text: string): TtsProvider {
  return text.length <= getMaxTtsChars(DEFAULT_TTS_PROVIDER) ? DEFAULT_TTS_PROVIDER : "elevenlabs-turbo"
}

/**
 * The speech model a text-to-speech request runs: the one it names (the legacy
 * "elevenlabs" is turbo), else the omitted-provider rule above.
 */
export function ttsModelOf(provider: string | undefined, text: string): string {
  return provider === "elevenlabs" ? "elevenlabs-turbo" : (provider ?? resolveOmittedTtsProvider(text))
}

/** The model a node of this type runs when its `provider` holds `provider`, or null for no catalog model. */
export type ProviderModel = (provider: string, data: Data) => string | null

/** Node types whose `provider` is not (always) the id of the model they run. */
export const PROVIDER_MODEL_OF_NODE: Readonly<Record<string, ProviderModel>> = Object.freeze({
  // The MiniMax music engine (MUSIC_PROVIDERS): no catalog model names it.
  "generate-music": () => null,
  "motion-transfer": (provider) => motionTransferModelOf(provider),
  "generate-script": (provider, data) => resolveScriptModelId(provider, str(data.llmModel)),
  "video-upscale": (provider) => videoUpscaleModelOf(provider),
  "text-to-speech": (provider, data) => ttsModelOf(provider, typeof data.text === "string" ? data.text : ""),
  // A legacy vendor alias: the check runs `llmModel`, else its feature's default.
  "qa-check": (_provider, data) => str(data.llmModel) ?? llmFeatureDefaultModel("qa-check") ?? null,
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

/**
 * The model a model menu's row makes a node run, as a restriction judges it:
 * a `provider` row through the map above, any other field's row as its own id
 * (an LLM, a Suno or voice model). Null when the row runs no catalog model, so
 * no restriction can withhold it.
 */
export function menuRowModel(nodeType: string, field: string, value: string, data: Data = {}): string | null {
  return field === "provider" ? providerModelOf(nodeType, value, data) : value
}
