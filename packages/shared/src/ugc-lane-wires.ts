/**
 * The UGC wires of a language whose clips are cut from one recorded speech (the
 * segmented lane): UGC Clips' prelude (record the speech, time its words, split
 * it at its pauses, then ask for the clips again with the segments) and UGC
 * Finish (lay the speech back over the rendered clips and trim the dead air,
 * as one job over all of them). One pure implementation both engines call, as
 * the rest of the UGC wires (`ugc-node-wires.ts`).
 *
 * Content-free: an answer is read only for `phase`, its three calls' `tool`
 * and `args` (argument names, never their meaning), the `finish` call's
 * `args`, and a finished job's clip list. Which language takes this lane, which
 * voice speaks and what the calls say are the builder's.
 */
import {
  UGC_FINISH_NEEDS_CLIPS_MESSAGE,
  UGC_FINISH_NOT_READY_MESSAGE,
  UGC_NEEDS_FINISH_MESSAGE,
  UGC_NEWER_APP_MESSAGE,
  UGC_NODE_MESSAGES,
  UGC_OVER_HOLD_MESSAGE,
  UGC_SCRIPT_LANGUAGES,
  readUgcWire,
  ugcPlanLengthSec,
  ugcPlanScreenshotCount,
} from "./ugc-node-wires.js"
import type { FanOutItemMeta } from "./fan-out-meta.js"

type Obj = Record<string, unknown>
const isObject = (x: unknown): x is Obj => !!x && typeof x === "object" && !Array.isArray(x)

/** UGC Finish's node type. Not the plugin job it runs (`ugc-finish`): a price, a dispatch or a reconcile keyed on a type never confuses the two. */
export const UGC_FINISH_CLIPS_TYPE = "ugc-finish-clips"

/** The child steps of UGC Clips' prelude, in run order: each is a job of its own, keyed by its step. */
export const UGC_PRELUDE_STEPS = ["speech", "alignment", "split"] as const
export type UgcPreludeStep = (typeof UGC_PRELUDE_STEPS)[number]

/** The public route each prelude step runs on, and the node type its job is read as. */
export const UGC_PRELUDE_ROUTES: Readonly<Record<UgcPreludeStep, { readonly path: string; readonly jobType: string }>> = {
  speech: { path: "/v1/text-to-speech", jobType: "text-to-speech" },
  alignment: { path: "/v1/forced-alignment", jobType: "forced-alignment" },
  split: { path: "/v1/ugc/segments", jobType: "ugc-segments" },
}

/** The `/v1/ugc/clips` answer's phase: 1 = the prelude must run first, 2 = the clips; null = an answer with no phase (one call, as English). */
export function ugcClipsPhase(answer: Readonly<Obj>): 1 | 2 | null {
  return answer.phase === 1 ? 1 : answer.phase === 2 ? 2 : null
}

const callOf = (raw: unknown, tool: string): Obj | undefined => {
  if (!isObject(raw) || raw.tool !== tool || !isObject(raw.args)) return undefined
  return raw.args
}
const pick = (a: Readonly<Obj>, from: string, to: string): Obj => (a[from] !== undefined && a[from] !== null ? { [to]: a[from] } : {})

/** What the prelude runs: the speech's route body, and the two that need the step before them. */
export interface UgcPrelude {
  readonly speech: Obj
  readonly alignment: (audioUrl: string) => Obj
  readonly split: (audioUrl: string, alignment: unknown) => Obj
}

/**
 * A phase-1 answer's three calls (`speech`, `align`, `split`, MCP argument names) → the REST bodies of
 * the public routes their MCP tools dispatch to: `generate_speech` → `/v1/text-to-speech` (text, voice,
 * voice type, model as provider, language code, as the verb maps them), `forced_alignment` →
 * `/v1/forced-alignment` (the transcript, with the speech's audio), `ugc_split_speech` →
 * `/v1/ugc/segments` (the plan, with the speech's audio and its word timings). A call that is missing
 * or names another tool → the newer-app sentence: the app never guesses.
 */
export function ugcPrelude(answer: Readonly<Obj>): UgcPrelude | { readonly error: string } {
  const speech = callOf(answer.speech, "generate_speech")
  const align = callOf(answer.align, "forced_alignment")
  const split = callOf(answer.split, "ugc_split_speech")
  if (!speech || !align || !split || typeof speech.text !== "string" || !isObject(split.plan)) return { error: UGC_NEWER_APP_MESSAGE }
  return {
    speech: {
      text: speech.text,
      ...pick(speech, "voice_id", "voice"),
      ...pick(speech, "voice_type", "voiceType"),
      ...pick(speech, "model", "provider"),
      ...pick(speech, "language_code", "languageCode"),
    },
    alignment: (audioUrl) => ({ ...pick(align, "transcript", "transcript"), audioUrl }),
    split: (audioUrl, alignment) => ({ plan: split.plan, audioUrl, alignment }),
  }
}

/** The finished speech job's audio, its word timings and its segments, as their jobs write them. */
export function ugcPreludeOutput(step: UgcPreludeStep, output: Readonly<Obj> | undefined): { value: unknown } | { error: string } {
  const value = step === "speech" ? output?.audioUrl : step === "alignment" ? output?.alignment : output?.segments
  const ok = step === "speech" ? typeof value === "string" && value !== "" : Array.isArray(value) && value.length > 0
  return ok ? { value } : { error: UGC_NEWER_APP_MESSAGE }
}

/** The second `/v1/ugc/clips` call: the first call's body with the segments the split returned. */
export function ugcClipsPhase2Body(body: Readonly<Obj>, segments: readonly unknown[]): Obj {
  return { ...body, segments: [...segments] }
}

// ── The hold check once the speech is split ──────────────────────────────────

/** The estimate input of a video cut from one recorded speech, as the hold check names it (`runEstimate`). */
export interface UgcRunEstimateInput {
  readonly targetDurationSec: number
  readonly screenshotCount: number
  readonly source: "sampled"
  readonly language: string
}

/**
 * The estimate input of the video a UGC Clips run belongs to, read from the plan the node was sent: its
 * length, its screenshot cards and its language — the reading a kept plan is priced with. Read on a
 * phase-1 answer, before the prelude spends anything, so a plan the check cannot read refuses the run
 * while nothing is paid. The creator's source prices no clip, so it is not read. A plan without a length,
 * or without a language this lane takes → the newer-app sentence: the check never guesses.
 */
export function ugcRunEstimateInput(plan: unknown): { runEstimate: UgcRunEstimateInput } | { error: string } {
  const targetDurationSec = ugcPlanLengthSec(plan)
  const language = planOf(plan)?.language
  if (targetDurationSec === undefined || typeof language !== "string" || language === "en" || !(UGC_SCRIPT_LANGUAGES as readonly unknown[]).includes(language)) {
    return { error: UGC_NEWER_APP_MESSAGE }
  }
  return { runEstimate: { targetDurationSec, screenshotCount: ugcPlanScreenshotCount(plan) ?? 0, source: "sampled", language } }
}

/**
 * The quote that checks a video cut from one recorded speech before any of its clips renders: the clips
 * the second `/v1/ugc/clips` call handed on, priced as the UGC Clips quote prices them (`tickets`,
 * `hasCards`, `finishes`), with `runEstimate` (`ugcRunEstimateInput`). The route then also answers
 * `runHold`, the most the video's estimate holds for the clips and the steps after them, which the run's
 * balance was checked against before it started (`ugcRenderHoldVerdict`). No clips → the newer-app sentence.
 */
export function ugcRenderHoldBody(input: { runEstimate: UgcRunEstimateInput; tickets: unknown; hasCards: boolean; finishes: boolean }): { path: "/v1/ugc/quote"; body: Obj } | { error: string } {
  if (!Array.isArray(input.tickets) || input.tickets.length === 0) return { error: UGC_NEWER_APP_MESSAGE }
  return {
    path: "/v1/ugc/quote",
    body: {
      tickets: [...input.tickets],
      hasCards: input.hasCards,
      ...(input.finishes ? { finishes: true } : {}),
      runEstimate: { ...input.runEstimate },
    },
  }
}

/** A plan, or its wire (a JSON string), as an object; undefined for anything else. */
function planOf(plan: unknown): Obj | undefined {
  if (typeof plan !== "string") return isObject(plan) ? plan : undefined
  try {
    const parsed: unknown = JSON.parse(plan)
    return isObject(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

const isCredits = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0

/**
 * The hold check's answer → go on, or stop before any clip renders: the clips and the steps after them
 * (`ceiling`, each clip at its hold) over what the run was checked for (`runHold`) → the over-hold
 * sentence. An answer without both figures stops too (the newer-app sentence): a clip never renders
 * on a figure nobody checked.
 */
export function ugcRenderHoldVerdict(answer: unknown): { readonly ok: true } | { readonly error: string } {
  if (!isObject(answer) || !isCredits(answer.ceiling) || !isCredits(answer.runHold)) return { error: UGC_NEWER_APP_MESSAGE }
  return answer.ceiling > answer.runHold ? { error: UGC_OVER_HOLD_MESSAGE } : { ok: true }
}

// ── UGC Finish ───────────────────────────────────────────────────────────────

/** What UGC Finish does with the clips it was handed. */
export type UgcFinishPlan =
  /** No finish call on the plan (English): the clips go on as they came, no call, no job. */
  | { readonly kind: "pass"; readonly clips: readonly string[] }
  /** The finish job's body: the segments with their room, one roll per clip, in order. */
  | { readonly kind: "job"; readonly path: "/v1/ugc/finish"; readonly body: Obj }

/**
 * UGC Finish's input → what it does. The `plan` input is UGC Clips' Script (sized) output; a plan
 * carrying `finish` (the segmented lane) asks for the finish job over the clips, in order; any other
 * plan passes the clips through. Clips are the fan-in list (`inputs.inputs`), in clip order.
 */
export function ugcFinishPlan(input: { planOutWire: unknown; clipUrls: readonly unknown[] }): UgcFinishPlan | { readonly error: string } {
  const clips = input.clipUrls.filter((u): u is string => typeof u === "string" && u !== "")
  if (clips.length === 0) return { error: UGC_FINISH_NEEDS_CLIPS_MESSAGE }
  const read = readUgcWire(input.planOutWire, UGC_NODE_MESSAGES.needsPlanOut)
  if ("error" in read) return read
  const finish = read.value.finish
  if (finish === undefined) return { kind: "pass", clips }
  if (!isObject(finish) || !Array.isArray(finish.segments) || finish.segments.length === 0) return { error: UGC_NEWER_APP_MESSAGE }
  if (finish.segments.length !== clips.length) return { error: UGC_NEWER_APP_MESSAGE }
  return {
    kind: "job",
    path: "/v1/ugc/finish",
    body: { segments: finish.segments, clips: clips.map((url, i) => ({ clip: i + 1, rolls: [url] })) },
  }
}

/** A finished clip, as UGC Finish hands it on: its URL and the notes its downstream nodes read. */
export interface UgcFinishedClip { readonly url: string; readonly meta: FanOutItemMeta }

/**
 * A finished `ugc-finish` job → the finished clips in clip order, each with its real length. `ready: false`
 * (a clip that does not follow its speech) → the not-ready sentence: the node fails, never hands on a
 * partial list. A dry finish's warning rides every clip's notes.
 */
export function ugcFinishOutputs(output: Readonly<Obj> | undefined): { clips: UgcFinishedClip[] } | { error: string } {
  if (!output) return { error: UGC_NEWER_APP_MESSAGE }
  if (output.ready === false) return { error: UGC_FINISH_NOT_READY_MESSAGE }
  if (output.ready !== true || !Array.isArray(output.clips) || output.clips.length === 0) return { error: UGC_NEWER_APP_MESSAGE }
  const warnings = Array.isArray(output.warnings)
    ? output.warnings.flatMap((w) => (isObject(w) && typeof w.code === "string" ? [w.code] : typeof w === "string" ? [w] : []))
    : []
  const rows = [...output.clips].filter(isObject).sort((a, b) => Number(a.clip) - Number(b.clip))
  if (rows.length !== output.clips.length || rows.some((r, i) => r.clip !== i + 1 || typeof r.url !== "string" || r.url === "")) return { error: UGC_NEWER_APP_MESSAGE }
  return {
    clips: rows.map((r) => ({
      url: r.url as string,
      meta: { warnings, durationSec: typeof r.sec === "number" && Number.isFinite(r.sec) && r.sec > 0 ? r.sec : null },
    })),
  }
}

/**
 * Whether a UGC Finish reads this UGC Clips node's Script (sized) output: the graph can finish a video
 * whose clips are cut from one recorded speech. Read before the prelude spends anything.
 */
export function ugcFinishWired(
  edges: ReadonlyArray<{ readonly source?: string; readonly target?: string; readonly sourceHandle?: string | null; readonly targetHandle?: string | null }>,
  nodes: ReadonlyArray<{ readonly id?: string; readonly type?: string | null }>,
  clipsId: string,
): boolean {
  const finishIds = new Set(nodes.filter((n) => n.type === UGC_FINISH_CLIPS_TYPE && typeof n.id === "string").map((n) => n.id as string))
  return edges.some((e) => e.source === clipsId && e.sourceHandle === "plan-out" && e.target !== undefined && finishIds.has(e.target) && (e.targetHandle ?? "") === "plan")
}

/** UGC Clips' refusal before its prelude: the sentence when no UGC Finish reads its Script (sized) output, else null. */
export function ugcLaneNeedsFinish(
  edges: Parameters<typeof ugcFinishWired>[0],
  nodes: Parameters<typeof ugcFinishWired>[1],
  clipsId: string,
): string | null {
  return ugcFinishWired(edges, nodes, clipsId) ? null : UGC_NEEDS_FINISH_MESSAGE
}
