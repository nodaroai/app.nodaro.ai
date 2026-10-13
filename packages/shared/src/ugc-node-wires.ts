/**
 * The UGC node wires: every request body the five UGC nodes send and every
 * output they hand on, as ONE pure implementation that both engines (the
 * workflow orchestrator and the editor) call, so the two can never disagree.
 *
 * Content-free. A creator record is read only for `v`, `gender` and
 * `identityImages`, a plan only for `v`, a clip ticket only for `v`, `index`
 * and `durationSec`; every other key is opaque and passes through as it came.
 * Every UGC-private JSON a node emits carries `v: 1`, and a wire with another
 * `v` is refused, never guessed at.
 */
import type { CaptionPlan } from "./caption-plan.js"
import { fanOutItemMeta, type ClipNote } from "./fan-out-meta.js"
import { DEFAULT_TRANSCRIBE_NODE_PROVIDER } from "./model-constants.js"
import { ugcPickPending } from "./ugc-run-state.js"

/** A UGC call that reached a deployment without the UGC routes (the router's 404). */
export const UGC_NOT_SERVED_MESSAGE = "UGC videos are a Nodaro Cloud feature and are not served on this deployment."
/** A wire whose `v` this app does not read. */
export const UGC_VERSION_MESSAGE = "This workflow was made with a newer version of the UGC nodes."
/** An answer this app cannot run: a tool it does not know, or a shape it cannot read. */
export const UGC_NEWER_APP_MESSAGE = "This step needs a newer app version."
/** A creator pick whose options are gone (another run replaced them, or they were never this node's). */
export const UGC_PICK_GONE_MESSAGE = "These creator options are no longer available. Run UGC Creator again."
/** UGC Clips with no creator on its creator input (UGC Creator has not run, or waits for a pick). */
export const UGC_CREATOR_MISSING_MESSAGE = "UGC Creator has no creator yet. Run it, or pick one of its options."
/** UGC Script's target length in seconds when the node holds none: the node's default (the route requires a length). */
export const UGC_SCRIPT_DEFAULT_TARGET_SEC = 15
/** The range of a UGC script's length, in whole seconds: the script route's, and a plan's own. */
export const UGC_SCRIPT_MIN_TARGET_SEC = 4
export const UGC_SCRIPT_MAX_TARGET_SEC = 300

const MINOR_AGE_MESSAGE = "That age can't be used: UGC creators are adults only."
const NEEDS_GENDER = "Choose woman or man."
const NEEDS_PHOTO = "Connect or upload a photo of yourself."
const NEEDS_CATEGORY = "Run UGC Script first, or pick a product category."
const NEEDS_SITE = "Add the product name or website."
/** The opening of the sentence UGC Clips fails with when the plugin refuses the script: "<this> <each error and its fix>". */
export const UGC_SCRIPT_NEEDS_CHANGES = "The script needs changes:"
const NEEDS_PLAN_OUT = "Connect the Script (sized) output of UGC Clips."
const NEEDS_PLAN = "Connect the Script output of UGC Script."
const NEEDS_TICKET = "Connect the Clips output of UGC Clips."
const NEEDS_VIDEO = "Connect the joined video."
const NEEDS_TRANSCRIPT = "Connect the Transcript output of UGC Clips."
/**
 * A run of a video whose clips are cut from one recorded speech, on a graph with no UGC Finish on this UGC
 * Clips' Script (sized) output: refused before anything is spent.
 */
export const UGC_NEEDS_FINISH_MESSAGE = "Add a UGC Finish node after UGC Clip, and connect UGC Clips' Script (sized) output to it."
/** UGC Finish with nothing on its clips input. */
export const UGC_FINISH_NEEDS_CLIPS_MESSAGE = "Connect the Video output of UGC Clip."
/** UGC Finish's job answered that a clip does not follow its speech (each clip checks itself first, so this is rare). */
export const UGC_FINISH_NOT_READY_MESSAGE = "A clip did not follow its speech. Re-render it from the UGC Clip node and run again."

/**
 * Every fixed sentence a UGC node fails with, by id: the English both engines write on the node.
 * The editor shows each in the person's language by its id. Not listed: the sentence that opens
 * with `UGC_SCRIPT_NEEDS_CHANGES` (the plugin's own words finish it), a route's own message, and
 * "UGC step failed (<status>)".
 */
export const UGC_NODE_MESSAGES = Object.freeze({
  notServed: UGC_NOT_SERVED_MESSAGE,
  version: UGC_VERSION_MESSAGE,
  newerApp: UGC_NEWER_APP_MESSAGE,
  pickGone: UGC_PICK_GONE_MESSAGE,
  creatorMissing: UGC_CREATOR_MISSING_MESSAGE,
  minorAge: MINOR_AGE_MESSAGE,
  needsGender: NEEDS_GENDER,
  needsPhoto: NEEDS_PHOTO,
  needsCategory: NEEDS_CATEGORY,
  needsSite: NEEDS_SITE,
  needsPlanOut: NEEDS_PLAN_OUT,
  needsPlan: NEEDS_PLAN,
  needsTicket: NEEDS_TICKET,
  needsVideo: NEEDS_VIDEO,
  needsTranscript: NEEDS_TRANSCRIPT,
  needsFinish: UGC_NEEDS_FINISH_MESSAGE,
  finishNeedsClips: UGC_FINISH_NEEDS_CLIPS_MESSAGE,
  finishNotReady: UGC_FINISH_NOT_READY_MESSAGE,
} as const)

/** The id of a fixed sentence a UGC node fails with (`UGC_NODE_MESSAGES`). */
export type UgcNodeMessageId = keyof typeof UGC_NODE_MESSAGES

/** UGC Script's screenshot inputs, in card order. */
export const UGC_SCREENSHOT_HANDLES: readonly string[] = [
  "screenshot", "screenshot2", "screenshot3", "screenshot4", "screenshot5", "screenshot6", "screenshot7", "screenshot8",
]

/** Per UGC type, the output an edge with no source handle reads. */
export const UGC_PRIMARY_HANDLE: Readonly<Record<string, string>> = {
  "ugc-creator": "creator",
  "ugc-script": "plan",
  "ugc-clips": "clips",
  "ugc-clip": "video-out",
  "ugc-cards": "layerPlan",
  "ugc-finish-clips": "video-out",
}

/** A UGC node's outputs: handle id → the value that handle carries (a JSON string, text or a URL). */
export type UgcOutputs = Readonly<Record<string, string>>

type Obj = Record<string, unknown>
const isObject = (x: unknown): x is Obj => !!x && typeof x === "object" && !Array.isArray(x)

/**
 * The length a saved UGC plan was written to: its own `targetDurationSec`, a whole number of
 * seconds in the script's range. Besides the lines (the opening line, each beat's line, the
 * closing line), one of the two keys of a plan the app reads (the other: whether each beat carries
 * a screenshot, `ugcPlanScreenshotCount`): a script that hands on its saved plan is priced at the
 * plan's length, and shows it, never at the length setting, which may have changed since. Takes
 * the plan or its wire (a JSON string); undefined for anything that is not a plan carrying a length.
 */
export function ugcPlanLengthSec(plan: unknown): number | undefined {
  const value = savedPlanOf(plan)
  if (!value) return undefined
  const sec = value.targetDurationSec
  return typeof sec === "number" && Number.isInteger(sec) && sec >= UGC_SCRIPT_MIN_TARGET_SEC && sec <= UGC_SCRIPT_MAX_TARGET_SEC ? sec : undefined
}

/**
 * How many of a saved UGC plan's beats carry a screenshot: the screenshot cards the plan was
 * written with. Read beat by beat: a beat carries one when its `screenshot` is an object, as the
 * plan's own screenshots are (whatever it names); a beat that is not an object, or whose screenshot
 * is anything else, carries none — and never makes the rest unreadable. A plan whose beats carry
 * none is a talking-head plan (0). Read, like its length, so a script that hands on its saved plan
 * is priced at the screenshots that plan holds, never at the script's wires, which may have changed
 * since. Takes the plan or its wire (a JSON string); undefined only for a plan with no beats to read
 * and for anything that is not a plan.
 */
export function ugcPlanScreenshotCount(plan: unknown): number | undefined {
  const value = savedPlanOf(plan)
  if (!value || !Array.isArray(value.beats)) return undefined
  return value.beats.filter((beat) => isObject(beat) && isObject(beat.screenshot)).length
}

/** A saved plan, or its wire (a JSON string), as an object; undefined for anything else. */
function savedPlanOf(plan: unknown): Obj | undefined {
  let value: unknown = plan
  if (typeof value === "string") {
    try {
      value = JSON.parse(value)
    } catch {
      return undefined
    }
  }
  return isObject(value) ? value : undefined
}
/** A string with something in it; an empty or blank field or input counts as absent. */
const filled = (x: unknown): string | undefined => (typeof x === "string" && x.trim() !== "" ? x : undefined)

/**
 * What an edge from a UGC node reads, on both engines: the value of the pip it leaves — an edge
 * with no source handle reads the node's primary output — from the node's outputs by pip. Only a
 * pip the outputs hold as a string ("" included: an empty transcript is a value); an inherited
 * key or a non-string is no value.
 */
export function ugcPipValue(outputs: unknown, sourceType: string, sourceHandle?: string | null): string | undefined {
  const pip = sourceHandle || (Object.hasOwn(UGC_PRIMARY_HANDLE, sourceType) ? UGC_PRIMARY_HANDLE[sourceType] : undefined)
  if (pip === undefined || !isObject(outputs) || !Object.hasOwn(outputs, pip)) return undefined
  const value = outputs[pip]
  return typeof value === "string" ? value : undefined
}

/**
 * A UGC wire (a JSON string or an object) → its value when it is an object with `v: 1`.
 * Another `v` → the version message. Anything that is not a UGC wire at all (nothing
 * connected, not JSON, no `v`) → `unreadable`, which a node words as the input it needs.
 */
export function readUgcWire(raw: unknown, unreadable: string = UGC_VERSION_MESSAGE): { value: Record<string, unknown> } | { error: string } {
  let parsed: unknown = raw
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { error: unreadable }
    }
  }
  if (!isObject(parsed) || parsed.v === undefined) return { error: unreadable }
  if (parsed.v !== 1) return { error: UGC_VERSION_MESSAGE }
  return { value: parsed }
}

/** The route's `{ error: { code, message } }` (or a framework error's top-level `message`). */
function routeErrorOf(body: string): { code?: string; message?: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return {}
  }
  if (!isObject(parsed)) return {}
  if (isObject(parsed.error)) {
    const { code, message } = parsed.error
    return { code: typeof code === "string" ? code : undefined, message: filled(message) }
  }
  return { message: filled(parsed.message) }
}

/**
 * A failed UGC call → the sentence the node fails with. A 404 that names no error code is
 * the router's (the route is not registered here) → the Cloud sentence; a route's own 404
 * names a code and keeps its message. `minor_age_refused` → the adults-only sentence. A 4xx
 * or 503 → the route's message. Anything else → "UGC step failed (<status>)".
 */
export function ugcFailure(status: number, body: string): string {
  const error = routeErrorOf(body)
  if (status === 404 && error.code === undefined) return UGC_NOT_SERVED_MESSAGE
  if (error.code === "minor_age_refused") return MINOR_AGE_MESSAGE
  if ((status === 503 || (status >= 400 && status < 500)) && error.message) return error.message
  return `UGC step failed (${status})`
}

// ── UGC Creator ──────────────────────────────────────────────────────────────

/**
 * The pickers whose own set fields shape a sampled creator: the picker types UGC Creator's
 * `pickers` input takes (the route takes no other). One list for the editor's connection rule
 * and both engines' input resolvers.
 */
export const UGC_CREATOR_PICKER_TYPES: ReadonlySet<string> = new Set(["person", "styling", "setting", "lighting"])

/** The UGC Creator node-data keys its request body reads. */
export interface UgcCreatorFields {
  readonly source?: string
  readonly gender?: string
  readonly photoUrl?: string
  readonly categoryOverride?: string
  readonly seed?: number
  readonly keepResult?: boolean
  readonly result?: Readonly<Record<string, unknown>>
  /** The options a draw left waiting for the pick (run state): read only for `previous`. */
  readonly candidates?: unknown
}

/** The traits of the latest creator the person saw: the first waiting option's, else the last result's (Keep off). */
function previousTraits(data: UgcCreatorFields): unknown {
  if (ugcPickPending(data)) {
    const first: unknown = (data.candidates as readonly unknown[])[0]
    const record = isObject(first) ? first.record : undefined
    return isObject(record) ? record.traits : undefined
  }
  return !data.keepResult && isObject(data.result) ? data.result.traits : undefined
}

/** The wired pickers that set a field (their own fields, as the resolver read them); undefined when none did. */
function setPickers(pickers: Record<string, Record<string, unknown>> | undefined): Record<string, Record<string, unknown>> | undefined {
  if (!pickers) return undefined
  const set = Object.entries(pickers).filter(([, fields]) => isObject(fields) && Object.keys(fields).length > 0)
  return set.length > 0 ? Object.fromEntries(set) : undefined
}

/**
 * The `/v1/ugc/creator` body. A photo: the wired photo, else the node's own. A sampled
 * creator: the product category (the node's override, else the wired one), the pickers that
 * set a field, the node's seed, and the traits of the latest creator the person saw as
 * `previous`, so the next one differs: the first option waiting for the pick, else — on a
 * re-run that does not keep the result — the last creator's. Refuses before any call.
 */
export function ugcCreatorBody(input: {
  data: UgcCreatorFields
  photoUrl?: string
  category?: string
  pickers?: Record<string, Record<string, unknown>>
}): { body: Record<string, unknown> } | { error: string } {
  const { data } = input
  const gender = data.gender
  if (gender !== "woman" && gender !== "man") return { error: NEEDS_GENDER }
  if (data.source === "photo") {
    const imageUrl = filled(input.photoUrl) ?? filled(data.photoUrl)
    if (!imageUrl) return { error: NEEDS_PHOTO }
    return { body: { source: { kind: "photo", imageUrl, gender } } }
  }
  const productCategory = filled(data.categoryOverride) ?? filled(input.category)
  if (!productCategory) return { error: NEEDS_CATEGORY }
  const pickers = setPickers(input.pickers)
  const traits = previousTraits(data)
  return {
    body: {
      ...(typeof data.seed === "number" ? { seed: data.seed } : {}),
      source: {
        kind: "sampled",
        gender,
        productCategory,
        ...(pickers ? { pickers } : {}),
        ...(isObject(traits) ? { previous: traits } : {}),
      },
    },
  }
}

/**
 * The creator the node hands on: the record (`creator`, v1) and its first image (`image`).
 * `identityImages` are the images of the candidate the node hands on — the picked one where
 * a person picked. The record copies the listed fields only, so `candidates`, `fallback`,
 * `pick` and `image` never reach the `creator` wire.
 */
export function ugcCreatorOutputs(answer: Record<string, unknown>, identityImages: readonly string[]): { outputs: UgcOutputs; imageUrl: string; record: Record<string, unknown> } {
  const record: Record<string, unknown> = {
    v: 1,
    kind: answer.kind,
    gender: answer.gender,
    identityImages: [...identityImages],
    traits: answer.traits ?? null,
    seed: answer.seed ?? null,
    promptsVersion: answer.promptsVersion,
    productCategory: answer.productCategory ?? null,
  }
  const imageUrl = identityImages[0] ?? ""
  return { outputs: { creator: JSON.stringify(record), ...(imageUrl ? { image: imageUrl } : {}) }, imageUrl, record }
}

/** One builder call as the app runs it: `tool` and `args`, nothing else (a candidate's other keys, its model included, are never read). */
export interface UgcCreatorCall { readonly tool: string; readonly args: Readonly<Record<string, unknown>> }

/** What a creator answer asks the node to render. */
export interface UgcCreatorCandidateCalls {
  /** Every candidate's image call, the primary first. One call (`image`) for an answer from before candidates; none for a photo. */
  readonly calls: readonly UgcCreatorCall[]
  /** The round's one moderation fallback: it runs once, and only when every candidate the run rendered was blocked. */
  readonly fallback: UgcCreatorCall | null
  /** "user": a person picks among `calls` where one can be asked; "primary": `calls[0]` alone; null: nothing to render (a photo). */
  readonly pick: "user" | "primary" | null
}

const callOf = (raw: unknown): UgcCreatorCall | undefined => {
  if (!raw || typeof raw !== "object") return undefined
  const { tool, args } = raw as { tool?: unknown; args?: unknown }
  if (typeof tool !== "string" || !args || typeof args !== "object" || Array.isArray(args)) return undefined
  return { tool, args: args as Readonly<Record<string, unknown>> }
}
const fallbackOf = (image: unknown): unknown => (image && typeof image === "object" ? (image as { fallback?: unknown }).fallback : undefined)

/**
 * A `/v1/ugc/creator` answer's image calls. Content-free: reads `image` (`tool`, `args`,
 * `fallback`), `candidates[].tool|args`, `fallback` and `pick.how` — never a candidate's
 * model. An answer without `candidates` (an older builder) renders `image` alone, as before.
 */
export function ugcCreatorCandidates(answer: Readonly<Record<string, unknown>>): UgcCreatorCandidateCalls | { readonly error: string } {
  const listed = answer.candidates
  const noList = listed === undefined || listed === null || (Array.isArray(listed) && listed.length === 0)
  const noImage = answer.image === undefined || answer.image === null
  if (noList && noImage) return { calls: [], fallback: null, pick: null }
  if (noList) {
    const image = callOf(answer.image)
    if (!image) return { error: UGC_NEWER_APP_MESSAGE }
    return { calls: [image], fallback: callOf(fallbackOf(answer.image)) ?? null, pick: "primary" }
  }
  if (!Array.isArray(listed)) return { error: UGC_NEWER_APP_MESSAGE }
  const calls = listed.map(callOf)
  if (calls.some((c) => c === undefined)) return { error: UGC_NEWER_APP_MESSAGE }
  const how = (answer.pick as { how?: unknown } | null | undefined)?.how
  return {
    calls: calls as UgcCreatorCall[],
    fallback: callOf(answer.fallback) ?? callOf(fallbackOf(answer.image)) ?? null,
    pick: how === "user" && calls.length > 1 ? "user" : "primary",
  }
}

/** The calls a run renders: every candidate where a person is there to pick, else the primary alone. */
export function ugcCreatorCallsToRender(c: UgcCreatorCandidateCalls, opts: { readonly personPicks: boolean }): readonly UgcCreatorCall[] {
  return opts.personPicks && c.pick === "user" ? c.calls : c.calls.slice(0, 1)
}

/** One rendered candidate that passed its checks, kept on the node until the person picks (run state, never a wire). */
export interface UgcCreatorCandidate { readonly imageUrl: string; readonly record: Readonly<Record<string, unknown>> }

export function ugcCreatorCandidate(answer: Readonly<Record<string, unknown>>, images: readonly string[]): UgcCreatorCandidate {
  const out = ugcCreatorOutputs(answer as Record<string, unknown>, images)
  return { imageUrl: out.imageUrl, record: out.record }
}

/** A UGC Creator run output that waits for the person's pick: two or more options (`ugcCandidates`). */
export function ugcAwaitsPick(output: unknown): boolean {
  const candidates = isObject(output) ? output.ugcCandidates : undefined
  return Array.isArray(candidates) && candidates.length >= 2
}

/** The person's pick, read back from node data (untrusted): a stale index, a foreign list or another version is refused. */
export function ugcCreatorPick(candidates: unknown, index: number):
  { readonly result: Readonly<Record<string, unknown>>; readonly outputs: UgcOutputs; readonly imageUrl: string } | { readonly error: string } {
  const entry: unknown = Array.isArray(candidates) && Number.isInteger(index) && index >= 0 ? candidates[index] : undefined
  const imageUrl = (entry as { imageUrl?: unknown } | undefined)?.imageUrl
  const record = (entry as { record?: unknown } | undefined)?.record
  if (typeof imageUrl !== "string" || !record || typeof record !== "object" || Array.isArray(record)) return { error: UGC_PICK_GONE_MESSAGE }
  const r = record as Record<string, unknown>
  if (r.v !== 1) return { error: UGC_VERSION_MESSAGE }
  if (!Array.isArray(r.identityImages) || r.identityImages[0] !== imageUrl) return { error: UGC_PICK_GONE_MESSAGE }
  return { result: r, outputs: { creator: JSON.stringify(r), image: imageUrl }, imageUrl }
}

// ── UGC Script ───────────────────────────────────────────────────────────────

/** The languages a UGC script can be written in: the node's choice (`UgcScriptData.language`). */
export const UGC_SCRIPT_LANGUAGES = ["en", "he"] as const
export type UgcScriptLanguage = (typeof UGC_SCRIPT_LANGUAGES)[number]

/**
 * The `/v1/ugc/script` body: the product name or website (required), the screenshot slots
 * in card order with the empty ones dropped, the product image when set, the target length
 * (`UGC_SCRIPT_DEFAULT_TARGET_SEC` when the node holds no number), and the language (the
 * node's choice; English when it holds none or one this app does not know).
 */
export function ugcScriptBody(input: {
  site?: string
  screenshots: ReadonlyArray<string | undefined>
  productImage?: string
  targetDurationSec?: number
  language?: unknown
}): { body: Record<string, unknown> } | { error: string } {
  const site = filled(input.site)?.trim()
  if (!site) return { error: NEEDS_SITE }
  const productImage = filled(input.productImage)
  return {
    body: {
      site,
      screenshots: input.screenshots.filter((s): s is string => filled(s) !== undefined),
      ...(productImage ? { productImage } : {}),
      targetDurationSec: typeof input.targetDurationSec === "number" ? input.targetDurationSec : UGC_SCRIPT_DEFAULT_TARGET_SEC,
      language: (UGC_SCRIPT_LANGUAGES as readonly unknown[]).includes(input.language) ? input.language : "en",
    },
  }
}

/** A finished UGC Script job → `plan` (the plan, v1) and `category` (text). */
export function ugcScriptOutputs(outputData: Record<string, unknown>): UgcOutputs {
  const plan = outputData.plan
  const category = filled(outputData.productCategory)
  return {
    ...(isObject(plan) ? { plan: JSON.stringify({ v: 1, ...plan }) } : {}),
    ...(category ? { category } : {}),
  }
}

/** UGC Script's last result, as the node holds it. */
export type UgcScriptResult = {
  plan: Record<string, unknown>
  productCategory: string
  warnings: unknown[]
  notes: string[]
  rounds: number
}

/** A finished UGC Script job → the node's `result`, written the same by both engines; none without a plan. */
export function ugcScriptResult(outputData: Readonly<Record<string, unknown>>): UgcScriptResult | undefined {
  const { plan, productCategory, warnings, notes, rounds } = outputData
  if (!isObject(plan)) return undefined
  return {
    plan,
    productCategory: filled(productCategory) ?? "",
    warnings: Array.isArray(warnings) ? [...warnings] : [],
    notes: Array.isArray(notes) ? notes.filter((n): n is string => typeof n === "string") : [],
    rounds: typeof rounds === "number" && Number.isFinite(rounds) ? rounds : 0,
  }
}

// ── Kept results ─────────────────────────────────────────────────────────────

/**
 * What a UGC Creator or UGC Script with Keep on hands on instead of running: the outputs of
 * the result it holds. Null — the node runs — when Keep is off, when the result holds nothing
 * to hand on (a creator without its image, a script without its plan), and for a creator whose
 * options wait for a pick, whatever Keep says. The creator record goes on unread; whoever reads
 * it refuses another version.
 */
export function ugcKeptOutputs(type: "ugc-creator" | "ugc-script", data: Readonly<Record<string, unknown>>): UgcOutputs | null {
  if (type === "ugc-creator" && ugcPickPending(data)) return null
  const result = data.keepResult === true ? data.result : undefined
  if (!isObject(result)) return null
  if (type === "ugc-creator") {
    const image = Array.isArray(result.identityImages) ? filled(result.identityImages[0]) : undefined
    return image ? { creator: JSON.stringify(result), image } : null
  }
  if (type === "ugc-script") return isObject(result.plan) ? ugcScriptOutputs(result) : null
  return null
}

// ── UGC Clips ────────────────────────────────────────────────────────────────

/** The `/v1/ugc/clips` canvas body: the plan, the creator's gender, traits and images, and the picked voice. */
export function ugcClipsBody(input: { planWire: unknown; creatorWire: unknown; voiceId?: string }): { body: Record<string, unknown> } | { error: string } {
  const plan = readUgcWire(input.planWire, NEEDS_PLAN)
  if ("error" in plan) return plan
  const creator = readUgcWire(input.creatorWire, UGC_CREATOR_MISSING_MESSAGE)
  if ("error" in creator) return creator
  const voiceId = filled(input.voiceId)
  return {
    body: {
      plan: plan.value,
      gender: creator.value.gender,
      traits: creator.value.traits ?? null,
      identityImages: creator.value.identityImages,
      surface: "canvas",
      ...(voiceId ? { voiceId } : {}),
    },
  }
}

/**
 * The `/v1/ugc/clips` answer → the tickets (one per clip, as JSON strings), `clips` (the
 * first), `plan-out` (`{ v: 1, plan, transcribeArgs }` for UGC Cards), `transcript`, and
 * whether the plan has cards. An answer with errors → "The script needs changes: …" with each
 * error and its fix; an answer without the parts UGC Cards needs fails here, before any clip
 * is paid for.
 */
export function ugcClipsOutputs(answer: Record<string, unknown>): { outputs: UgcOutputs; tickets: string[]; hasCards: boolean } | { error: string } {
  const errors = Array.isArray(answer.errors) ? answer.errors : []
  if (errors.length > 0) {
    const said = errors.flatMap((e) => (isObject(e) ? [filled(e.message), filled(e.fix)] : [])).filter((s): s is string => s !== undefined)
    return { error: said.length > 0 ? `${UGC_SCRIPT_NEEDS_CHANGES} ${said.join(" ")}` : UGC_NEWER_APP_MESSAGE }
  }
  const { tickets, sizedPlan, transcript, speechCheckCall } = answer
  if (!Array.isArray(tickets) || tickets.length === 0 || !tickets.every(isObject) || !isObject(sizedPlan) || typeof transcript !== "string") {
    return { error: UGC_NEWER_APP_MESSAGE }
  }
  const wires = tickets.map((t) => JSON.stringify(t))
  // The speech check's arguments ride to UGC Cards' transcription unread (an answer without them: none).
  const transcribeArgs = isObject(speechCheckCall) && isObject(speechCheckCall.args) ? speechCheckCall.args : {}
  // A video cut from one recorded speech (the segmented lane) also hands UGC Finish its finish call's
  // arguments (the segments with their room), opaque; any other answer's plan-out is unchanged.
  const finish = isObject(answer.finish) && isObject(answer.finish.args) ? { finish: answer.finish.args } : {}
  return {
    outputs: { clips: wires[0]!, "plan-out": JSON.stringify({ v: 1, plan: sizedPlan, transcribeArgs, ...finish }), transcript },
    tickets: wires,
    hasCards: answer.hasCards === true,
  }
}

// ── UGC Clip ─────────────────────────────────────────────────────────────────

/**
 * The `/v1/ugc/clip` body for one ticket: the ticket, `nonce` = how many times this clip was
 * re-rendered (`rerender["<clip number>"]`, else 0) and `runKey` when one is given.
 */
export function ugcClipBody(input: { ticketWire: unknown; rerender?: Readonly<Record<string, number>>; runKey?: string }):
  { body: Record<string, unknown>; clipNumber: number; durationSec: number } | { error: string } {
  const read = readUgcWire(input.ticketWire, NEEDS_TICKET)
  if ("error" in read) return read
  const ticket = read.value
  const { index, durationSec } = ticket
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) return { error: NEEDS_TICKET }
  if (typeof durationSec !== "number" || !Number.isFinite(durationSec) || durationSec <= 0) return { error: NEEDS_TICKET }
  const clipNumber = index + 1
  const count = input.rerender?.[String(clipNumber)]
  const nonce = typeof count === "number" && Number.isInteger(count) && count >= 0 ? count : 0
  const runKey = filled(input.runKey)
  return { body: { ticket, nonce, ...(runKey ? { runKey } : {}) }, clipNumber, durationSec }
}

/**
 * A finished UGC Clip job (`{ videoUrl, durationSec, clipWarnings, … }`) → `video-out`, the
 * clip's real length (null when unknown) and its warnings ([] when it has none).
 */
export function ugcClipOutputs(outputData: Record<string, unknown>): { outputs: UgcOutputs; videoUrl: string; durationSec: number | null; clipWarnings: string[] } {
  const videoUrl = filled(outputData.videoUrl) ?? ""
  const meta = fanOutItemMeta(outputData)
  return { outputs: videoUrl ? { "video-out": videoUrl } : {}, videoUrl, durationSec: meta.durationSec, clipWarnings: [...meta.warnings] }
}

/**
 * What a list read (a Bundle edge, a fold) takes from a UGC Clip's saved data, on both engines:
 * its last fanned-out batch — one take per clip, in clip order — when its last run was one; else
 * exactly the take it shows (its active result, else its video). Never the earlier takes it keeps:
 * a video of one clip (one ticket, so no fan-out) would join every take. A single run clears the
 * batch (the editor's job patch), so a batch held is always the last run's. Undefined when it holds
 * no take at all.
 */
export function ugcClipSavedList(data: unknown): string[] | undefined {
  if (!isObject(data)) return undefined
  const batch = Array.isArray(data.__listResults) ? data.__listResults.filter((u): u is string => typeof u === "string" && u !== "") : []
  if (batch.length > 0) return batch
  const results = Array.isArray(data.generatedResults) ? data.generatedResults : []
  const index = typeof data.activeResultIndex === "number" && Number.isInteger(data.activeResultIndex) ? data.activeResultIndex : 0
  const active = results[index]
  const url = (isObject(active) ? filled(active.url) : undefined) ?? filled(data.generatedVideoUrl)
  return url ? [url] : undefined
}

// ── UGC Cards ────────────────────────────────────────────────────────────────

/**
 * UGC Cards' two timing jobs on the joined video, and the plan they time. The plan input must
 * be UGC Clips' `{ v: 1, plan, transcribeArgs }`; anything else is refused before either job.
 * The transcription spreads `transcribeArgs` unread, then sets the node's own fields last, so
 * the wire can add a language but never change the provider or the word timings.
 */
export function ugcCardsJobs(input: { planOutWire: unknown; videoUrl?: string; transcript?: string }): {
  alignment: { path: "/v1/forced-alignment"; body: Record<string, unknown> }
  transcribe: { path: "/v1/transcribe"; body: Record<string, unknown> }
  plan: Record<string, unknown>
} | { error: string } {
  const read = readUgcWire(input.planOutWire, NEEDS_PLAN_OUT)
  if ("error" in read) return read
  const { plan, transcribeArgs } = read.value
  if (!isObject(plan) || !isObject(transcribeArgs)) return { error: NEEDS_PLAN_OUT }
  const videoUrl = filled(input.videoUrl)
  if (!videoUrl) return { error: NEEDS_VIDEO }
  // An empty transcript is what UGC Clips said, not a missing input: it goes on as it came.
  const transcript = input.transcript
  if (typeof transcript !== "string") return { error: NEEDS_TRANSCRIPT }
  return {
    alignment: { path: "/v1/forced-alignment", body: { audioUrl: videoUrl, transcript } },
    transcribe: { path: "/v1/transcribe", body: { ...transcribeArgs, audioUrl: videoUrl, provider: DEFAULT_TRANSCRIBE_NODE_PROVIDER, wordTimestamps: true } },
    plan,
  }
}

/**
 * The `/v1/ugc/cards` canvas body: the plan, the video, whichever timing came back as a list,
 * the timing jobs that failed, and the clips' notes.
 */
export function ugcCardsBody(input: {
  plan: Record<string, unknown>
  videoUrl: string
  alignment?: unknown
  words?: unknown
  failed: ReadonlyArray<"alignment" | "words">
  clipNotes: ReadonlyArray<ClipNote>
}): Record<string, unknown> {
  return {
    surface: "canvas",
    plan: input.plan,
    videoUrl: input.videoUrl,
    ...(Array.isArray(input.alignment) ? { alignment: input.alignment } : {}),
    ...(Array.isArray(input.words) ? { words: input.words } : {}),
    failed: [...input.failed],
    clipNotes: [...input.clipNotes],
  }
}

/** The caption plan when nothing could be timed: Add Captions renders no captions from it. */
const EMPTY_CAPTION_PLAN: CaptionPlan = { v: 1, hookText: "", hookEndMs: 0, bodyEndMs: 0, captions: [] }

/** The `/v1/ugc/cards` answer → `layerPlan`, `captionPlan` (v1; the empty plan when untimed) and `report` (one line per sentence). */
export function ugcCardsOutputs(answer: Record<string, unknown>): UgcOutputs {
  const timing = answer.captionTiming
  const report = answer.report
  const lines = isObject(report) && Array.isArray(report.lines) ? report.lines.filter((l): l is string => typeof l === "string") : []
  return {
    layerPlan: JSON.stringify(Array.isArray(answer.layerPlan) ? answer.layerPlan : []),
    captionPlan: JSON.stringify(isObject(timing) ? { v: 1, ...timing } : EMPTY_CAPTION_PLAN),
    report: lines.join("\n"),
  }
}
