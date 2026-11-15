/**
 * The engine an Add Captions run transcribes on (decided 2026-11-15): the one
 * its node or request names, else the first engine this deployment offers in
 * `CAPTION_ENGINE_DEFAULT_ORDER`. One rule for the editor's panel and price,
 * the route, the workflow build, the estimates and the worker, so they cannot
 * disagree; each passes its own view of what the deployment withholds (the
 * server's `isModelDenied`, the editor's `isModelUnavailable`), and only where
 * the deployment restricts models, so a deployment that restricts nothing
 * always runs today's default.
 *
 * A named engine is returned as named, offered or not: an engine the
 * deployment withholds is refused at run (`model_not_available`), never
 * swapped for another one, since another engine changes the captions and the
 * price.
 */
import { CAPTION_TRANSCRIBE_LANES, type CaptionTranscribeLane } from "@nodaro/shared/models"

/**
 * The order the default is picked in. Incredibly Fast Whisper first (the
 * default before engines followed what a deployment offers), then the other
 * engines that return word timings, which a kinetic style needs, in the
 * lanes' order; Whisper, which gives phrase lines only, last. Every lane
 * appears once (held by a test).
 */
export const CAPTION_ENGINE_DEFAULT_ORDER: readonly CaptionTranscribeLane[] = Object.freeze([
  "incredibly-fast-whisper",
  "elevenlabs-stt",
  "nemotron-3-5-transcribe",
  "whisper",
])

/** The engine a node that names none runs on a deployment that withholds nothing. */
export const CAPTION_ENGINE_UNRESTRICTED_DEFAULT: CaptionTranscribeLane = CAPTION_ENGINE_DEFAULT_ORDER[0]!

/**
 * The engine a caption run with `named` transcribes on: `named` when it is a
 * non-empty string, else the first engine of the default order `withheld`
 * does not withhold. Undefined when the deployment offers none of them.
 */
export function captionTranscribeEngine(named: unknown, withheld: (engine: string) => boolean): string | undefined {
  if (typeof named === "string" && named.length > 0) return named
  return CAPTION_ENGINE_DEFAULT_ORDER.find((engine) => !withheld(engine))
}

/** Whether `engine` is one of Add Captions' own engines. */
export function isCaptionTranscribeLane(engine: unknown): engine is CaptionTranscribeLane {
  return typeof engine === "string" && (CAPTION_TRANSCRIBE_LANES as readonly string[]).includes(engine)
}

/** The refusal of a caption run that must transcribe on a deployment that offers none of the engines. */
export const NO_CAPTION_ENGINE_OFFERED_MESSAGE =
  "Add Captions cannot transcribe this video: this deployment offers none of its transcription engines " +
  `(${CAPTION_TRANSCRIBE_LANES.join(", ")}). Its operator can list one of them in the deployment's models; ` +
  "until then, give the node its own captions, a transcript or a static subtitle text."
