/**
 * What every agent of a run shares: the line to the editor (one edit at a time,
 * whoever asks), the timeline as the editor last reported it, the paid jobs,
 * the show, and the events the panel hears.
 *
 * An edit the editor refuses is never mistaken for "the editor changed": the
 * step that asked for it reports the editor's own words, and the run goes on
 * with the rest. Only an editor that no longer has the video, or no longer
 * answers, ends the run.
 */
import type { MessageKey } from "@/lib/i18n"
import { ABILITY_OF, type AgentId } from "../abilities"
import type { EditorLink, OpsResult } from "../editor-link"
import { readTimelineView, type EditStep, type TimelineItemView, type TimelineView } from "../edit-plan"
import { RunJobs, checkStop } from "./jobs"
import { Show } from "./show"
import { RunFailed, type AgentState, type RunEvent, type Vars } from "./types"

export interface RunContextOptions {
  readonly link: EditorLink
  readonly signal: AbortSignal
  /** The editor's abilities (`FREECUT_READY.capabilities`). */
  readonly capabilities: readonly string[]
  readonly names: Record<AgentId, string>
  /** Each step's undo label, in the person's language. */
  readonly stepLabels: Record<EditStep, string>
  readonly onEvent: (event: RunEvent) => void
  readonly pace: () => number
  readonly userId: string
  /** A sentence in the person's language, for the notes the cursors carry in the editor. */
  readonly say: (key: MessageKey, vars?: Vars) => string
}

/** What one edit request came back with. */
export type Applied = { readonly ok: true; readonly result: OpsResult } | { readonly ok: false; readonly reason: string }

export class RunContext {
  readonly link: EditorLink
  readonly signal: AbortSignal
  readonly userId: string
  readonly jobs: RunJobs
  readonly show: Show
  private readonly caps: ReadonlySet<string>
  private readonly opts: RunContextOptions
  private queue: Promise<unknown> = Promise.resolve()
  private readonly busy = new Set<AgentId>()
  private readonly stepStates = new Map<EditStep, AgentState>()
  /** The timeline as the editor last reported it. */
  timeline: TimelineView
  /** The video being edited. */
  readonly mediaId: string
  readonly mediaSeconds: number

  constructor(opts: RunContextOptions, first: { readonly timeline: TimelineView; readonly mediaId: string; readonly mediaSeconds: number }) {
    this.opts = opts
    this.link = opts.link
    this.signal = opts.signal
    this.userId = opts.userId
    this.caps = new Set(opts.capabilities)
    this.jobs = new RunJobs(opts.signal)
    this.show = new Show(opts.link, this.caps.has("presence-targets"), opts.names, opts.pace, opts.signal, this.caps.has("studio-layout"))
    this.timeline = first.timeline
    this.mediaId = first.mediaId
    this.mediaSeconds = first.mediaSeconds
  }

  has(capability: string): boolean {
    return this.caps.has(capability)
  }

  get fps(): number {
    return this.timeline.fps
  }

  get canvas(): { readonly width: number; readonly height: number } {
    return { width: this.timeline.width ?? 1920, height: this.timeline.height ?? 1080 }
  }

  /** The clips of the edited video on the timeline, in order. */
  pieces(type = "video"): TimelineItemView[] {
    return this.timeline.items.filter((i) => i.type === type && i.mediaId === this.mediaId).sort((a, b) => a.from - b.from)
  }

  emit(event: RunEvent) {
    this.opts.onEvent(event)
  }

  step(step: EditStep, state: AgentState, key: MessageKey, vars?: Vars, progress?: number, detail?: string) {
    this.emit({ type: "step", step, state, key, vars, progress, ...(detail ? { detail } : {}) })
    // The crew: every agent that still has a step to do keeps busy in the editor.
    this.stepStates.set(step, state)
    const crew = [...this.stepStates].filter(([, s]) => s === "waiting" || s === "working").map(([s]) => ABILITY_OF[s].agent)
    this.show.setCrew(crew)
  }

  feed(agent: AgentId, key: MessageKey, vars?: Vars) {
    this.emit({ type: "feed", agent, key, vars })
  }

  /** An agent starts or stops working: the status line names who is at work. */
  working(agent: AgentId, on: boolean) {
    if (on) this.busy.add(agent)
    else this.busy.delete(agent)
    this.emit({ type: "agents", working: [...this.busy] })
    if (!on) this.show.clear(agent)
  }

  /** A sentence in the person's language. */
  say(key: MessageKey, vars?: Vars): string {
    return this.opts.say(key, vars)
  }

  label(step: EditStep): string {
    return this.opts.stepLabels[step]
  }

  /**
   * One edit, under the step's undo label. Edits from agents working at once go
   * to the editor one at a time. A refusal comes back with the editor's words.
   */
  apply(step: EditStep, ops: ReadonlyArray<Record<string, unknown>>, options: { readonly history?: boolean } = {}): Promise<Applied> {
    const run = async (): Promise<Applied> => {
      checkStop(this.signal)
      const result = await this.link.applyOps(this.label(step), ops, options)
      if (!result.ok) {
        console.warn("[Edit with AI] the editor refused a step", step, result.error)
        return { ok: false, reason: result.error?.message ?? "" }
      }
      const next = readTimelineView(result.timeline)
      if (next) this.timeline = next
      if (result.recorded !== false && options.history !== false) this.emit({ type: "recorded", label: this.label(step), step })
      return { ok: true, result }
    }
    const turn = this.queue.then(run, run)
    this.queue = turn.catch(() => undefined)
    return turn
  }

  /**
   * Plays a moment of the edit where the agent just worked (the show's proof
   * that the change is real): from `frame`, for `ms` at the panel's pace.
   */
  async preview(frame: number, ms = 1200): Promise<void> {
    if (this.show.skipping) return
    try {
      this.link.playback("seek", Math.max(0, frame))
      this.link.playback("play")
      await this.show.wait(ms)
    } finally {
      try {
        this.link.playback("pause")
      } catch {
        // The editor has closed.
      }
    }
  }

  /** The timeline as the editor holds it now; the run ends when the video is no longer on it. */
  async refresh(): Promise<TimelineView> {
    const view = readTimelineView(await this.link.getTimeline())
    if (!view) throw new RunFailed("freecutAi.noVideo")
    if (!view.items.some((i) => i.type === "video" && i.mediaId === this.mediaId)) throw new RunFailed("freecutAi.videoGone")
    this.timeline = view
    return view
  }

  end() {
    this.jobs.end()
    this.show.end()
  }
}
