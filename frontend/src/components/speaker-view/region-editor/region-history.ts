/**
 * The region editor's own undo (U4: ⌘Z / ⇧⌘Z inside the dialog — the canvas's
 * shortcuts stand down while it is open). The boxes the person set, keyed by
 * (source, speaker); a box that is not set shows its default. A drag is ONE
 * step: `checkpoint` when it begins, `live` while it moves. The step is taken
 * at the first `live` that changes a box, so a press that moves nothing (a
 * click to select) leaves undo and redo as they were. Pure reducer.
 */
import type { Region } from "./region-geometry"

export type Boxes = ReadonlyMap<string, Region | null>

export interface RegionHistory {
  readonly past: readonly Boxes[]
  readonly present: Boxes
  readonly future: readonly Boxes[]
  /** What the dialog opened with: `dirty` compares against it. */
  readonly initial: Boxes
  /** A drag has begun and not moved yet: its first real move takes the step. */
  readonly armed?: boolean
}

export type RegionHistoryAction =
  | { readonly type: "commit"; readonly boxes: Boxes }
  | { readonly type: "checkpoint" }
  | { readonly type: "live"; readonly key: string; readonly region: Region | null }
  | { readonly type: "undo" }
  | { readonly type: "redo" }

const MAX_STEPS = 100

export function initialHistory(boxes: Boxes): RegionHistory {
  return { past: [], present: boxes, future: [], initial: boxes }
}

const sameRegion = (a: Region | null | undefined, b: Region | null) =>
  a === b || (a != null && b !== null && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h)

const push = (past: readonly Boxes[], b: Boxes) => [...past, b].slice(-MAX_STEPS)

export function regionHistoryReducer(state: RegionHistory, action: RegionHistoryAction): RegionHistory {
  switch (action.type) {
    case "commit":
      return { ...state, past: push(state.past, state.present), present: action.boxes, future: [], armed: false }
    case "checkpoint":
      return { ...state, armed: true }
    case "live": {
      if (sameRegion(state.present.get(action.key), action.region)) return state
      const next = new Map(state.present)
      next.set(action.key, action.region)
      return state.armed
        ? { ...state, past: push(state.past, state.present), present: next, future: [], armed: false }
        : { ...state, present: next }
    }
    case "undo": {
      const prev = state.past.at(-1)
      if (!prev) return state
      return { ...state, past: state.past.slice(0, -1), present: prev, future: [state.present, ...state.future], armed: false }
    }
    case "redo": {
      const [next, ...rest] = state.future
      if (!next) return state
      return { ...state, past: push(state.past, state.present), present: next, future: rest, armed: false }
    }
  }
}

const fingerprint = (b: Boxes) => JSON.stringify([...b.entries()].sort(([a], [c]) => (a < c ? -1 : a > c ? 1 : 0)))

/** Has the person changed anything since the dialog opened? */
export const isDirty = (h: RegionHistory): boolean => fingerprint(h.present) !== fingerprint(h.initial)

/** `boxes` with `key` set. */
export function withBox(boxes: Boxes, key: string, region: Region | null): Boxes {
  const next = new Map(boxes)
  next.set(key, region)
  return next
}
