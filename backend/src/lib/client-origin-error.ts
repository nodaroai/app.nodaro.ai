/**
 * The refusal for an `origin` that is not a client app's slug. Its own
 * import-free file so `http-errors.ts` can map it without pulling the job
 * funnel in.
 */

/** What a valid `origin` looks like, in words — the 400's message. */
export const CLIENT_ORIGIN_RULE =
  "must be your app's slug: lowercase letters, digits and dashes, starting with a letter or digit, at most 40 characters"

/** An `origin` that fails the slug rule (`client-origin-schema.ts`).
 *  `sendInternalError` answers it 400 `validation_error`, before any row or
 *  reservation exists (every creator is insert -> reserve -> enqueue). */
export class InvalidClientOriginError extends Error {
  readonly code = "validation_error"
  constructor() {
    super(`origin: ${CLIENT_ORIGIN_RULE}`)
    this.name = "InvalidClientOriginError"
  }
}

export function isInvalidClientOrigin(err: unknown): err is InvalidClientOriginError {
  return err instanceof InvalidClientOriginError
}
