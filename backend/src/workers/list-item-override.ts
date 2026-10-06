import { fanOutTextFeedsPrompt, fanOutUrlItemIsText, isFanOutUrlItem } from "@nodaro/shared"
import type { ResolvedInputs } from "../services/workflow-engine/types.js"

/** Apply a single list fan-out item to resolved inputs. Text items set both
 *  `prompt` (legacy wire path) and `overridePrompt` (highest-precedence for the
 *  typed-primary helper); URL items set the matching media field and MUST NOT
 *  set overridePrompt. Caller handles REPEAT_PLACEHOLDER / provider sentinels
 *  before calling.
 *
 *  `lane` is where the DRIVING list is wired: the target node's type and the
 *  handle on it. A text list that drives through a lane the resolver routes
 *  elsewhere (`negative`, `system-prompt`, an avatar's `script`, …) is NOT a
 *  prompt: the per-row resolution already delivered it to its own input, and
 *  writing it into `prompt` too generated every image FROM the negative text.
 *  Omitted (older callers) = a prompt, as before. */
export function overrideInputWithListItem(
  inputs: ResolvedInputs,
  item: string,
  lane?: { nodeType: string | null | undefined; targetHandle: string | null | undefined },
): void {
  // An empty cell overrides nothing — the row simply has no value for this input.
  if (item.trim().length === 0) return
  // On a lane where a link IS the item (Save to Collection's `in`), it stays
  // the item: the record's link, not a picture to attach.
  if (isFanOutUrlItem(item) && !(lane && fanOutUrlItemIsText(lane.nodeType, lane.targetHandle))) {
    if (/\.(mp4|mov|webm)(\?|$)/i.test(item)) inputs.videoUrl = item
    else if (/\.(mp3|wav|ogg)(\?|$)/i.test(item)) inputs.audioUrl = item
    else inputs.imageUrl = item
  } else if (!lane || fanOutTextFeedsPrompt(lane.nodeType, lane.targetHandle)) {
    inputs.prompt = item
    inputs.overridePrompt = item
  }
}
