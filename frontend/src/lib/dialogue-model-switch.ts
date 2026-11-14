import {
  dialogueHasLever,
  dialogueOutputFormatFor,
  dialogueTakesFillerWords,
  dialogueVoicesForModel,
  getDialogueCapabilities,
  type TtsOutputFormat,
} from "@nodaro/shared/models"
import type { DialogueLine, DialogueSpeakerDirection } from "@/types/nodes"
import { dialogueLineStyleMax, remapDialogueSpeakers, withDialogueVoices } from "./dialogue-direction"

/** The Text to Dialogue node fields a model switch can invalidate. */
export interface DialogueSwitchFields {
  stability?: number
  similarityBoost?: number
  languageCode?: string
  dialogue?: readonly DialogueLine[]
  speakers?: readonly DialogueSpeakerDirection[]
  fillerWords?: boolean
  outputFormat?: TtsOutputFormat
}

/**
 * What a switch writes besides the provider (`undefined` removes the key on
 * merge): a snapped stability, a cleared similarity, a reset language, the
 * lines with their voices moved and their styles dropped, the speakers'
 * entries the new model takes, cleared filler words, a cleared file format.
 */
export interface DialogueSwitchPatch {
  stability?: number
  similarityBoost?: undefined
  languageCode?: ""
  dialogue?: DialogueLine[]
  speakers?: DialogueSpeakerDirection[] | undefined
  fillerWords?: undefined
  outputFormat?: undefined
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
 * The lines on the new model: each voice moved onto one it speaks (`dialogueVoicesForModel`: a cloned speaker's
 * label stays on a model that clones, and moves like any other voice elsewhere), a style its lines do not take dropped.
 */
function linesPatch(next: string, lines: readonly DialogueLine[], speakers: unknown): { lines?: DialogueLine[]; sent: string[] } {
  const stored = lines.map((l) => l?.voice)
  const sent = dialogueVoicesForModel(next, stored, speakers)
  const keepStyle = dialogueLineStyleMax(next) !== undefined
  const voiced = withDialogueVoices(lines, sent)
  let changed = voiced.some((line, i) => line !== lines[i])
  const styled = voiced.map((line) => {
    if (keepStyle || !line || line.styleDirection === undefined) return line
    changed = true
    const copy: Record<string, unknown> = { ...line }
    delete copy.styleDirection
    return copy as unknown as DialogueLine
  })
  return { lines: changed ? styled : undefined, sent }
}

/** Two speaker lists hold the same entries in the same order, field for field. */
function sameSpeakers(a: readonly DialogueSpeakerDirection[], b: readonly DialogueSpeakerDirection[]): boolean {
  return a.length === b.length && a.every((s, i) => JSON.stringify(s) === JSON.stringify(b[i]))
}

/**
 * What to write next to `{ provider: next }` when a USER switches a dialogue
 * node to another model. Returns only what changes:
 *   - similarity is cleared when the new model does not honour it, and a
 *     stability its steps do not include snaps to the nearest step;
 *   - a language is reset to auto-detect (`""`) on a model offered in none;
 *   - each line's voice moves onto one the new model speaks
 *     (`dialogueVoicesForModel`: two speakers stay two), named by it;
 *   - a line's style goes when the new model's lines take none;
 *   - the speakers' entries follow their voices and keep only what the new
 *     model takes per speaker, a one-off clone (`replica`) only on a model
 *     that clones (an entry with nothing left goes; none left: the list goes);
 *   - filler words go on a model that does not add them;
 *   - a file format goes on a model that does not deliver it (`dialogueOutputFormatFor`:
 *     the run would send MP3 128 kbps there, so the panel shows that).
 *
 * Call it from the handler of the user's choice (the panel dropdown, the quick
 * strip) with the node's data as it is before the switch — never from an
 * effect on `provider`: one panel instance is reused when the selection moves
 * to another node, and an effect also fires on undo, redo and a copilot edit.
 * This is not the invariant: the run sends only what the model takes whatever
 * the node carries (`execute-node.ts`, the server's funnel).
 */
export function dialogueModelSwitchPatch(next: string, data: DialogueSwitchFields): DialogueSwitchPatch {
  const patch: DialogueSwitchPatch = {}
  if (!dialogueHasLever(next, "similarity") && data.similarityBoost !== undefined) patch.similarityBoost = undefined
  const sheet = getDialogueCapabilities(next)
  const steps = sheet.stabilitySteps
  if (steps && typeof data.stability === "number" && !steps.includes(data.stability)) {
    patch.stability = nearestStabilityStep(data.stability, steps)
  }
  if (data.languageCode && !sheet.languageCode) patch.languageCode = ""
  const lines = Array.isArray(data.dialogue) ? data.dialogue : []
  const moved = linesPatch(next, lines, data.speakers)
  if (moved.lines) patch.dialogue = moved.lines
  if (Array.isArray(data.speakers)) {
    const kept = remapDialogueSpeakers(next, data.speakers, lines.map((l) => l?.voice), moved.sent)
    if (!sameSpeakers(kept, data.speakers)) patch.speakers = kept.length > 0 ? kept : undefined
  }
  if (data.fillerWords !== undefined && !dialogueTakesFillerWords(next)) patch.fillerWords = undefined
  if (data.outputFormat !== undefined && dialogueOutputFormatFor(next, data.outputFormat) === undefined) patch.outputFormat = undefined
  return patch
}
