import type { ResolvedInputs } from "../services/workflow-engine/types.js"

/** Apply a single list fan-out item to resolved inputs. Text items set both
 *  `prompt` (legacy wire path) and `overridePrompt` (highest-precedence for the
 *  typed-primary helper); URL items set the matching media field and MUST NOT
 *  set overridePrompt. Caller handles REPEAT_PLACEHOLDER / provider sentinels
 *  before calling. */
export function overrideInputWithListItem(inputs: ResolvedInputs, item: string): void {
  const isUrl =
    item.startsWith("http") ||
    /\.(png|jpg|jpeg|webp|gif|mp4|mov|webm|mp3|wav|ogg)(\?|$)/i.test(item)
  if (isUrl) {
    if (/\.(mp4|mov|webm)(\?|$)/i.test(item)) inputs.videoUrl = item
    else if (/\.(mp3|wav|ogg)(\?|$)/i.test(item)) inputs.audioUrl = item
    else inputs.imageUrl = item
  } else {
    inputs.prompt = item
    inputs.overridePrompt = item
  }
}
