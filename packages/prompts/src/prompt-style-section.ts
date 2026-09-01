/**
 * THE `[style]` SECTION — the trailing block an assembled prompt carries when a
 * run selects any LOOK dimension, shared by the image (`assembleImageInput`)
 * and video (`composeVideoPromptText`) composers so the two surfaces render one
 * shape.
 *
 *     <body>
 *
 *     [style]:
 *     <film line>
 *     <scene line>
 *
 * WHY THE LOOK CLAUSES MOVED: folded inline, a broad direction buried the shot
 * — a dozen grade/lighting/era sentences between the user's prose and the
 * structured fields, all in the same register, with nothing telling the model
 * which sentences describe the ACTION and which describe the LOOK. The section
 * says it structurally instead.
 *
 * WHAT STAYS IN THE BODY: the user's prose, the subject fold, the whole MOTION
 * family, and the structured fragment last. Camera motion is part of the shot
 * prose, not the look — so the body/section boundary IS the registry's `family`
 * column, the same column the video verbosity policy splits on. Coupling them
 * is deliberate: one row cannot be shot-prose for the verbosity policy and look
 * for the section.
 *
 * THE SECTION HAS NO TERMINATOR, so "after the section" is not a shape a caller
 * can reach by appending: every assembler downstream of the composer (both
 * reference resolvers, the legacy character-description wrapper, `Style:` /
 * `Avoid:`) joins its text with a single `\n`, which lands it UNDER the header.
 * Two helpers below are how they stay out — `insertBeforeStyleSection` for body
 * content, `endsInsideStyleSection` for the self-labeling control lines that
 * must stay last. A terminator instead would dangle whenever nothing follows,
 * and would break the byte parity below.
 *
 * THE ZERO-CLAUSE CONTRACT (load-bearing): with no look clause — none selected,
 * all shed, or all deduped away — there is NO header and NO extra newline, and
 * the output is byte-identical to the plain hint join. That keeps the
 * verbatim-and-untrimmed no-op alive (zero hints AND zero section → the user's
 * prompt back byte-for-byte, `undefined` included), which is what the routes'
 * `composed !== prompt` guard reads to decide whether to pin
 * `input_data.userPrompt`.
 *
 * NO INDENTATION ANYWHERE: the video reference resolver collapses 2+ horizontal
 * spaces unanchored, so an indented section line would come back flattened. The
 * section is written flush-left rather than relying on that collapse to be
 * harmless.
 */
import { joinPromptHints, PROMPT_HINT_SEPARATOR } from "./prompt-hint-join.js"
import {
  renderDirectionHintClauses,
  type DirectionFamily,
  type DirectionFields,
  type DirectionHintMode,
  type DirectionStyleGroup,
} from "./direction-registry.js"

/**
 * The section header, verbatim. Lowercase and bracketed so it reads as
 * structure rather than as a sentence — and so it can be found again by
 * `buildImagePrompt`'s hybrid line-capitalizer, which must stop here
 * (`[Style]:` would be a different token, and capitalized clause lines would
 * corrupt the lowercase catalog wording).
 */
export const STYLE_SECTION_HEADER = "[style]:"

/** The blank line between the body and the section. Omitted for an empty body. */
export const STYLE_SECTION_GAP = "\n\n"

/** The section's opening bytes — the gap, the header and the newline before its
 *  first clause line (the section is never emitted without one). */
const STYLE_SECTION_OPENING = `${STYLE_SECTION_GAP}${STYLE_SECTION_HEADER}\n`

/**
 * Split a composed prompt into the BODY and the `[style]` section it ends with
 * (`section: ""` when it carries none, the body then being the whole string;
 * the section comes back WITHOUT the gap).
 *
 * Matched from the RIGHT: the composer always emits the section last, and a
 * user's own prose is free to contain the same characters. A blank body drops
 * the gap with it, so the section-only form is matched on its own.
 */
export function splitStyleSection(prompt: string): { body: string; section: string } {
  const at = prompt.lastIndexOf(STYLE_SECTION_OPENING)
  if (at >= 0) {
    return { body: prompt.slice(0, at), section: prompt.slice(at + STYLE_SECTION_GAP.length) }
  }
  return prompt.startsWith(`${STYLE_SECTION_HEADER}\n`)
    ? { body: "", section: prompt }
    : { body: prompt, section: "" }
}

/**
 * Extend a composed prompt's BODY with more lines, AHEAD of the `[style]`
 * section — what every assembler downstream of the composer needs, because the
 * section has no terminator: a plain append lands under the header and reads as
 * one more look clause. Reference bindings, element directives and character
 * descriptions are scene content that belongs with the prose, and leaving the
 * look clauses last is where a look tail was measured to cost nothing.
 *
 * With no section this IS the plain `"\n"` join every caller emitted before —
 * the byte-parity path, down to the leading newline an empty prompt produces.
 */
export function insertBeforeStyleSection(prompt: string, lines: readonly string[]): string {
  if (lines.length === 0) return prompt
  const block = lines.join("\n")
  const { body, section } = splitStyleSection(prompt)
  if (section.length === 0) return `${prompt}\n${block}`
  return `${body.length > 0 ? `${body}\n${block}` : block}${STYLE_SECTION_GAP}${section}`
}

/**
 * True when `prompt` ends INSIDE the section — its last `\n\n`-delimited block
 * opens with the header. What the self-labeling control lines (`Style:`,
 * `Avoid:`) read: they stay at the END of the prompt by design, so a blank line
 * of their own is the only thing that can close the header's scope ahead of
 * them.
 */
export function endsInsideStyleSection(prompt: string): boolean {
  const at = prompt.lastIndexOf(STYLE_SECTION_GAP)
  const lastBlock = at >= 0 ? prompt.slice(at + STYLE_SECTION_GAP.length) : prompt
  return lastBlock.startsWith(`${STYLE_SECTION_HEADER}\n`)
}

/** Where a rendered clause reads in the assembled prompt. */
export type PromptClauseSlot = "body" | "film" | "scene"

/** A rendered clause plus the line it belongs on. */
export interface SlottedPromptClause {
  readonly text: string
  readonly slot: PromptClauseSlot
}

/**
 * The slot a direction row's clause takes: motion stays in the body, the five
 * `styleGroup: "film"` rows lead the section, every other look row follows on
 * the scene line.
 */
export function styleSlotFor(
  row: { readonly family: DirectionFamily; readonly styleGroup?: DirectionStyleGroup },
): PromptClauseSlot {
  if (row.family === "motion") return "body"
  return row.styleGroup === "film" ? "film" : "scene"
}

/**
 * The SUBJECT channel's clauses: always body. Who is in the shot is the noun
 * phrase the look modifies, not part of the look.
 */
export function asBodyClauses(texts: readonly string[]): SlottedPromptClause[] {
  return texts.map((text) => ({ text, slot: "body" as const }))
}

/**
 * Fold a direction bag and tag each clause with its slot, in registry table
 * order. The ORDER is the fold/survival order, not the string order — the
 * composers slice this list from the tail when a cap forces a shed, and only
 * then hand the surviving prefix to `composeSectionedPrompt`.
 */
export function partitionStyleClauses(
  direction: DirectionFields | undefined,
  opts: { surface: "image" | "video"; mode?: DirectionHintMode },
): SlottedPromptClause[] {
  return renderDirectionHintClauses(direction, opts).map((clause) => ({
    text: clause.text,
    slot: styleSlotFor(clause),
  }))
}

/**
 * The section block for a set of clauses — `""` when none of them is a look
 * clause. Each line is omitted entirely when its half of the split is empty, so
 * a scene-only fold never emits a blank film line.
 */
export function styleSectionFromClauses(clauses: readonly SlottedPromptClause[]): string {
  const line = (slot: PromptClauseSlot) =>
    clauses
      .filter((c) => c.slot === slot)
      .map((c) => c.text)
      .join(PROMPT_HINT_SEPARATOR)
  const lines = [line("film"), line("scene")].filter((l) => l.length > 0)
  return lines.length === 0 ? "" : `${STYLE_SECTION_HEADER}\n${lines.join("\n")}`
}

/**
 * The section for a raw direction bag — the entry point a client renders its
 * preview through, so the preview and the server emit the same bytes.
 */
export function renderStyleSection(
  direction: DirectionFields | undefined,
  opts: { surface: "image" | "video"; mode?: DirectionHintMode },
): string {
  return styleSectionFromClauses(partitionStyleClauses(direction, opts))
}

/**
 * The assembled prompt for a set of clauses: body clauses `". "`-joined onto the
 * user's prompt, the structured fragment last in the body, then the section.
 *
 * TRIMMING follows `joinPromptHints`: the prompt is trimmed whenever ANYTHING
 * folded — a section counts, so a look-only fold trims too, or the blank line
 * would inherit the prompt's trailing whitespace. With nothing folded at all the
 * prompt is returned VERBATIM AND UNTRIMMED (`undefined` passes straight
 * through), which is the byte-parity contract every existing caller rests on.
 *
 * A blank body drops the gap with it, so the result never opens on a newline —
 * the same reason `joinPromptHints` filters a blank prompt out of its join.
 */
export function composeSectionedPrompt<T extends string | undefined>(
  userPrompt: T,
  clauses: readonly SlottedPromptClause[],
  structuredFragment: string,
): string | T {
  const bodyHints = [
    ...clauses.filter((c) => c.slot === "body").map((c) => c.text),
    structuredFragment,
  ].filter((p) => p.length > 0)
  const section = styleSectionFromClauses(clauses)
  if (section.length === 0) {
    return bodyHints.length === 0 ? userPrompt : joinPromptHints(userPrompt ?? "", bodyHints)
  }
  const body =
    bodyHints.length > 0 ? joinPromptHints(userPrompt ?? "", bodyHints) : (userPrompt ?? "").trim()
  return body.length > 0 ? `${body}${STYLE_SECTION_GAP}${section}` : section
}

/**
 * What each clause costs the assembled prompt, as the EXACT composed-length
 * delta of adding it to the prefix below it. Feeds `keepableDirectionHints`,
 * which walks the list tail-first.
 *
 * Exact deltas rather than "clause + separator" because the section's own bytes
 * are not evenly distributed: the FIRST look clause carries the whole
 * `"\n\n[style]:\n"` header (11 characters that only come back when the section
 * disappears), the second look clause of a line carries a `". "`, the first of
 * the scene line carries a `"\n"`. Flat costs would under-price the header, so
 * the walk would cover a deficit with more clauses than it needs and over-shed
 * — visible as a fold that drops two clauses where one would have fit. The
 * deltas do not change between shed iterations (the walk only ever shortens the
 * prefix), so they are computed once, before the loop.
 */
export function sectionedClauseCosts(
  userPrompt: string | undefined,
  clauses: readonly SlottedPromptClause[],
  structuredFragment: string,
): number[] {
  const lengthAt = (kept: number) =>
    composeSectionedPrompt(userPrompt, clauses.slice(0, kept), structuredFragment)?.length ?? 0
  const costs: number[] = []
  let below = lengthAt(0)
  for (let i = 0; i < clauses.length; i++) {
    const at = lengthAt(i + 1)
    costs.push(at - below)
    below = at
  }
  return costs
}
