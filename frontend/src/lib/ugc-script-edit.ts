/**
 * The lines of a UGC Script's plan that the editor shows and edits: the
 * opening line (`hook`), each beat's line (`beats[i].line`) and the closing
 * line (`closer.line`). Every other key of the plan is opaque: never read,
 * typed or rendered here, and an edit keeps it byte for byte.
 */

export interface ScriptLines {
  readonly hook: string
  readonly beats: readonly string[]
  readonly closer: string
}

const isObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)
const text = (x: unknown): string => (typeof x === "string" ? x : "")
const lineOf = (x: unknown): string => (isObject(x) ? text(x.line) : "")

/** Reads exactly `hook`, `beats[i].line` and `closer.line`; a missing or malformed line reads as empty. */
export function scriptLines(plan: Readonly<Record<string, unknown>>): ScriptLines {
  return {
    hook: text(plan.hook),
    beats: Array.isArray(plan.beats) ? plan.beats.map(lineOf) : [],
    closer: lineOf(plan.closer),
  }
}

/**
 * What a refused edit says, one whole sentence per case (each language orders
 * its own words). The editor passes its own language's; the English default is
 * the dictionary's English, word for word (ugc-script-edit.test.ts).
 */
export interface ScriptEditWords {
  readonly hookEmpty: string
  readonly beatEmpty: (n: number) => string
  readonly closerEmpty: string
  /**
   * The plan's lines are not where they belong (`scriptLinesEditable` is false), or the edit would add
   * or remove a beat. The editor shows it as a note beside such a script's lines, with no Edit.
   */
  readonly linesOnly: string
  readonly hookTooLong: (max: number) => string
  readonly beatTooLong: (n: number, max: number) => string
  readonly closerTooLong: (max: number) => string
}

export const SCRIPT_EDIT_WORDS_EN: ScriptEditWords = {
  hookEmpty: "The opening line is empty.",
  beatEmpty: (n) => `Beat ${n}'s line is empty.`,
  closerEmpty: "The closing line is empty.",
  linesOnly: "This script can't be edited here. Turn off Keep this script, then run UGC Script to write a new one.",
  hookTooLong: (max) => `The opening line is too long. Keep it to ${max} characters or fewer.`,
  beatTooLong: (n, max) => `Beat ${n}'s line is too long. Keep it to ${max} characters or fewer.`,
  closerTooLong: (max) => `The closing line is too long. Keep it to ${max} characters or fewer.`,
}

/**
 * The most characters each line of a script takes, counted as typed (spaces included): the limits
 * UGC Clips checks a script against, as the server hands them (`useUgcPlanLineLimits`) — the app
 * holds no copy of them. A longer line is refused here, with the line named, rather than failing
 * UGC Clips later with the script's own field names.
 */
export interface ScriptLineLimits {
  readonly hook: number
  readonly beatLine: number
  readonly closerLine: number
}

/**
 * Blank: only whitespace and invisible marks — direction marks, zero-width spaces and joiners,
 * word joiners: the default-ignorable characters that are not a letter or a digit, none of which
 * UGC Clips reads as part of a word. Such a line looks empty and is refused as empty. A visible
 * character, punctuation included, is not blank here.
 */
const BLANK = /^(?:\s|(?![\p{L}\p{N}])\p{Default_Ignorable_Code_Point})*$/u
const blank = (line: string): boolean => BLANK.test(line)

/**
 * Whether the editor can write lines into this plan: its beats are a list of objects and its
 * closing line is an object. Any other plan is shown read only, never rebuilt.
 */
export function scriptLinesEditable(plan: Readonly<Record<string, unknown>>): boolean {
  const { beats, closer } = plan
  return Array.isArray(beats) && beats.every(isObject) && isObject(closer)
}

/**
 * The plan with the edited lines written in, as a deep copy: exactly `hook`,
 * `beats[i].line` and `closer.line` change, every other key is kept byte for
 * byte, and the plan passed in is never touched. A blank line (whitespace or
 * invisible marks only) is refused with the line named, and then a line longer
 * than the server's limit for it (`limits`; none given — an older plugin — and
 * UGC Clips refuses an over-long line as before); so is an edit with another
 * number of beats (the editor never adds or removes one) and a plan whose beats
 * or closing line are not objects (refused, never rebuilt). A line is written
 * as typed.
 */
export function applyScriptLineEdits(
  plan: Readonly<Record<string, unknown>>,
  edits: ScriptLines,
  words: ScriptEditWords = SCRIPT_EDIT_WORDS_EN,
  limits?: ScriptLineLimits,
): { plan: Record<string, unknown> } | { error: string } {
  if (!scriptLinesEditable(plan) || edits.beats.length !== (plan.beats as unknown[]).length) {
    return { error: words.linesOnly }
  }
  // Line by line, in the script's order: the refusal names the first line that is wrong.
  const over = (line: string, max: number | undefined): max is number => max !== undefined && line.length > max
  if (blank(edits.hook)) return { error: words.hookEmpty }
  if (over(edits.hook, limits?.hook)) return { error: words.hookTooLong(limits!.hook) }
  for (const [i, line] of edits.beats.entries()) {
    if (blank(line)) return { error: words.beatEmpty(i + 1) }
    if (over(line, limits?.beatLine)) return { error: words.beatTooLong(i + 1, limits!.beatLine) }
  }
  if (blank(edits.closer)) return { error: words.closerEmpty }
  if (over(edits.closer, limits?.closerLine)) return { error: words.closerTooLong(limits!.closerLine) }
  // A plan is a job's JSON output, so a JSON round trip is an exact deep copy.
  const copy = JSON.parse(JSON.stringify(plan)) as Record<string, unknown>
  return {
    plan: {
      ...copy,
      hook: edits.hook,
      beats: (copy.beats as Array<Record<string, unknown>>).map((beat, i) => ({ ...beat, line: edits.beats[i] })),
      closer: { ...(copy.closer as Record<string, unknown>), line: edits.closer },
    },
  }
}
