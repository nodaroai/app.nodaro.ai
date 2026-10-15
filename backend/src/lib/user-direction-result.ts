/**
 * The shape of a resolved palette / moodboard direction, and the warning a run
 * carries when a moodboard's images did not all fit — the pure half of
 * `lib/user-direction.ts`, kept free of the database client so the workflow
 * payload builder (synchronous, no I/O) can read it.
 */
import { parseUserDirectionRef, type StyleReferenceInput } from "@nodaro/prompts/prompt-builder"
import { imageReferenceLimit } from "@nodaro/shared/models"

/**
 * The first key of a direction bag that names one of the caller's own palettes
 * or moodboards (`palette:<id>` / `moodboard:<id>`, alone or in a list), or
 * undefined. Shape only — no I/O, nothing resolved.
 */
export function userDirectionRefKey(direction: unknown): string | undefined {
  if (typeof direction !== "object" || direction === null || Array.isArray(direction)) return undefined
  for (const [key, raw] of Object.entries(direction)) {
    const values: unknown[] = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : []
    if (values.some((v) => parseUserDirectionRef(v) !== null)) return key
  }
  return undefined
}

/** Every `palette:<id>` / `moodboard:<id>` value a direction bag holds, on any
 *  key, alone or in a list. Shape only — no I/O, nothing resolved. */
export function userDirectionRefValues(direction: unknown): string[] {
  if (typeof direction !== "object" || direction === null || Array.isArray(direction)) return []
  return Object.values(direction).flatMap((raw) => {
    const values: unknown[] = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : []
    return values.filter((v): v is string => typeof v === "string" && parseUserDirectionRef(v) !== null)
  })
}

/** Cheap check: does this direction bag name any user-owned resource? No I/O. */
export function hasUserDirectionRefs(direction: unknown): boolean {
  return userDirectionRefKey(direction) !== undefined
}

/** What a direction's user-owned references resolved to. */
export interface ResolvedUserDirection {
  /** Direction value (`palette:<id>`) → its rendered clause. */
  readonly refs: ReadonlyMap<string, string>
  /** The moodboard's images, in its order — fill-only style references. */
  readonly styleReferences: readonly StyleReferenceInput[]
  /** The moodboard those images are from (named when not all of them fit). */
  readonly moodboard?: { readonly id: string; readonly name: string }
}

export interface RunWarning {
  code: string
  message: string
}

/**
 * The warning a run carries when some of its moodboard's images were not sent
 * (`warnings` on the generate-image response, and on the job's `input_data`
 * in both lanes). Empty when all went, or there was no moodboard. `sent` is
 * `assembleImageInput`'s `styleReferencesSent`; `model` the model the caller
 * picked (its reference limit is the one the assembly used).
 */
export function moodboardWarnings(
  resolved: ResolvedUserDirection | undefined,
  sent: number | undefined,
  model: string,
): RunWarning[] {
  const total = resolved?.styleReferences.length ?? 0
  const went = sent ?? 0
  if (!resolved?.moodboard || total === 0 || went >= total) return []
  const limit = imageReferenceLimit(model)
  const why = limit === 0
    ? `the model (${model}) takes no reference images`
    : `the model (${model}) takes at most ${limit} reference images, and your own references come first`
  return [{
    code: "moodboard_images_not_sent",
    message: `${total - went} of the ${total} images of moodboard "${resolved.moodboard.name}" were not sent as style references: ${why}.`,
  }]
}
