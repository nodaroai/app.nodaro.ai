/**
 * The show: the named agents' cursors moving through the editor while they
 * work, and the gestures they make there (a click on the razor, a drag from
 * the media bin, a caption typed on the video). The editor draws them over its
 * own interface; the edits themselves always arrive as ops.
 *
 * An editor without `presence-targets` can still place a cursor on the
 * timeline and on the video: a move to one of its tools or panels is left out
 * there, and so is every gesture. The pace is the panel's (1×, 2×, or skipped
 * to the end), read on every wait.
 */
import type { EditorLink, PresenceCursor, PresenceGesture, PresenceHighlight, PresenceRect } from "../editor-link"
import type { AgentId } from "../abilities"
import { AGENT_COLORS } from "./types"
import { pause } from "./jobs"
import { announceCrew, type CrewMood } from "@/lib/edit-crew"

/** Where a cursor stands: a moment on a track, a point on the video, an item, or a named place in the editor. */
export type Place =
  | { readonly frame: number; readonly trackId: string }
  | { readonly preview: { readonly x: number; readonly y: number } }
  | { readonly item: string }
  | { readonly target: string }

/** A pace at or above this skips the show: the edits land at once. */
export const SKIP_PACE = 64

/** The most cursors the editor is sent at once. */
const MAX_CURSORS = 24

/**
 * Where an agent with work still to do waits its turn, and comes back to when
 * it is done: its home on the timeline, the lane of the kind of clip it makes
 * (an editor without that lane yet seats it on the first track of the same
 * side). A cursor only ever moves to do the thing it shows.
 */
const STATION: Record<AgentId, string> = {
  lead: "lane.video",
  cutter: "lane.video",
  captions: "lane.subtitle",
  sound: "lane.audio",
  broll: "lane.image",
  picture: "lane.image",
  color: "lane.adjustment",
  framer: "lane.video",
  director: "lane.video",
}

/** The crew that rests at its stations while no edit runs (the director only joins a run). */
const RESTING: readonly AgentId[] = ["lead", "cutter", "captions", "sound", "broll", "picture", "color", "framer"]

/**
 * The whole crew asleep at its stations: what a studio-layout editor shows
 * before the first edit and after each one, so the agents are always there.
 */
export function restingCrew(names: Record<AgentId, string>): PresenceCursor[] {
  return RESTING.map((a) => ({ id: `${a}#station`, name: names[a], color: AGENT_COLORS[a], target: STATION[a], mood: "waiting" as const }))
}

export class Show {
  private readonly cursors = new Map<AgentId, PresenceCursor>()
  private readonly highlights = new Map<string, PresenceHighlight>()
  /** The agents with a step still to do: each waits at its station until its own cursor is at work. */
  private crew: readonly AgentId[] = []
  /** The agents that had steps in this run and have none left: back at their station, done. */
  private finished: readonly AgentId[] = []
  /** The agent waiting for the person to answer, if one is. */
  private asking: AgentId | null = null

  constructor(
    private readonly link: EditorLink,
    /** The editor draws named places and gestures. */
    readonly targets: boolean,
    private readonly names: Record<AgentId, string>,
    private readonly pace: () => number,
    private readonly signal: AbortSignal,
    /** The editor keeps the crew on screen between runs (`studio-layout`): it goes back to rest instead of leaving. */
    private readonly rests = false,
  ) {}

  /** Waits a beat of the show at the panel's pace; nothing at all once skipped. */
  wait(ms: number): Promise<void> {
    const p = Math.max(0.25, this.pace())
    return pause(p >= SKIP_PACE ? 0 : ms / p, this.signal)
  }

  get skipping(): boolean {
    return this.pace() >= SKIP_PACE
  }

  private place(place: Place): Partial<PresenceCursor> | null {
    if ("target" in place) return this.targets ? { target: place.target } : null
    return place
  }

  /** The agents with a step still to do in this run. */
  setCrew(agents: readonly AgentId[]) {
    const next = [...new Set(agents)]
    if (next.length === this.crew.length && next.every((a) => this.crew.includes(a))) return
    // An agent that leaves the crew has done its part: it goes back to its station, done.
    const left = this.crew.filter((a) => !next.includes(a) && !this.finished.includes(a))
    this.finished = [...this.finished.filter((a) => !next.includes(a)), ...left]
    this.crew = next
    this.push()
  }

  /** An agent waits for the person to answer (or stops waiting): it shows it needs them. */
  ask(agent: AgentId, waiting: boolean) {
    const next = waiting ? agent : this.asking === agent ? null : this.asking
    if (next === this.asking) return
    this.asking = next
    this.push()
  }

  /** Puts an agent's cursor at a place, with what it is doing there. */
  at(agent: AgentId, place: Place, opts: { readonly gesture?: PresenceGesture; readonly note?: string } = {}) {
    const where = this.place(place)
    if (!where) {
      this.cursors.delete(agent)
    } else {
      this.cursors.set(agent, {
        id: agent,
        name: this.names[agent],
        color: AGENT_COLORS[agent],
        ...where,
        ...(this.targets && opts.gesture ? { gesture: opts.gesture } : {}),
        ...(opts.note ? { note: opts.note } : {}),
      })
    }
    this.push()
  }

  clear(agent: AgentId) {
    if (this.cursors.delete(agent)) this.push()
  }

  mark(id: string, highlight: Omit<PresenceHighlight, "id">) {
    this.highlights.set(id, { id, ...highlight })
    this.push()
  }

  unmark(...ids: string[]) {
    let changed = false
    for (const id of ids) changed = this.highlights.delete(id) || changed
    if (changed) this.push()
  }

  /** Tells the page who is on the crew now, for the editor's top bar. */
  private announce() {
    const order = Object.keys(AGENT_COLORS) as AgentId[]
    const moodOf = (a: AgentId): CrewMood | null =>
      this.asking === a ? "needs-you" : this.cursors.has(a) ? "working" : this.crew.includes(a) ? "waiting" : this.finished.includes(a) ? "done" : null
    announceCrew(
      order.flatMap((a) => {
        const mood = moodOf(a)
        return mood ? [{ id: a, name: this.names[a], color: AGENT_COLORS[a], mood }] : []
      }),
    )
  }

  push() {
    this.announce()
    try {
      // An agent still to work, with no cursor of its own right now, stands at its station.
      const atStation = (agents: readonly AgentId[], mood: "waiting" | "done"): PresenceCursor[] =>
        this.targets && !this.skipping
          ? agents.filter((a) => !this.cursors.has(a)).map((a) => ({ id: `${a}#station`, name: this.names[a], color: AGENT_COLORS[a], target: STATION[a], mood }))
          : []
      const waiting = atStation(this.crew, "waiting")
      const done = atStation(this.finished, "done")
      const cursors = [...this.cursors.values()].map((c) => (c.id === this.asking ? { ...c, mood: "needs-you" as const } : c))
      this.link.presence([...cursors, ...waiting, ...done].slice(0, MAX_CURSORS), [...this.highlights.values()].slice(-64))
    } catch {
      // The editor has closed; the run notices on its next request.
    }
  }

  /** Clears every cursor and highlight. */
  end() {
    this.asking = null
    this.crew = []
    this.finished = []
    this.cursors.clear()
    this.highlights.clear()
    this.push()
    if (this.rests && this.targets) {
      try {
        this.link.presence(restingCrew(this.names), [])
      } catch {
        // The editor has closed.
      }
    }
  }

  // ── gestures, each a move and a beat ──────────────────────────────────────

  async move(agent: AgentId, place: Place, ms = 420, note?: string) {
    this.at(agent, place, { note })
    await this.wait(ms)
  }

  async click(agent: AgentId, target: string, ms = 380, note?: string) {
    this.at(agent, { target }, { gesture: { kind: "click" }, note })
    await this.wait(ms)
  }

  async drag(agent: AgentId, from: Place, to: string | { readonly frame: number; readonly trackId: string }, label: string, ms = 900) {
    this.at(agent, from)
    await this.wait(240)
    this.at(agent, from, { gesture: { kind: "drag", to, label, durationMs: ms } })
    await this.wait(ms)
    this.at(agent, typeof to === "string" ? { target: to } : to)
  }

  async type(agent: AgentId, place: Place, text: string, msPerChar = 38) {
    const ms = Math.min(2200, Math.max(500, text.length * msPerChar))
    this.at(agent, place, { gesture: { kind: "type", text, durationMs: ms } })
    await this.wait(ms + 150)
  }

  async marquee(agent: AgentId, trackId: string, from: number, to: number, ms = 300, note?: string) {
    this.at(agent, { frame: from, trackId }, { gesture: { kind: "marquee", trackId, from, to }, note })
    await this.wait(ms)
  }

  async lasso(agent: AgentId, points: ReadonlyArray<{ readonly x: number; readonly y: number }>, ms = 1400, note?: string) {
    const first = points[0] ?? { x: 0.5, y: 0.5 }
    this.at(agent, { preview: first }, { gesture: { kind: "lasso", points, durationMs: ms }, note })
    await this.wait(ms + 150)
  }

  async slide(agent: AgentId, target: string, from: number, to: number, ms = 800, note?: string) {
    this.at(agent, { target }, { gesture: { kind: "slide", from, to, durationMs: ms }, note })
    await this.wait(ms + 100)
  }

  /** A range of a track cut out: blades drop at both ends, then the range closes. */
  async cut(agent: AgentId, trackId: string, from: number, to: number, ms = 700, note?: string) {
    this.at(agent, { frame: from, trackId }, { gesture: { kind: "cut", trackId, from, to, durationMs: ms }, note })
    await this.wait(ms + 80)
  }

  /** A frame drawn on the video, moving from one rectangle to another. */
  async frame(agent: AgentId, from: PresenceRect, to: PresenceRect, ms = 900, note?: string) {
    this.at(agent, { preview: { x: to.x + to.w, y: to.y + to.h } }, { gesture: { kind: "frame", from, to, durationMs: ms }, note })
    await this.wait(ms + 120)
  }

  progress(agent: AgentId, target: string, value: number, label?: string) {
    this.at(agent, { target }, { gesture: { kind: "progress", value: Math.max(0, Math.min(1, value)), ...(label ? { label } : {}) } })
  }
}
