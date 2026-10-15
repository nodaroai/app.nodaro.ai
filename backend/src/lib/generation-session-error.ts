/**
 * The refusal for a `sessionId` the caller may not use. Its own import-free
 * file so `http-errors.ts` can map it without pulling the database client in.
 */
/** A `sessionId` the caller may not use: not a uuid, not theirs, or not in
 *  this context. `sendInternalError` answers it 404, before any reservation
 *  (every creator is insert -> reserve -> enqueue). */
export class GenerationSessionNotFoundError extends Error {
  readonly code = "session_not_found"
  constructor() {
    super("Session not found")
    this.name = "GenerationSessionNotFoundError"
  }
}

export function isGenerationSessionNotFound(err: unknown): err is GenerationSessionNotFoundError {
  return err instanceof GenerationSessionNotFoundError
}
