/**
 * The importer's WARNING vocabulary.
 *
 * A warning is the repair step's receipt: nothing was rejected, but the file did
 * not land exactly as written — an id this catalog doesn't carry, a length off
 * the grid, a model that retired, a key from a newer studio. Its own module so
 * the codes are shared by the stages that raise them, the preview that groups
 * them and the lenient-vs-strict property that allow-lists them, with no import
 * cycle between the pipeline and its repair step.
 */
export type ImportWarningCode =
  | "unknown-key"
  | "unknown-id"
  | "layer"
  | "cardinality"
  | "seconds"
  | "shot-dropped"
  | "budget"
  | "duration"
  | "model"
  | "option"
  | "count"
  | "motion-prompt"
  | "audio"
  | "voice"
  | "unresolved-cast"
  | "ambiguous-cast"
  | "newer-version"

export interface ImportWarning {
  readonly code: ImportWarningCode
  /** Plain language, shown verbatim in the preview. */
  readonly message: string
  /** The document path it is about (`scenes[0].shots[1].seconds`). */
  readonly path?: string
}

/**
 * A Zod issue path as the document path a user can find
 * (`scenes[0].frame.prompt`, `music.instruments[0]`). Lives beside the warning
 * it decorates so both repair stages and the pipeline spell a path the ONE
 * way, with no import cycle between them.
 */
export function issuePath(path: ReadonlyArray<PropertyKey>): string {
  return path
    .map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`))
    .join("")
    .replace(/^\./, "")
}

/** The ONE constructor, so an absent path never materializes as `undefined`. */
export function warning(
  code: ImportWarningCode,
  message: string,
  path?: string,
): ImportWarning {
  return { code, message, ...(path ? { path } : {}) }
}
