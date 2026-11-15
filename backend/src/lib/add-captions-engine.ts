/**
 * The engine an Add Captions run transcribes on, as this server decides it
 * (decided 2026-11-15): `captionTranscribeEngine` (`@nodaro/render-rules`, the
 * rule the editor runs too) over what this deployment withholds — and only
 * where it restricts models (`modelRestrictionConfigured`), so a deployment
 * that restricts nothing runs today's default and is never asked anything.
 *
 * Every lane that runs Add Captions decides it here: the route (and so MCP
 * `add_captions` and the editor's single-node Run), the workflow build (Run,
 * Run from here, published apps, components, use cases that embed it) and the
 * use-case preflight; the workflow and quote estimates ask the same resolver
 * through the leaf `lib/add-captions-transcription.ts`, which this module
 * registers it into when it loads. Where models are
 * restricted the route and the build write the engine they decided into the
 * job, so what the worker runs, what was judged and what is held are one
 * engine; the worker's own default applies only to a job dispatched where
 * nothing was restricted.
 */
import { CAPTION_TRANSCRIBE_LANES, TRANSCRIBE_PROVIDER_CAPABILITIES, type TranscribeLane } from "@nodaro/shared/models"
import { captionTranscribeEngine, NO_CAPTION_ENGINE_OFFERED_MESSAGE } from "@nodaro/render-rules"
import { isModelDenied, modelRestrictionConfigured } from "./surface-deny.js"
import { captionRenderTranscribes, registerCaptionEngineResolver, type CaptionTranscriptionFields } from "./add-captions-transcription.js"

export { captionRenderTranscribes, type CaptionTranscriptionFields } from "./add-captions-transcription.js"

/** Whether this deployment withholds `engine` from a caption run: only where it restricts models. */
export function captionEngineWithheld(engine: string): boolean {
  return modelRestrictionConfigured() && isModelDenied(engine)
}

/** The engine a caption run that names `named` transcribes on here; undefined when the deployment offers none. */
export function addCaptionsEngine(named: unknown): string | undefined {
  return captionTranscribeEngine(named, captionEngineWithheld)
}

// The estimates (ee/billing/credits.ts, the MCP quote) ask this resolver through
// the leaf (lib/add-captions-transcription.ts), which they can import without
// reaching the availability modules; it is handed over here, when this module
// loads — and every lane that runs Add Captions loads it.
registerCaptionEngineResolver(addCaptionsEngine)

/**
 * The model a caption run with these fields runs on, as a model restriction
 * judges it: its engine when it transcribes, nothing when it brings its own
 * words. Where the deployment offers no engine, every engine (each one it
 * withholds), so a judge that reads it refuses the run.
 */
export function addCaptionsRunModel(fields: CaptionTranscriptionFields & { readonly transcribe_provider?: unknown }): string | readonly string[] | undefined {
  if (!captionRenderTranscribes(fields)) return undefined
  return addCaptionsEngine(fields.transcribe_provider) ?? CAPTION_TRANSCRIBE_LANES
}

/** The coded refusal of a caption run that must transcribe where no engine is offered. */
export function noCaptionEngineOfferedError(): Error & { code: "model_not_available" } {
  return Object.assign(new Error(NO_CAPTION_ENGINE_OFFERED_MESSAGE), { code: "model_not_available" as const })
}

/**
 * Whether a DEFAULT engine (the node or request named none) cannot serve the
 * render: it returns no word timings (Whisper — last in the default order, so
 * the only engine the deployment offers when it is the default), the render
 * needs them (a kinetic style, `captionsNeedWordTimings`), and there is no text
 * to fall back to. Such a run could only caption nothing, so it is refused
 * before anything is held, on the route and in the workflow build alike — the
 * route's own rule for a request that names Whisper there.
 */
export function defaultCaptionEngineCannotServe(engine: string, render: { readonly needsWordTimings: boolean; readonly hasFallbackText: boolean }): boolean {
  const capabilities = Object.hasOwn(TRANSCRIBE_PROVIDER_CAPABILITIES, engine) ? TRANSCRIBE_PROVIDER_CAPABILITIES[engine as TranscribeLane] : undefined
  return capabilities !== undefined && !capabilities.wordTimestamps && render.needsWordTimings && !render.hasFallbackText
}

/** The refusal of a render its default engine cannot serve (`defaultCaptionEngineCannotServe`). */
export function defaultCaptionEngineCannotServeMessage(engine: string): string {
  const wordTimed = CAPTION_TRANSCRIBE_LANES.filter((lane) => TRANSCRIBE_PROVIDER_CAPABILITIES[lane].wordTimestamps)
  return (
    `Add Captions cannot caption this render: the only transcription engine this deployment offers, "${engine}", returns no word timings, ` +
    `which this caption style needs. Its operator can list ${wordTimed.join(", ")} in the deployment's models; ` +
    "until then, use the subtitle style, or give the node its own text, captions or a transcript."
  )
}
