/**
 * What one Edit with AI run says while it works, and how it ends. Everything
 * it says goes out as dictionary keys, so the panel renders it in the
 * person's language.
 */
import type { MessageKey } from "@/lib/i18n"
import type { AgentId } from "../abilities"
import type { PhoneFraming } from "../crop-path"
import type { EditPlan, EditStep, TimedWord } from "../edit-plan"
import type { PictureRecord } from "../picture-rows"
import type { ShotTrackSet } from "../shot-layout"
import type { TitleRecord } from "../title-style"
import type { SpeakerLayout } from "../speaker-layout"

export type { AgentId, PhoneFraming }

export const AGENT_COLORS: Record<AgentId, string> = {
  lead: "#f08c3a",
  cutter: "#ff7a5c",
  captions: "#f2d64b",
  sound: "#f28ad0",
  broll: "#8fdc5c",
  picture: "#c39bff",
  color: "#8fa2ff",
  framer: "#5ccfe0",
  director: "#ededf2",
}

export type AgentState = "waiting" | "working" | "done" | "skipped" | "failed"

export type Vars = Record<string, string | number>

/** A video once it has been heard: listening is paid once per video, and every later run reads these. */
export interface HeardVideo {
  readonly words: readonly TimedWord[]
  readonly language: string | null
  /** The transcription as the platform answered it (with speakers): what the planning routes read. */
  readonly transcript?: unknown
}

/** Something a run made beside the edit (a clip, a trailer, a chapter list): it stays when the edit is undone. */
export interface MadeResult {
  readonly id: string
  readonly kind: "clip" | "trailer" | "chapters"
  /** "Clip 1", "Trailer", "Chapters". */
  readonly key: MessageKey
  readonly vars?: Vars
  /** The editor tab it is in, for "Open its tab". */
  readonly sequenceId?: string
  /** How long it plays, in seconds. */
  readonly seconds?: number
  /** A chapter list: each title at its time on the edit. */
  readonly chapters?: ReadonlyArray<{ readonly seconds: number; readonly title: string }>
}

export type RunEvent =
  | { readonly type: "plan"; readonly plan: EditPlan }
  /** The video was listened to (it was not heard before this run). */
  | { readonly type: "heard"; readonly heard: HeardVideo }
  /** One step's state. `detail` is the provider's or the editor's own words about a step that failed. */
  | { readonly type: "step"; readonly step: EditStep; readonly state: AgentState; readonly key: MessageKey; readonly vars?: Vars; readonly progress?: number; readonly detail?: string }
  /** Which agents are at work now (for the status line). */
  | { readonly type: "agents"; readonly working: readonly AgentId[] }
  | { readonly type: "feed"; readonly agent: AgentId; readonly key: MessageKey; readonly vars?: Vars }
  /** One undo entry this run made in the editor, with its label and the step it stands for. */
  | { readonly type: "recorded"; readonly label: string; readonly step: EditStep }
  | { readonly type: "made"; readonly result: MadeResult }
  /** A wait for a free slot on the person's account (other runs are using them). */
  | { readonly type: "waiting"; readonly waiting: boolean }
  /** The phone version's crop, kept so Wide | Phone can switch back and forth. */
  | { readonly type: "framing"; readonly framing: PhoneFraming }
  /** The face tracks a speaker layout was made from, kept so one stretch of it can be shown another way. */
  | { readonly type: "faces"; readonly set: ShotTrackSet; readonly layout: SpeakerLayout }
  /** What the run knows about the pictures it laid on the words, and the ones that were not made. */
  | { readonly type: "pictures"; readonly pictures: readonly PictureRecord[] }
  /** The texts the run laid on the screen. */
  | { readonly type: "titles"; readonly titles: readonly TitleRecord[] }
  /** A picture change still rendering when the run stopped waiting for it: followed on, and laid when it is ready. */
  | { readonly type: "late"; readonly picture: LatePicture }
  /** The color look's effects, kept so asking again replaces them. */
  | { readonly type: "color"; readonly effects: ReadonlyArray<{ readonly itemId: string; readonly effectId: string }> }
  /** The editor's player now shows this (the finale shows the original and the edit side by side). */
  | { readonly type: "compare"; readonly mode: "program" | "source" | "split" }
  /** Where the run is: reading the request, listening to the video, or at work. */
  | { readonly type: "phase"; readonly phase: "reading" | "listening" | "working" }
  | { readonly type: "done"; readonly summary: RunSummary }

/** A picture change whose render outlasted its run. */
export interface LatePicture {
  readonly jobId: string
  /** The video it changes, as the editor knows it. */
  readonly mediaId: string
  /** The seconds of the video it changes. */
  readonly span: { readonly start: number; readonly end: number }
}

export interface RunSummary {
  readonly fromSeconds: number
  readonly toSeconds: number
  readonly pausesCut: number
  readonly fillersCut: number
  readonly mistakesCut: number
  readonly captions: number
  readonly music: boolean
  readonly bpm: number | null
  readonly broll: number
  readonly titles: number
  readonly picture: boolean
  readonly look: string | null
  readonly zooms: number
  readonly phone: boolean
  readonly switches: number
  readonly clips: number
  readonly trailer: boolean
  readonly chapters: number
}

export const EMPTY_SUMMARY: Omit<RunSummary, "fromSeconds" | "toSeconds"> = {
  pausesCut: 0,
  fillersCut: 0,
  mistakesCut: 0,
  captions: 0,
  music: false,
  bpm: null,
  broll: 0,
  titles: 0,
  picture: false,
  look: null,
  zooms: 0,
  phone: false,
  switches: 0,
  clips: 0,
  trailer: false,
  chapters: 0,
}

/** The paid parts a plan adds beyond the price the person was shown. */
export interface ExtraCharge {
  readonly listen: boolean
  /** Paid steps the price left out. */
  readonly steps: readonly EditStep[]
}

/** A run that stopped on purpose (the person pressed Stop or closed the editor). */
export class RunStopped extends Error {
  constructor() {
    super("Stopped")
    this.name = "RunStopped"
  }
}

/** A run that could not go on, with what the panel tells the person. `detail` is the provider's or the editor's own words. */
export class RunFailed extends Error {
  constructor(
    readonly key: MessageKey,
    readonly vars?: Vars,
    readonly detail?: string,
  ) {
    super(key)
    this.name = "RunFailed"
  }
}

/**
 * Why a request ended before anything paid started: it asked for nothing this
 * edit can do ("nothing"), only for things it cannot do ("cannot"), the person
 * chose not to run only part of it ("cannot" too), or everything it asked for
 * is already done on this video ("done").
 */
export type DeclinedReason = "nothing" | "cannot" | "done"

export class RunDeclined extends Error {
  readonly reason: DeclinedReason

  constructor(
    readonly plan: EditPlan,
    reason?: DeclinedReason,
  ) {
    super("Declined")
    this.name = "RunDeclined"
    this.reason = reason ?? (plan.cannot.length > 0 ? "cannot" : "nothing")
  }
}
