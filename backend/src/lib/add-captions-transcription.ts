/**
 * The pure half of Add Captions' transcription engine (lib/add-captions-engine.ts
 * is the half that knows what this deployment offers): whether a render
 * transcribes, the engine a BUILT job runs, and the resolver the estimates ask.
 *
 * A LEAF on purpose: the price estimates (ee/billing/credits.ts, the MCP quote)
 * and the workflow judge (lib/run-model.ts) read it, and they sit inside the
 * chain the availability modules reach (availability-override → node-registry
 * → ee/billing/credits), so they may not import `surface-deny.ts`. The
 * deployment-aware resolver is handed in instead: `lib/add-captions-engine.ts`
 * registers it when it loads, and every lane that runs Add Captions loads that
 * module (the route, the workflow build, the use-case preflight), so in a
 * process that runs it the estimate and the run cannot pick different
 * engines. A process that runs no caption job (a one-off script) asks the
 * default, the rule over nothing withheld — today's default.
 */
import { captionsNeedTranscription } from "@nodaro/shared/captions"
import { CAPTION_ENGINE_UNRESTRICTED_DEFAULT, captionTranscribeEngine } from "@nodaro/render-rules"

/** The fields that decide whether a caption render transcribes (the route body's and the built payload's names). */
export interface CaptionTranscriptionFields {
  readonly style?: unknown
  readonly text?: unknown
  readonly captions?: unknown
  readonly transcript?: unknown
  readonly segments?: unknown
  readonly auto_transcribe?: unknown
}

/** Whether a caption render with these fields transcribes its video, read off a raw (unvalidated) record; never throws. */
export function captionRenderTranscribes(fields: CaptionTranscriptionFields): boolean {
  const segments = Array.isArray(fields.segments)
    ? fields.segments
        .filter((s): s is Record<string, unknown> => s !== null && typeof s === "object")
        .map((s) => ({ text: s.text, captions: Array.isArray(s.captions) ? s.captions : undefined }))
    : undefined
  return captionsNeedTranscription({
    style: typeof fields.style === "string" ? fields.style : undefined,
    text: typeof fields.text === "string" ? fields.text : undefined,
    captions: Array.isArray(fields.captions) ? fields.captions : undefined,
    transcript: fields.transcript,
    segments,
    auto_transcribe: typeof fields.auto_transcribe === "boolean" ? fields.auto_transcribe : undefined,
  })
}

/**
 * The engine a BUILT caption job runs, as its worker reads it: the engine its
 * payload carries, else the worker's default — undefined when the render
 * transcribes nothing. Where the deployment restricts models the route and
 * the build write the engine they decided into the job (and refuse one they
 * cannot run), so this is that engine; what the workflow lane judges
 * (`PAYLOAD_MODEL_OF_JOB`, lib/run-model.ts).
 */
export function addCaptionsBuiltEngine(payload: CaptionTranscriptionFields & { readonly transcribe_provider?: unknown }): string | undefined {
  if (!captionRenderTranscribes(payload)) return undefined
  const named = payload.transcribe_provider
  return typeof named === "string" && named.length > 0 ? named : CAPTION_ENGINE_UNRESTRICTED_DEFAULT
}

/** The engine a caption run that names `named` takes, before anything is built (an estimate, a quote). */
type CaptionEngineResolver = (named: unknown) => string | undefined

const unrestricted: CaptionEngineResolver = (named) => captionTranscribeEngine(named, () => false)
let resolver: CaptionEngineResolver = unrestricted

/** Hand the estimates the deployment-aware resolver (lib/add-captions-engine.ts does, when it loads). */
export function registerCaptionEngineResolver(next: CaptionEngineResolver): void {
  resolver = next
}

/** The engine an estimate prices a caption node that names `named` on: the run's (`registerCaptionEngineResolver`). */
export function estimatedCaptionEngine(named: unknown): string | undefined {
  return resolver(named)
}

/** Whether the deployment-aware resolver was handed over (the booted app holds this: credit-guard-run-model-census.test.ts). */
export function captionEngineResolverRegistered(): boolean {
  return resolver !== unrestricted
}

/** Test hook: back to the resolver over nothing withheld. */
export function __resetCaptionEngineResolverForTests(): void {
  resolver = unrestricted
}
