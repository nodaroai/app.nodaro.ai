/**
 * Edit with AI's panel, as pure functions: what each card says while a run is
 * on and after it, what the status line at the top says, and what a request is
 * charged. The panel (`components/freecut-ai`) renders these; nothing here
 * talks to the editor or the server.
 */
import type { MessageKey } from "@/lib/i18n"
import { listensFor } from "./abilities"
import type { EditPlan, EditStep } from "./edit-plan"
import type { AgentId, AgentState, DeclinedReason, ExtraCharge, RunSummary } from "./run-ai-edit"

type Vars = Record<string, string | number>

/** What one card says about its step: its state, its words, how far along it is. */
export interface StepOutcome {
  readonly state: AgentState
  readonly key: MessageKey
  readonly vars?: Vars
  readonly progress?: number
  /** The provider's own words about a step that failed. */
  readonly detail?: string
}

export type StepOutcomes = Partial<Record<EditStep, StepOutcome>>

const AGENT_STEPS: Record<AgentId, readonly EditStep[]> = {
  lead: [],
  cutter: ["pauses", "fillers"],
  captions: ["captions"],
  sound: ["music"],
}

/** The plan's steps an agent works on (the Cutter does the pauses and the filler words in one pass). */
export function stepsOfAgent(agent: AgentId, planSteps: readonly EditStep[]): EditStep[] {
  return AGENT_STEPS[agent].filter((step) => planSteps.includes(step))
}

/** The cards after an agent's event: each step that agent works on says what the agent says. */
export function withAgentEvent(
  outcomes: StepOutcomes,
  agent: AgentId,
  planSteps: readonly EditStep[],
  event: { readonly state: AgentState; readonly key: MessageKey; readonly vars?: Vars; readonly progress?: number; readonly detail?: string },
): StepOutcomes {
  const steps = stepsOfAgent(agent, planSteps)
  if (steps.length === 0) return outcomes
  const next: StepOutcome = { state: event.state, key: event.key, vars: event.vars, progress: event.progress, ...(event.detail ? { detail: event.detail } : {}) }
  return { ...outcomes, ...Object.fromEntries(steps.map((step) => [step, next])) }
}

const count = (n: number, one: MessageKey, many: MessageKey): Pick<StepOutcome, "key" | "vars"> => (n === 1 ? { key: one } : { key: many, vars: { n } })

/**
 * The cards once a run finished: each step THIS run did says what it did on its
 * own (the Cutter's pass reports its pauses and its filler words apart). A card
 * an earlier run finished keeps what it said.
 */
export function outcomesAfterRun(outcomes: StepOutcomes, summary: RunSummary, planSteps: readonly EditStep[]): StepOutcomes {
  const next: StepOutcomes = { ...outcomes }
  const ran = (step: EditStep) => planSteps.includes(step) && next[step]?.state === "done"
  if (ran("pauses") && summary.pausesCut > 0) next.pauses = { state: "done", ...count(summary.pausesCut, "freecutAi.summaryPausesOne", "freecutAi.summaryPauses") }
  if (ran("fillers")) {
    next.fillers = summary.fillersCut > 0
      ? { state: "done", ...count(summary.fillersCut, "freecutAi.summaryFillersOne", "freecutAi.summaryFillers") }
      : { state: "done", key: "freecutAi.noFillers" }
  }
  if (ran("captions")) next.captions = { state: "done", ...count(summary.captions, "freecutAi.summaryCaptionsOne", "freecutAi.summaryCaptions") }
  return next
}

/** The cards with these steps forgotten (their undo entries were reverted): they can be asked for again. */
export function withoutSteps(outcomes: StepOutcomes, steps: readonly EditStep[]): StepOutcomes {
  return Object.fromEntries(Object.entries(outcomes).filter(([step]) => !steps.includes(step as EditStep))) as StepOutcomes
}

/**
 * The steps one undo entry of a run stands for, by its label: the Cutter
 * records every cut under one label, so a cut entry stands for the pauses and
 * the filler words that run cut.
 */
export function stepsOfEntry(label: string, labels: Record<EditStep, string>, planSteps: readonly EditStep[]): EditStep[] {
  if (label === labels.captions) return ["captions"]
  if (label === labels.music) return ["music"]
  if (label === labels.pauses || label === labels.fillers) return planSteps.filter((step) => step === "pauses" || step === "fillers")
  return []
}

/** The cards after a stop: whatever was still at work did not finish, and can be asked for again. */
export function outcomesAfterStop(outcomes: StepOutcomes): StepOutcomes {
  return Object.fromEntries(
    Object.entries(outcomes).map(([step, o]) => [step, o && (o.state === "working" || o.state === "waiting") ? { ...o, state: "skipped" as const, key: "freecutAi.notFinished" as MessageKey, progress: undefined } : o]),
  ) as StepOutcomes
}

/** The steps a run already did on a video: not done again, and their cards cannot be asked for. */
export const doneSteps = (outcomes: StepOutcomes): EditStep[] =>
  (Object.entries(outcomes) as Array<[EditStep, StepOutcome | undefined]>).filter(([, o]) => o?.state === "done").map(([step]) => step)

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

export interface StatusInput {
  readonly phase: Phase
  readonly view: "edited" | "original"
  readonly listening: boolean
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
      if (input.planSteps.length === 0) return { kind: "busy", icon: "spin", title: "freecutAi.status.reading", sub: "freecutAi.status.readingSub" }
      const total = input.planSteps.length
      const finished = input.planSteps.filter((step) => {
        const state = input.outcomes[step]?.state
        return state === "done" || state === "failed" || state === "skipped"
      }).length
      const moving = input.planSteps.reduce((sum, step) => sum + (input.outcomes[step]?.state === "working" ? input.outcomes[step]?.progress ?? 0 : 0), 0)
      if (input.listening) return { kind: "busy", icon: "spin", title: "freecutAi.status.listening", sub: "freecutAi.status.listeningSub", bar: 0.05 }
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

/** The platform's prices for the parts of a run; undefined while one is unknown. */
export interface EditPrices {
  readonly listen?: number
  readonly read?: number
  readonly music?: number
}

export interface Cost {
  /** The whole figure, or undefined while a needed price is unknown. */
  readonly total?: number
  readonly parts: ReadonlyArray<{ readonly key: MessageKey; readonly credits?: number }>
}

/**
 * What a request is charged at its usual prices: reading it, listening to the
 * video (once per video, only for a step that reads its words) and the music.
 * The cutting and the captions are the editor's own work and cost nothing.
 */
export function costOf(steps: readonly EditStep[], { heard, prices }: { readonly heard: boolean; readonly prices: EditPrices }): Cost {
  const parts: Array<{ key: MessageKey; credits?: number }> = [{ key: "freecutAi.cost.read", credits: prices.read }]
  if (!heard && listensFor(steps)) parts.push({ key: "freecutAi.cost.listen", credits: prices.listen })
  if (steps.includes("music")) parts.push({ key: "freecutAi.cost.music", credits: prices.music })
  const known = parts.every((p) => p.credits !== undefined)
  return { total: known ? parts.reduce((sum, p) => sum + (p.credits ?? 0), 0) : undefined, parts }
}
