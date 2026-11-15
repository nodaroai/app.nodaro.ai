/**
 * The engine an Add Captions node transcribes on, as the editor shows and
 * prices it: the server's rule (`captionTranscribeEngine`, `@nodaro/render-rules`)
 * over what this deployment withholds — only where it restricts models
 * (`modelRestrictionActive`), as the server judges, so a deployment that
 * restricts nothing shows today's default. The panel's engine menu and the
 * node's price read it; the run decides the same engine on the server.
 */
import { captionTranscribeEngine } from "@nodaro/render-rules"
import { isModelUnavailable, modelRestrictionActive } from "@/lib/surface-availability"

/** Whether this deployment withholds `engine` from a caption run (only where it restricts models). */
export function captionEngineWithheldHere(engine: string): boolean {
  return modelRestrictionActive() && isModelUnavailable(engine)
}

/** The engine a caption node that names `named` runs on here; undefined when the deployment offers none. */
export function addCaptionsEngineHere(named: unknown): string | undefined {
  return captionTranscribeEngine(named, captionEngineWithheldHere)
}
