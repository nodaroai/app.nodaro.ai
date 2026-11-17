/**
 * Edit with AI's panel, as pure functions: what each card says while a run is
 * on and after it, what the status line at the top says, and what a request is
 * charged. The panel (`components/freecut-ai`) renders these; nothing here
 * talks to the editor or the server.
 */
import type { MessageKey } from "@/lib/i18n"
import { ABILITY_OF, listensFor } from "./abilities"
import type { EditPlan, EditStep } from "./edit-plan"
import type { AgentState, DeclinedReason, ExtraCharge, RunSummary } from "./run/types"

type Vars = Record<string, string | number>

/** What one card says about its step: its state, its words, how far along it is. */
export interface StepOutcome {
  readonly state: AgentState
  readonly key: MessageKey
  readonly vars?: Vars
  readonly progress?: number
  /** The provider's or the editor's own words about a step that failed. */
  readonly detail?: string
}

export type StepOutcomes = Partial<Record<EditStep, StepOutcome>>

/** The cards with these steps forgotten (their undo entries were reverted): they can be asked for again. */
export function withoutSteps(outcomes: StepOutcomes, steps: readonly EditStep[]): StepOutcomes {
  return Object.fromEntries(Object.entries(outcomes).filter(([step]) => !steps.includes(step as EditStep))) as StepOutcomes
}

/** The cards after a stop: whatever was still at work did not finish, and can be asked for again. */
export function outcomesAfterStop(outcomes: StepOutcomes): StepOutcomes {
  return Object.fromEntries(
    Object.entries(outcomes).map(([step, o]) => [step, o && (o.state === "working" || o.state === "waiting") ? { ...o, state: "skipped" as const, key: "freecutAi.notFinished" as MessageKey, progress: undefined } : o]),
  ) as StepOutcomes
}

/** The steps a run already did on a video. */
export const doneSteps = (outcomes: StepOutcomes): EditStep[] =>
  (Object.entries(outcomes) as Array<[EditStep, StepOutcome | undefined]>).filter(([, o]) => o?.state === "done").map(([step]) => step)

/** The done steps that are not done again: asking for one again does nothing (an ability with no "again"). */
export const lockedSteps = (outcomes: StepOutcomes): EditStep[] => doneSteps(outcomes).filter((step) => !ABILITY_OF[step]?.again)

export type Phase =
  | { readonly kind: "idle" }
  | { readonly kind: "running"; readonly startedAt: number }
  /** The plan leaves part of the request out, or costs more than shown: nothing paid has started, the person chooses. */
  | { readonly kind: "confirming"; readonly plan: EditPlan; readonly extra: ExtraCharge }
  /** The request ended before anything paid started (only the reading was spent). */
  | { readonly kind: "declined"; readonly plan: EditPlan; readonly reason: DeclinedReason }
  | { readonly kind: "done"; readonly summary: RunSummary }
  | { readonly kind: "stopped" }
  | { readonly kind: "failed"; readonly reason: string; readonly detail?: string }
  | { readonly kind: "undone" }

export type StatusKind = "ready" | "busy" | "ok" | "warn" | "original"
export type StatusIcon = "dot" | "spin" | "check" | "alert" | "ban" | "square" | "undo" | "eye"

export interface StatusModel {
  readonly kind: StatusKind
  readonly icon: StatusIcon
  readonly title: MessageKey
  readonly titleVars?: Vars
  readonly sub: MessageKey | null
  readonly subVars?: Vars
  /** The run's progress, 0 to 1, while it is on. */
  readonly bar?: number
}

export type RunStage = "reading" | "listening" | "working"

export interface StatusInput {
  readonly phase: Phase
  /** Where a running run is. */
  readonly stage: RunStage
  /** Waiting for a free slot on the account. */
  readonly waiting: boolean
  readonly view: "edited" | "original"
  /** The plan's steps while a run is on, with the cards' outcomes: how far along it is. */
  readonly planSteps: readonly EditStep[]
  readonly outcomes: StepOutcomes
  /** The names of the agents at work now, in the person's language, joined. */
  readonly working: string
  readonly elapsed: string
}

/** The line at the top of the panel: it always says whether anything is happening, and what. */
export function statusOf(input: StatusInput): StatusModel {
  const { phase } = input
  if (input.view === "original") return { kind: "original", icon: "eye", title: "freecutAi.status.original", sub: "freecutAi.status.originalSub" }
  switch (phase.kind) {
    case "running": {
      if (input.waiting) return { kind: "busy", icon: "spin", title: "freecutAi.status.waitingSlot", sub: "freecutAi.status.waitingSlotSub" }
      if (input.stage === "reading" || input.planSteps.length === 0) return { kind: "busy", icon: "spin", title: "freecutAi.status.reading", sub: "freecutAi.status.readingSub" }
      if (input.stage === "listening") return { kind: "busy", icon: "spin", title: "freecutAi.status.listening", sub: "freecutAi.status.listeningSub", bar: 0.05 }
      const total = input.planSteps.length
      const finished = input.planSteps.filter((step) => {
        const state = input.outcomes[step]?.state
        return state === "done" || state === "failed" || state === "skipped"
      }).length
      const moving = input.planSteps.reduce((sum, step) => sum + (input.outcomes[step]?.state === "working" ? input.outcomes[step]?.progress ?? 0 : 0), 0)
      return {
        kind: "busy",
        icon: "spin",
        title: "freecutAi.status.working",
        titleVars: { done: finished, total },
        sub: input.working ? "freecutAi.status.workingSub" : "freecutAi.status.workingTime",
        subVars: { who: input.working, time: input.elapsed },
        bar: Math.min(1, (finished + moving) / total),
      }
    }
    case "confirming":
      return { kind: "warn", icon: "alert", title: phase.plan.cannot.length > 0 ? "freecutAi.confirmTitle" : "freecutAi.confirmCostTitle", sub: "freecutAi.confirmNote" }
    case "declined":
      return phase.reason === "done"
        ? { kind: "ready", icon: "check", title: "freecutAi.status.alreadyDone", sub: "freecutAi.status.alreadyDoneSub" }
        : { kind: "warn", icon: "ban", title: phase.reason === "cannot" ? "freecutAi.declinedTitle" : "freecutAi.declinedNothing", sub: "freecutAi.nothingEdited" }
    case "done":
      return { kind: "ok", icon: "check", title: "freecutAi.status.done", sub: "freecutAi.status.doneSub" }
    case "stopped":
      return { kind: "warn", icon: "square", title: "freecutAi.status.stopped", sub: "freecutAi.stopped" }
    case "failed":
      return { kind: "warn", icon: "alert", title: "freecutAi.status.failed", sub: null }
    case "undone":
      return { kind: "ready", icon: "undo", title: "freecutAi.status.undone", sub: "freecutAi.undone" }
    default:
      return { kind: "ready", icon: "dot", title: "freecutAi.status.ready", sub: "freecutAi.status.readySub" }
  }
}

/**
 * The platform's prices for the parts of a run, at the length of the video
 * being edited; undefined while one is unknown. Editing on the timeline itself
 * (cutting, captions, color) costs nothing.
 */
export interface EditPrices {
  /** Reading a request written in the person's own words (a request made of the cards' words is not read). */
  readonly read?: number
  readonly listen?: number
  /** The creative pass (b-roll moments, zoom lines, a trailer's moments). */
  readonly choose?: number
  readonly steps: Partial<Record<EditStep, number>>
}

export interface Cost {
  /** The whole figure, or undefined while a needed price is unknown. */
  readonly total?: number
  readonly parts: ReadonlyArray<{ readonly key: MessageKey; readonly vars?: Vars; readonly credits?: number }>
}

/** The steps that are paid, beyond reading and listening. */
export const PAID_STEPS: readonly EditStep[] = ["mistakes", "music", "broll", "picture", "phone", "layout", "cameras", "clips", "trailer", "chapters"]
/** The steps that need the creative pass. */
const CHOOSES: readonly EditStep[] = ["broll", "titles", "zoom"]

/**
 * What a request is charged at the platform's prices: reading it (only words
 * of the person's own), listening to the video (once per video, only for a
 * step that reads its words), the creative pass, and each paid step.
 */
export function costOf(steps: readonly EditStep[], { heard, read, prices }: { readonly heard: boolean; readonly read: boolean; readonly prices: EditPrices }): Cost {
  const parts: Array<{ key: MessageKey; vars?: Vars; credits?: number }> = []
  if (read) parts.push({ key: "freecutAi.cost.read", credits: prices.read })
  if (!heard && listensFor(steps)) parts.push({ key: "freecutAi.cost.listen", credits: prices.listen })
  if (steps.some((s) => CHOOSES.includes(s))) parts.push({ key: "freecutAi.cost.choose", credits: prices.choose })
  for (const step of steps) {
    if (PAID_STEPS.includes(step)) parts.push({ key: `freecutAi.cost.${step}` as MessageKey, credits: prices.steps[step] })
  }
  const known = parts.every((p) => p.credits !== undefined)
  return { total: known ? parts.reduce((sum, p) => sum + (p.credits ?? 0), 0) : undefined, parts }
}
