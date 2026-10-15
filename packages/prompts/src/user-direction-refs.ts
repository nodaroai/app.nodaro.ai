/**
 * USER-OWNED DIRECTION REFERENCES — a `direction` value that names one of the
 * caller's own saved resources instead of a catalog id.
 *
 * Two rows of the direction registry take one (their `userRef` column):
 *   - `colorLook: "palette:<uuid>"`  — a saved colour palette;
 *   - `style:     "moodboard:<uuid>"` — a saved moodboard.
 * The prefix namespaces them, so they never collide with a catalog id
 * (catalog ids are slugs; none carries a colon).
 *
 * The wire carries the id, never the resolved text, so a re-run resolves it
 * again and an edited palette reaches the next run. RESOLVING is a database
 * read, so it happens in the platform before the (pure, synchronous) fold:
 * the caller hands the fold a map of value → rendered clause
 * (`renderDirectionHintClauses`' `refs`, `assembleImageInput`'s
 * `directionRefs`), and a moodboard's images as fill-only style references
 * (`assembleImageInput`'s `styleReferences`). This module holds what is pure:
 * the grammar and the WORDING of those clauses and reference lines.
 */
import { nearestColorName } from "./color-names.js"

/** The kinds of saved resource a direction value can name. */
export type UserDirectionRefKind = "palette" | "moodboard"

export const USER_DIRECTION_REF_KINDS: ReadonlyArray<UserDirectionRefKind> = ["palette", "moodboard"]

/** A parsed user-owned reference. `wellFormed` = its id is a uuid. */
export interface UserDirectionRef {
  readonly kind: UserDirectionRefKind
  readonly id: string
  readonly wellFormed: boolean
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Read one direction value. `null` when it is not a user-owned reference at
 * all (a catalog id, an empty string, anything that is not a string). A value
 * with a known prefix is ALWAYS a reference — `wellFormed: false` when what
 * follows is not a uuid, so a caller can refuse it rather than treat it as an
 * unknown catalog id and skip it in silence.
 */
export function parseUserDirectionRef(value: unknown): UserDirectionRef | null {
  if (typeof value !== "string") return null
  for (const kind of USER_DIRECTION_REF_KINDS) {
    const prefix = `${kind}:`
    if (value.startsWith(prefix)) {
      const id = value.slice(prefix.length)
      return { kind, id, wellFormed: UUID_RE.test(id) }
    }
  }
  return null
}

/** The wire value for a saved resource: `palette:<id>` / `moodboard:<id>`. */
export function userDirectionRefValue(kind: UserDirectionRefKind, id: string): string {
  return `${kind}:${id}`
}

/** Collapse all whitespace (newlines included) to single spaces and trim. User
 *  text never opens a line of its own inside the assembled prompt — a newline
 *  there could start a fake `[style]:` section. */
function oneLine(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim()
}

const HEX_RE = /^#[0-9a-f]{6}$/i

/**
 * A saved palette as a look clause: every colour by its everyday name and its
 * exact hex, in the palette's order — `color palette: dark teal #0F4C5C,
 * saffron #E3B23C`. An entry that is not a `#RRGGBB` colour is skipped; no
 * valid colour renders nothing.
 */
export function renderPaletteClause(colors: ReadonlyArray<string>): string {
  const named = colors
    .filter((c) => HEX_RE.test(c))
    .map((c) => `${nearestColorName(c)} ${c.toUpperCase()}`)
  return named.length > 0 ? `color palette: ${named.join(", ")}` : ""
}

/**
 * A saved moodboard's written description as its look clause: the user's own
 * words, on one line. No description renders nothing (the moodboard's images
 * still go along as style references).
 */
export function renderMoodboardClause(description: string | null | undefined): string {
  return oneLine(description)
}

/** One style reference image (a moodboard's image) handed to the assembler. */
export interface StyleReferenceInput {
  readonly url: string
  /** What the image is for — rides its reference line. */
  readonly caption?: string
}

/**
 * The line a style reference carries in the assembled prompt (its
 * `description` as a reference). The first one says what to take from a style
 * reference and what not to; the rest stay short, so a full moodboard does not
 * bury the prompt. A caption rides along on one line.
 */
export function styleReferenceDescription(index: number, caption?: string): string {
  const cap = oneLine(caption)
  const tail = cap ? ` (${cap})` : ""
  return index === 0
    ? `match the colors, light, texture and mood of this style reference${tail}, not its subject or layout`
    : `another style reference${tail}`
}
