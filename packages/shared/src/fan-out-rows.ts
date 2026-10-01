/**
 * Fan-out pairs by ROW.
 *
 * When several list wires reach one node ("prompt" + "negative" columns of the
 * same List, two Extract Field lists cut from the same JSON array, …) the node
 * runs once per row and every wire contributes the value of THAT row. Both DAG
 * engines (backend orchestrator + in-browser executor) build the plan with the
 * helpers below, so the rules live in exactly one place:
 *
 *   - which list drives the fan-out, and which rows run, never depend on the
 *     order the wires were drawn in (`resolveListFanOut`);
 *   - the driving item is only written into the prompt when its wire actually
 *     feeds the prompt (`fanOutTextFeedsPrompt`, `NON_PROMPT_TEXT_LANES`);
 *   - an empty cell stays empty IN ITS ROW instead of pulling the rows below it
 *     up (`liveRowColumn`, `alignedFieldList`, `compactWithRows`);
 *   - an iteration keeps its row when Repeat xN multiplies it (`planFanOut`).
 */
import { evaluateJsonPath, stringifyPathResults } from "./json-path.js"
import { expandItemsWithRepeat } from "./repeat-types.js"

/**
 * The text LANES the input resolvers route somewhere OTHER than the prompt slot
 * (`negative` → negativePrompt, `system-prompt` → systemPrompt, an avatar's
 * `script`, an editor's `transcript`, …). A list that drives a fan-out through
 * one of these must NOT also be written into the prompt: the per-row resolution
 * already delivered it where it belongs.
 *
 * Keyed by handle, scoped by node type, because the routers are: `transcript`
 * is the caption track of Add Captions but the very text Forced Alignment
 * aligns. `"*"` = every node type (the router branch is unconditional).
 *
 * DERIVED, not remembered: each engine has a totality test
 * (`fanout-text-handle-totality`) that routes a text source into EVERY input
 * handle of EVERY node type through the real resolver and fails the build on any
 * pair where this table and the router disagree — in either direction. An
 * unlisted lane keeps the old behavior (the item is the prompt), so a miss can
 * only ever reproduce the old bug on that one lane, never a new one.
 */
export const NON_PROMPT_TEXT_LANES: Readonly<Record<string, "*" | readonly string[]>> = {
  negative: "*",
  "system-prompt": "*",
  script: ["ai-avatar"],
  transcript: ["add-captions", "apply-edl", "edit-plan"],
  edl: ["apply-edl"],
  silence: ["edit-plan"],
  qrText: ["image-overlay"],
  transition: ["slideshow"],
  // Content Recipe's `link` carries the post's address (inputs.sourceLink), not
  // the material it analyzes — a list of links fanned through it must not be
  // written into the material too.
  link: ["content-recipe"],
}

/** Does a TEXT list wired to `targetHandle` of a `nodeType` node feed its prompt slot? */
export function fanOutTextFeedsPrompt(nodeType: string | null | undefined, targetHandle: string | null | undefined): boolean {
  const scope = Object.hasOwn(NON_PROMPT_TEXT_LANES, targetHandle ?? "") ? NON_PROMPT_TEXT_LANES[targetHandle ?? ""] : undefined
  if (scope === undefined) return true
  return scope !== "*" && !scope.includes(nodeType ?? "")
}

const isBlank = (v: unknown): boolean => typeof v !== "string" || v.trim().length === 0

/**
 * Drop the empty entries of a row-aligned list, remembering the row every kept
 * value came from. The items are what drives a fan-out (nothing runs for an
 * empty cell); the rows are what keeps the OTHER wires on the same row.
 */
export function compactWithRows(aligned: readonly string[]): { items: string[]; rowIndices: number[] } {
  const items: string[] = []
  const rowIndices: number[] = []
  aligned.forEach((value, row) => {
    if (isBlank(value)) return
    items.push(value)
    rowIndices.push(row)
  })
  return { items, rowIndices }
}

/**
 * One column of a manual List table, row-aligned: a row is dropped only when
 * EVERY cell of it is blank (the trailing empty row the editor keeps), and an
 * empty cell of a row that has content stays in place as "".
 */
export function liveRowColumn(rows: ReadonlyArray<ReadonlyArray<string | undefined>>, colIndex: number): string[] {
  return rows
    .filter((row) => row.some((cell) => !isBlank(cell)))
    .map((row) => (typeof row[colIndex] === "string" ? (row[colIndex] as string).trim() : ""))
}

/** One list wire that could drive a fan-out. */
export interface FanOutCandidate {
  /** Target handle of the consumer-side wire. */
  targetHandle: string | null | undefined
  /** The wire's values in row order — may hold "" for an empty row. */
  aligned: readonly string[]
}

/**
 * Turn the lists that reach a node into ONE fan-out, so that nothing depends on
 * the order the wires were drawn in. `candidates` are the "each" lists that hold
 * more than one value, in wire order.
 *
 * The PRIMARY is the list that holds the most values (the first of them when
 * several tie): it sets the row space. Both engines get it from here, so the
 * orchestrator and the in-browser executor cannot disagree on how many times a
 * node runs. Lists with the SAME number of rows share that row space — two
 * columns of one table, two Extract Field lists cut from one array — and are
 * settled together:
 *
 *   - the DRIVER (its item becomes the per-row override) is a text list that
 *     feeds the prompt, when there is one: that item is what must win over the
 *     typed prompt, and a list wired to `negative` must never supply it;
 *   - a ROW runs when ANY of those lists has a value in it. A row is never
 *     dropped because one column is empty there — that column just contributes
 *     nothing for the row — and a row with no value anywhere does not run.
 *
 * A list with a different number of rows is not part of this: it keeps
 * wrapping around per iteration, as it always has.
 */
export function resolveListFanOut<C extends FanOutCandidate>(
  candidates: readonly C[],
  nodeType: string | null | undefined,
): ListFanOut | undefined {
  if (candidates.length === 0) return undefined
  const held = (c: C) => compactWithRows(c.aligned).items.length
  const primary = candidates.reduce((best, c) => (held(c) > held(best) ? c : best))
  const space = candidates.filter((c) => c.aligned.length === primary.aligned.length)
  const feedsPrompt = (c: C) => fanOutTextFeedsPrompt(nodeType, c.targetHandle) && isTextList(c.aligned)
  const driver = feedsPrompt(primary) ? primary : (space.find(feedsPrompt) ?? primary)
  const rowIndices: number[] = []
  for (let row = 0; row < primary.aligned.length; row++) {
    if (space.some((c) => !isBlank(c.aligned[row]))) rowIndices.push(row)
  }
  return {
    items: rowIndices.map((row) => (isBlank(driver.aligned[row]) ? "" : driver.aligned[row])),
    rowIndices,
    targetHandle: driver.targetHandle,
  }
}

/**
 * Is this fan-out item a media URL (as opposed to text)? The ONE guess both
 * engines make when a list item has to be applied as an override — kept here so
 * the backend worker and the in-browser executor cannot disagree on it.
 */
export function isFanOutUrlItem(item: string): boolean {
  return item.startsWith("http") || /\.(png|jpg|jpeg|webp|gif|mp4|mov|webm|mp3|wav|ogg)(\?|$)/i.test(item)
}

/** A media list never supplies a prompt override, whatever handle it is wired to.
 *  The FIRST value decides — a column is one kind of thing; this is not a scan. */
function isTextList(aligned: readonly string[]): boolean {
  const first = aligned.find((v) => !isBlank(v))
  return first !== undefined && !isFanOutUrlItem(first)
}

/** What a fan-out source resolved to. */
export interface ListFanOut {
  /** The driving list's value for every row that runs — "" where the driver has
   *  none for a row another list keeps alive (nothing is overridden there). */
  items: string[]
  /** `rowIndices[k]` = the row `items[k]` came from, in the driver's row space. */
  rowIndices: number[]
  /** Target handle of the consumer-side wire that drives the fan-out. */
  targetHandle: string | null | undefined
}

/** The iterations a node will run, in order. */
export interface FanOutPlan {
  /** One entry per iteration (list items, repeat / provider sentinels). */
  items: string[]
  /** Row each iteration reads its inputs from; undefined when nothing is list-driven. */
  rows: Array<number | undefined>
  /** Handle the driving list is wired to; undefined when nothing is list-driven. */
  targetHandle: string | null | undefined
}

/**
 * Expand a fan-out into its iterations (list x Repeat xN, providers, repeats —
 * `expandItemsWithRepeat` stays the single rule for that) and pin every
 * iteration to the ROW its item came from. Repeat xN runs a row N times: the
 * copies share the row, they do not walk on to the next one.
 */
export function planFanOut(
  fanOut: ListFanOut | undefined,
  nodeType: string,
  nodeData: Record<string, unknown>,
): FanOutPlan | null {
  const items = expandItemsWithRepeat(fanOut?.items, nodeType, nodeData)
  if (!items) return null
  const listDriven = fanOut !== undefined && fanOut.items.length > 1
  if (!listDriven) return { items, rows: items.map(() => undefined), targetHandle: undefined }
  const perRow = items.length / fanOut.items.length
  return {
    items,
    rows: items.map((_, k) => fanOut.rowIndices[Math.floor(k / perRow)]),
    targetHandle: fanOut.targetHandle,
  }
}

/**
 * Extract Field, List output, over a root ARRAY: one entry per element, "" where
 * the element has no value — so two Extract Field lists cut from the same array
 * stay row-aligned. Returns undefined when rows cannot be defined (the root is
 * not an array, an element fans into several values, or no element carries the
 * field at all) — the caller then keeps the plain "values that exist" list.
 */
export function alignedFieldList(value: unknown, path: string): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const out: string[] = []
  for (const element of value) {
    const found = evaluateJsonPath(element, path)
    if (found.length > 1) return undefined
    out.push(stringifyPathResults(found)[0] ?? "")
  }
  return out.some((v) => v.length > 0) ? out : undefined
}
