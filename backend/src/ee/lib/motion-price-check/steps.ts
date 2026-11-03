/**
 * What each step of a Nodaro Motion run is, for the admin's Motion price
 * check: its name, its role, its kind, its round, and the line of the run's
 * recorded quote that covers it.
 *
 * A step is a job below the run (`parent_job_id`), and the engine gives each
 * one an idempotency key that says what it is: `<prefix>:<run id>[:…]`, the
 * run being the job the walk started from. A key is read as a whole: its
 * prefix as one token, then the run's own id, then exactly the suffixes that
 * prefix takes. A key of another form (none at all, another run's id, a
 * request fingerprint) is "Other step (<route>)": shown, never guessed at.
 *
 * `round` is the pass of the run that made the step: its first pass, a retry
 * (the masked retry, or the body-from-the-clip retry), or the sheet retry's
 * regeneration (`:regen`, "a round of its own"). A `retryN` suffix is another
 * try of the same step within its round, not a round.
 */
import type { QuoteRecord, ReuseEntryView } from "./records.js"
import type { MotionPriceReused } from "./wire.js"

/** The routes that run on our own machines: no provider bills them. */
export const LOCAL_ROUTES: readonly string[] = ["mask-composite", "mask-erase", "mask-outline", "video-face-mesh"]

export type StepKind = "base" | "render" | "render-hd" | "sheet" | "clip-body-picture" | "styled-picture" | "labels"
  | "engine-prompt" | "clip-body-llm" | "scene" | "vocals" | "masking" | "depth-map" | "other"

export interface StepIdentity {
  name: string
  role: number | null
  kind: StepKind
  round: "first" | "retry" | "regen"
  local: boolean
}

type Round = StepIdentity["round"]
type Named = Omit<StepIdentity, "local">

const named = (name: string, kind: StepKind, round: Round = "first", role: number | null = null): Named => ({ name, role, kind, round })

/** The render children (`cast-swap-child:<run>[:<suffix>]`), by suffix. */
const RENDERS: ReadonlyMap<string, Named> = new Map([
  ["", named("Render", "render")],
  ["masked", named("Render — masked retry", "render", "retry")],
  ["sheets", named("Render — sheet retry", "render", "regen")],
  ["clip-body", named("Render — body-from-the-clip retry", "render", "retry")],
  ["vocals", named("Vocals split", "vocals")],
])

/** The masking children (`<prefix>:<run>:<first|retry>`), by prefix. */
const MASKING: ReadonlyMap<string, readonly [string, StepKind]> = new Map([
  ["cast-swap-mask", ["Face mask", "masking"]],
  ["cast-swap-mask-main", ["Face mask", "masking"]],
  ["cast-swap-depth", ["Face depth", "masking"]],
  ["cast-swap-depth-gray", ["Face depth", "masking"]],
  ["cast-swap-depth-clip", ["Depth map", "depth-map"]],
  ["cast-swap-depth-composite", ["Depth composite", "masking"]],
  ["cast-swap-blur", ["Blur", "masking"]],
  ["cast-swap-keep-people", ["Keep-people composite", "masking"]],
  ["cast-swap-face-mesh", ["Face mesh", "masking"]],
  ["cast-swap-depth-mesh", ["Face mesh", "masking"]],
  ["cast-swap-mask-outline", ["Role outlines", "masking"]],
  ["cast-swap-mask-erase", ["Mask erase", "masking"]],
])

/** The LLM calls (`cast-swap-llm:<run>:<step>:<role|run>:<try>:<digest>`), by step; photo labels read their role. */
const LLM_STEPS: ReadonlyMap<string, readonly [string, StepKind]> = new Map([
  ["engine-prompt", ["Engine prompt", "engine-prompt"]],
  ["clip-body-pick", ["Body from the clip — frame pick", "clip-body-llm"]],
  ["clip-body-describe", ["Body from the clip — words", "clip-body-llm"]],
  ["clip-body-words", ["Body from the clip — words", "clip-body-llm"]],
  ["shot-list", ["Shot list", "scene"]],
  ["scene-description", ["Scene description", "scene"]],
  ["scene-rewrite", ["Scene rewrite", "scene"]],
])

/** The picture children (`<prefix>:<run>:<role>[…]`): what each prefix's suffixes may be. */
const PICTURES: ReadonlyMap<string, { name: string; kind: StepKind; regen: boolean; head: boolean }> = new Map([
  ["cast-swap-prep", { name: "Reference sheet", kind: "sheet", regen: true, head: true }],
  ["cast-swap-clipbody", { name: "Body from the clip — picture", kind: "clip-body-picture", regen: true, head: false }],
  ["cast-swap-stylerefs", { name: "Styled role picture", kind: "styled-picture", regen: false, head: false }],
])

const ROLE_INDEX = /^(?:0|[1-9]\d{0,5})$/
const RETRY_TRY = /^retry[1-9]\d{0,5}$/
const LLM_STEP = /^[a-z][a-z0-9-]{0,39}$/

const roleOf = (part: string | undefined): number | null => (part !== undefined && ROLE_INDEX.test(part) ? Number(part) : null)

/** A picture child's role and suffixes: `[:regen]` where the prefix has a regeneration, then one of `:retryN` / `:head` / `:head-sheet`. */
function picture(rest: readonly string[], o: { name: string; kind: StepKind; regen: boolean; head: boolean }): Named | null {
  const [index, ...more] = rest
  const role = roleOf(index)
  if (role === null) return null
  const regen = o.regen && more[0] === "regen"
  const tail = regen ? more.slice(1) : more
  if (tail.length > 1) return null
  const round: Round = regen ? "regen" : "first"
  const suffix = tail[0]
  if (suffix === undefined || RETRY_TRY.test(suffix) || (o.head && suffix === "head-sheet")) return named(o.name, o.kind, round, role)
  if (o.head && suffix === "head") return named(`${o.name} — head close-up`, o.kind, round, role)
  return null
}

function llmCall(rest: readonly string[]): Named | null {
  const [step, scope] = rest
  if (step === undefined || !LLM_STEP.test(step)) return null
  if (step === "photo-labels") return named("Photo labels", "labels", "first", roleOf(scope))
  const known = LLM_STEPS.get(step)
  return known ? named(known[0], known[1]) : named(`LLM call (${step})`, "other")
}

/** What a step's key says it is; null when the key is not one of the run's own forms. */
function fromKey(key: string, runId: string, route: string): Named | null {
  const [prefix, owner, ...rest] = key.split(":")
  if (prefix === undefined || owner === undefined || owner.toLowerCase() !== runId.toLowerCase()) return null
  if (prefix === "cast-swap-child") return rest.length <= 1 ? RENDERS.get(rest[0] ?? "") ?? null : null
  if (prefix === "cast-swap-fq-child") return rest.length === 0 ? named(route === "video-upscale" ? "1080p render" : "1080p take", "render-hd") : null
  if (prefix === "cast-swap-llm") return llmCall(rest)
  const pictureOf = PICTURES.get(prefix)
  if (pictureOf) return picture(rest, pictureOf)
  const masking = MASKING.get(prefix)
  if (!masking || rest.length !== 1) return null
  const [name, kind] = masking
  if (rest[0] === "first") return named(name, kind)
  return rest[0] === "retry" ? named(`${name} (retry)`, kind, "retry") : null
}

/**
 * One tree row's identity. The run's own row (depth 0) is the run, or the
 * Full Quality try; any other row is named by its key. `local` is the
 * route's: one of `LOCAL_ROUTES`.
 */
export function stepOf(row: { depth: number; route: string; step_key: string | null }, runId: string, fullQuality: boolean): StepIdentity {
  const local = LOCAL_ROUTES.includes(row.route)
  if (row.depth === 0) return { ...named(fullQuality ? "Full Quality" : "Run", "base"), local }
  const known = row.step_key === null ? null : fromKey(row.step_key, runId, row.route)
  return { ...(known ?? named(`Other step (${row.route})`, "other")), local }
}

/**
 * Whether the run's recorded quote has `line` as a line of its own: a
 * breakdown line, or one of its two extras it records a figure for (exactly
 * the lines the drill-down lists, wire.ts).
 */
function carries(quote: QuoteRecord, line: string): boolean {
  if (line === "privacyCredits" || line === "referencesRetryCredits") return quote[line] !== null
  return Object.hasOwn(quote.breakdown, line)
}

/** The first of `lines` the quote carries: the table's line, never one the quote lacks. */
const firstCarried = (quote: QuoteRecord, lines: readonly string[]): string | null => lines.find((line) => carries(quote, line)) ?? null

/** A 1080p step's lines: Prism's finalize (`motionHd`), else the line a Pulse take is quoted on (`motion`). */
const HD_LINES = ["motionHd", "motion"] as const

/** A masking step's lines: a retry's is the quote's masking retry when the quote records it. */
const privacyLines = (retry: boolean): readonly string[] => (retry ? ["privacyCredits", "privacy"] : ["privacy"])

/** The table's lines for a step, in order of preference. */
function tableLines(step: StepIdentity, depthMapRun: boolean): readonly string[] {
  switch (step.kind) {
    case "base": return ["base"]
    case "render": return ["motion"]
    case "render-hd": return HD_LINES
    case "sheet":
    case "clip-body-picture":
      return step.round === "regen" ? ["referencesRetryCredits", "references"] : ["references"]
    case "styled-picture": return ["styleRefs"]
    case "labels":
    case "clip-body-llm":
      return ["references"]
    case "engine-prompt": return ["prompt"]
    // A Full depth's description and shot list are quoted with its depth map; a Precise run's on prompt writing.
    case "scene": return depthMapRun ? ["privacy"] : ["prompt"]
    case "vocals": return ["referenceAudio"]
    case "masking":
    case "depth-map":
      return privacyLines(step.round === "retry")
    case "other": return []
  }
}

/**
 * The recorded quote's line that covers a step, or null: a step of no line
 * (`other`), a run with no recorded quote, or a step whose line the run's
 * quote does not carry (a drift between the engine and its quote: the step
 * is then on no line rather than on one the quote lacks). Where the table
 * gives a choice, the first line the quote carries: a 1080p step's
 * `motionHd`, else `motion`; a retry's extra, when the quote records it.
 */
export function quoteLineOf(step: StepIdentity, ctx: { quote: QuoteRecord | null; depthMapRun: boolean }): string | null {
  return ctx.quote ? firstCarried(ctx.quote, tableLines(step, ctx.depthMapRun)) : null
}

interface Kept {
  name: string
  lines: (e: ReuseEntryView) => readonly string[]
}

/** A kept step's name and its lines, by the reuse record's step name. */
const KEPT: ReadonlyMap<string, Kept> = new Map<string, Kept>([
  ["reference-sheet", { name: "Reference sheet (kept)", lines: () => ["references"] }],
  ["photo-labels", { name: "Photo labels (kept)", lines: () => ["references"] }],
  ["clip-body-picture", { name: "Body from the clip — picture (kept)", lines: () => ["references"] }],
  ["styled-picture", { name: "Styled role picture (kept)", lines: () => ["styleRefs"] }],
  ["vocals", { name: "Vocals split (kept vocals)", lines: () => ["referenceAudio"] }],
  ["face-mask", { name: "Face mask (the trend's stored mask)", lines: (e) => privacyLines(e.attempt === "retry") }],
  ["depth", { name: "Depth map (the trend's stored map)", lines: () => ["privacy"] }],
  ["render", { name: "1080p render (an earlier try's)", lines: () => HD_LINES }],
])

const CLIP_NAME = "Engine-ready clip (kept, local work)"

/**
 * The run's reused steps, as rows: each entry named and given its line as a
 * step is (none without a recorded quote, and none the quote does not carry;
 * an unknown step goes by its own name, on no line), a stored mask's retry
 * named so. Every kept clip is one row with their count, where the first one
 * was: local work no line covers.
 */
export function reusedOf(entries: ReuseEntryView[], ctx: { quote: QuoteRecord | null }): MotionPriceReused[] {
  const clips = entries.filter((e) => e.step === "clip").length
  const firstClip = entries.findIndex((e) => e.step === "clip")
  return entries.flatMap((e, i): MotionPriceReused[] => {
    if (e.step === "clip") {
      return i === firstClip ? [{ step: "clip", name: CLIP_NAME, role: null, jobId: null, count: clips, quoteLine: null }] : []
    }
    const kept = KEPT.get(e.step)
    const name = kept ? `${kept.name}${e.step === "face-mask" && e.attempt === "retry" ? " (retry)" : ""}` : e.step
    const quoteLine = kept && ctx.quote ? firstCarried(ctx.quote, kept.lines(e)) : null
    return [{ step: e.step, name, role: e.role, jobId: e.jobId, count: 1, quoteLine }]
  })
}
