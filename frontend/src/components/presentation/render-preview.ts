/**
 * Whether an app output card shows a Preview (F1): a render made at
 * `quality: "proxy"`. Read from what the take IS — never from the node's
 * Quality setting.
 *
 * A card of a list names its take by URL, never by position: the list a card
 * shows may be a run's batch, the node's latest saved batch, or its filtered
 * result history (a node that ran single previews has no batch), and a
 * position in one is no position in another. The first source that knows the
 * URL's quality decides: the run on show (`listResultStamps` row of the URL,
 * or its one take), then the latest saved batch, then the result history.
 * A card with no URL (the node's one card) reads the run's take, else the
 * node's selected take (@nodaro/shared savedRenderOutput).
 */
import { isRenderNodeType, savedRenderBatch, savedRenderOutput, type RunResultRowStamp } from "@nodaro/shared"

type Rec = Readonly<Record<string, unknown>>

/** The quality the run on show stamped on `url`, when it holds that URL. */
function runQualityOf(runOutput: Rec, url: string): unknown {
  const list = Array.isArray(runOutput.listResults) ? (runOutput.listResults as unknown[]) : []
  const row = list.indexOf(url)
  if (row >= 0) return (runOutput.listResultStamps as RunResultRowStamp[] | undefined)?.[row]?.quality
  if (runOutput.videoUrl === url || runOutput.audioUrl === url) return runOutput.quality
  return undefined
}

/** The quality the node's saved takes record for `url`. */
function savedQualityOf(data: Rec, url: string): unknown {
  const fromBatch = savedRenderBatch(data)?.find((item) => item?.url === url)?.quality
  if (fromBatch) return fromBatch
  const results = Array.isArray(data.generatedResults) ? (data.generatedResults as Array<{ url?: unknown; quality?: unknown }>) : []
  return results.find((r) => r?.url === url)?.quality
}

export function outputIsPreview(
  nodeType: string | null | undefined,
  data: Rec | undefined,
  runOutput: Rec | undefined,
  url?: string,
): boolean {
  if (!isRenderNodeType(nodeType)) return false
  if (url !== undefined) {
    const quality = (runOutput ? runQualityOf(runOutput, url) : undefined) ?? (data ? savedQualityOf(data, url) : undefined)
    return quality === "proxy"
  }
  if (runOutput && (runOutput.videoUrl || runOutput.audioUrl || runOutput.listResults)) return runOutput.quality === "proxy"
  if (!data) return false
  return savedRenderOutput(data)?.quality === "proxy"
}

/** A gallery card of a list: labelled when any take on it is a Preview. */
export function anyOutputIsPreview(
  nodeType: string | null | undefined,
  data: Rec | undefined,
  runOutput: Rec | undefined,
  urls: readonly string[],
): boolean {
  return urls.some((url) => Boolean(url) && outputIsPreview(nodeType, data, runOutput, url))
}
