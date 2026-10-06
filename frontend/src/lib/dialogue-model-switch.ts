import { dialogueHasLever, getDialogueCapabilities } from "@nodaro/shared"

/** The Text to Dialogue node fields a model switch can invalidate. */
export interface DialogueSwitchFields {
  stability?: number
  similarityBoost?: number
}

/** What a switch writes besides the provider: a snapped stability and a cleared similarity (`undefined` removes the key on merge). */
export interface DialogueSwitchPatch {
  stability?: number
  similarityBoost?: undefined
}

/** The step nearest `value`; a tie goes to the higher step. */
export function nearestStabilityStep(value: number, steps: readonly number[]): number {
  let best = steps[0]!
  for (const s of steps) {
    const d = Math.abs(s - value)
    const bestD = Math.abs(best - value)
    if (d < bestD || (d === bestD && s > best)) best = s
  }
  return best
}

/**
 * What to write next to `{ provider: next }` when a USER switches a dialogue
 * node to another model: similarity is cleared when the new model does not
 * honour it, and a stability the new model's steps do not include snaps to the
 * nearest step. Returns only what changes.
 *
 * Call it from the handler of the user's choice (the panel dropdown, the quick
 * strip) — never from an effect on `provider`: one panel instance is reused when
 * the selection moves to another node, and an effect also fires on undo, redo
 * and a copilot edit. This is not the invariant: the route refuses a stepless
 * stability for v3 dialogue, and the funnel never sends similarity to it.
 */
export function dialogueModelSwitchPatch(next: string, data: DialogueSwitchFields): DialogueSwitchPatch {
  const patch: DialogueSwitchPatch = {}
  if (!dialogueHasLever(next, "similarity") && data.similarityBoost !== undefined) patch.similarityBoost = undefined
  const steps = getDialogueCapabilities(next).stabilitySteps
  if (steps && typeof data.stability === "number" && !steps.includes(data.stability)) {
    patch.stability = nearestStabilityStep(data.stability, steps)
  }
  return patch
}
