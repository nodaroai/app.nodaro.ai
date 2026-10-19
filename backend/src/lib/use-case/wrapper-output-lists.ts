/**
 * What a use-case wrapper reports for a run whose result is a list (a clip
 * set's clips, a run's formats) or text (chapters), and why a completed run of
 * a kind delivered nothing. Each of those types fills its own branch as it
 * ships; until then a list run reports only its execution. Pure.
 *
 * Chapters (decided 2026-10-14): `text` is the plan's chapters as show notes
 * (one "M:SS Title" line per chapter), `json` the bare chapter list
 * (`{ startMs, title }[]`), `plan` the plan as Edit Plan made it.
 *
 * Trailer (decided 2026-10-14): `formats` is one delivery per chosen format
 * that completed, in format order; `videoUrl` — what a single-value read gets
 * — is the FIRST chosen format's. A review-on run stops at the render: its
 * preview is the `videoUrl`, with no formats until Render final. A format
 * whose step failed is named on `failedFormats` (decided 2026-10-18): the run
 * keeps the formats that rendered (`usecaseWrapperKeepsPartial`), the failed
 * one is not charged (its own job refunds itself).
 *
 * Clip Pack (decided 2026-10-14): `clips` is one row per clip that came back,
 * in plan order, each with its own take stamps (quality, clip key, plan and
 * render bases), its still (`thumbnailUrl`, the one its own step made of the
 * file it delivers — its captioned file's, else its render's; none for an
 * audio clip) and the plan's title and hook for it; `videoUrl` (`audioUrl`
 * for an audio recording) is the first clip's. The render runs once per clip
 * and keeps a hole where one failed; the captions after it run once per clip
 * that rendered (a hole is skipped), so captions row j is the j-th render row
 * that has a file — never row j of the render. Both try every clip (decided
 * 2026-10-18: one failure never stops the rest). A clip that could not be
 * rendered is counted on `failedClips` (a row the run never started,
 * `cancelled`, is not a failure: only a Stop leaves one, and a stopped run
 * keeps nothing). A rendered clip whose captions failed is still delivered,
 * uncaptioned — its render stands in, the row says `captionsFailed`, and
 * `failedCaptions` counts them (decided 2026-10-18) — only when captioning
 * ran: a run that stopped before it keeps nothing (`captionsNotRun`), and its
 * Continue captions the rendered clips. `json` is the plan as
 * the run held it: a Render final's plan is seeded with the review applied, so it holds
 * the kept clips. A review-on run stops at the render: its per-clip previews
 * are the clips until Render final.
 */
import {
  chapterRowsOf,
  clipPackNoneRenderedMessage,
  formatChapterListText,
  usecaseResultKind,
  type ClipsOutputMap,
  type StoredInlineGraph,
} from "@nodaro/render-rules"
import { edlSpanKey } from "@nodaro/shared/nodes"
import { completedOutput, failedStepOf, isRecord, str, type UseCaseClipRow, type UseCaseWrapperOutput } from "./wrapper-output-parts.js"

export function listOutput(
  graph: StoredInlineGraph,
  nodeStates: Readonly<Record<string, unknown>>,
  executionId: string,
): UseCaseWrapperOutput {
  const map = graph.outputMap
  const planOut = completedOutput(nodeStates, map.planNodeId)
  const transcriptOut = completedOutput(nodeStates, map.transcript.nodeId)
  const common = {
    ...(transcriptOut?.json !== undefined ? { transcript: transcriptOut.json } : {}),
    ...(isRecord(graph.settings) ? { useCaseSettings: graph.settings } : {}),
    _executionId: executionId,
    ...failedStepOf(graph, nodeStates),
  }
  switch (map.kind) {
    case "chapters": {
      const rows = chapterRowsOf(planOut?.json)
      const text = formatChapterListText(rows)
      return { ...(planOut ? { json: rows, plan: planOut.json } : {}), ...(text ? { text } : {}), quality: "final", ...common }
    }
    case "formats": {
      const render = completedOutput(nodeStates, map.renderNodeId)
      const renderData = graph.nodes.find((n) => n.id === map.renderNodeId)?.data ?? {}
      const quality: "proxy" | "final" = (render?.quality ?? renderData.quality) === "proxy" ? "proxy" : "final"
      const formats = map.formats.flatMap((f) => {
        const url = str(completedOutput(nodeStates, f.ref.nodeId)?.videoUrl)
        return url ? [{ format: f.format, url }] : []
      })
      const failedFormats = map.formats.filter((f) => stateOf(nodeStates, f.ref.nodeId) === "failed").map((f) => f.format)
      // The first chosen format is what a single-value read gets; a preview run has only its render.
      const videoUrl = formats[0]?.url ?? (quality === "proxy" ? str(render?.videoUrl) : undefined)
      return {
        ...(videoUrl ? { videoUrl } : {}),
        formats,
        ...(failedFormats.length > 0 ? { failedFormats } : {}),
        ...(planOut?.json !== undefined ? { json: planOut.json, plan: planOut.json } : {}),
        quality,
        ...(str(render?.planBasis) ? { planBasis: str(render?.planBasis) } : {}),
        ...(str(render?.renderBasis) ? { renderBasis: str(render?.renderBasis) } : {}),
        ...common,
      }
    }
    case "clips":
      return { ...clipsOutput(graph, map, nodeStates, planOut), ...common }
    default:
      return { quality: "final", ...common }
  }
}

type Out = Readonly<Record<string, unknown>> | undefined

/** A per-clip step's rows: its list (a hole is ""), else its one file (a step that ran once). */
function rowsOf(out: Out): string[] {
  if (!out) return []
  if (Array.isArray(out.listResults)) return (out.listResults as unknown[]).map((u) => str(u) ?? "")
  const one = str(out.videoUrl) ?? str(out.audioUrl)
  return one ? [one] : []
}

/** The render's row stamps, row-aligned with its rows; a render that ran once stamps its one take. */
function renderStampsOf(render: Out): ReadonlyArray<Readonly<Record<string, unknown>>> {
  if (!render) return []
  if (Array.isArray(render.listResultStamps)) return (render.listResultStamps as unknown[]).map((s) => (isRecord(s) ? s : {}))
  return [render]
}

/** A clip set's clips, what could not be rendered, and the plan (see the module note). */
function clipsOutput(
  graph: StoredInlineGraph,
  map: ClipsOutputMap,
  nodeStates: Readonly<Record<string, unknown>>,
  planOut: Out,
): Omit<UseCaseWrapperOutput, "_executionId"> {
  const render = completedOutput(nodeStates, map.renderNodeId)
  const renderData = graph.nodes.find((n) => n.id === map.renderNodeId)?.data ?? {}
  const renderRows = rowsOf(render)
  const stamps = renderStampsOf(render)
  // The take's quality: what its rows were stamped with, else the job's output, else the snapshot's setting.
  const quality = qualityOf(stamps.find((s) => qualityOf(s.quality))?.quality) ?? qualityOf(render?.quality) ?? qualityOf(renderData.quality) ?? "final"
  // The render rows that have a file, in order: what a step after the render ran once each on.
  const rendered = renderRows.flatMap((url, i) => (url ? [i] : []))
  // A review-on run stops at the render (what follows runs in Render final): its previews are the clips.
  const after = map.media.nodeId !== map.renderNodeId && quality === "final"
  // Captioning ran (it completed, or failed): only then is a missing caption a
  // failed one. A run that stopped before it (a time cap, a dead worker) keeps
  // nothing: it fails, and Continue from where it failed captions the clips
  // it rendered, rendering nothing again (decided 2026-10-18).
  const captionsState = after ? stateOf(nodeStates, map.media.nodeId) : undefined
  const captionsNotRun = after && captionsState !== "completed" && captionsState !== "failed" && rendered.length > 0
  const lastOut = after ? completedOutput(nodeStates, map.media.nodeId) : undefined
  const lastRows = rowsOf(lastOut)
  const lastStamps = renderStampsOf(lastOut)
  // Each rendered clip: its captioned file, else (its captions failed, or the
  // whole step did) its render stands in, uncaptioned and named.
  const pairs = captionsNotRun ? [] : rendered.map((row, j) => {
    const captioned = after ? lastRows[j] || undefined : undefined
    return { url: captioned ?? renderRows[row]!, row, captioned: !!captioned, j, captionsFailed: after && !captioned }
  })

  const planned = Array.isArray(planOut?.json) ? (planOut!.json as unknown[]) : []
  // Each planned clip's title and hook, by its clip key (the key is the clip's span: an edited hook keeps it).
  const meta = new Map(planned.flatMap((c) => {
    const clip = typeof c === "string" ? parseJson(c) : c
    const key = edlSpanKey(clip)
    const m = (isRecord(clip) ? clip.meta : undefined) as { title?: unknown; hook?: unknown } | undefined
    return key ? [[key, m ?? {}] as const] : []
  }))
  const clips = pairs.map(({ url, row, captioned, j, captionsFailed }): UseCaseClipRow => {
    const s = stamps[row] ?? {}
    const clipKey = str(s.clipKey)
    const m = clipKey ? meta.get(clipKey) : undefined
    // The still of the file the clip delivers: its captioned file's, else its render's.
    const thumbnailUrl = (captioned ? str(lastStamps[j]?.thumbnailUrl) : undefined) ?? str(s.thumbnailUrl)
    return {
      url,
      quality: qualityOf(s.quality) ?? quality,
      ...(clipKey ? { clipKey } : {}),
      ...(str(s.planBasis) ? { planBasis: str(s.planBasis) } : {}),
      ...(str(s.renderBasis) ? { renderBasis: str(s.renderBasis) } : {}),
      ...(str(m?.title) ? { title: str(m?.title) } : {}),
      ...(str(m?.hook) ? { hook: str(m?.hook) } : {}),
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
      ...(captionsFailed ? { captionsFailed: true as const } : {}),
    }
  })

  // The clips that could not be rendered: a render row with no file that was
  // started (a row never started is `cancelled`). A render that failed
  // outright (no clip at all) failed every clip it was given: the plan's.
  const renderFailed = stateOf(nodeStates, map.renderNodeId) === "failed"
  const failedClips = renderFailed
    ? planned.length
    : renderRows.filter((url, i) => !url && stamps[i]?.cancelled !== true).length
  const failedCaptions = clips.filter((c) => c.captionsFailed).length
  // Why no clip rendered: the render step's own error.
  const renderState = nodeStates[map.renderNodeId] as { error?: unknown; errorCode?: unknown } | undefined
  const renderError = renderFailed ? (str(renderState?.error) ?? str(renderState?.errorCode)) : undefined
  const first = clips[0]?.url
  const audio = !!render && !str(render.videoUrl) && !!str(render.audioUrl) && !after
  return {
    ...(first ? { [audio ? "audioUrl" : "videoUrl"]: first } : {}),
    clips,
    ...(failedClips > 0 ? { failedClips } : {}),
    ...(failedCaptions > 0 ? { failedCaptions } : {}),
    ...(captionsNotRun ? { captionsNotRun: true as const } : {}),
    ...(renderError ? { renderError } : {}),
    ...(planOut?.json !== undefined ? { json: planOut.json, plan: planOut.json } : {}),
    quality,
  }
}

const qualityOf = (v: unknown): "proxy" | "final" | undefined => (v === "proxy" || v === "final" ? v : undefined)

const parseJson = (v: string): unknown => {
  try {
    return JSON.parse(v)
  } catch {
    return undefined
  }
}

const stateOf = (states: Readonly<Record<string, unknown>>, id: string): unknown => (states[id] as { status?: unknown } | undefined)?.status

/**
 * Whether a run that FAILED still delivered what its kind promises and keeps
 * it (decided 2026-10-18): a final Trailer some of whose formats rendered,
 * or a final Clip Pack some of whose clips did (or all did, and the captions
 * step failed: the clips come uncaptioned), completes with them, its fee
 * kept. Only a list result does; an episode or chapters run that failed is a
 * failure, and a preview is never kept from a failed run.
 */
export function usecaseWrapperKeepsPartial(graph: StoredInlineGraph | null, output: UseCaseWrapperOutput): boolean {
  if (!graph || output.quality !== "final") return false
  return (deliveredRowsOf(graph, output)?.length ?? 0) > 0
}

/** The rows a list result delivered (a Trailer's formats, a Clip Pack's clips); undefined for any other kind. */
function deliveredRowsOf(graph: StoredInlineGraph, output: UseCaseWrapperOutput): readonly unknown[] | undefined {
  switch (usecaseResultKind(graph.outputMap)) {
    case "formats":
      return output.formats ?? []
    case "clips":
      return output.clips ?? []
    default:
      return undefined
  }
}

/**
 * Why a clip set delivered no clip although its plan had some (every render
 * failed: a clip whose captions failed is still delivered, uncaptioned), in
 * the user's words; null when that is not what happened. Said for a
 * completed run and for a failed one alike.
 */
export function usecaseNoClipsRenderedMessage(graph: StoredInlineGraph | null, output: UseCaseWrapperOutput): string | null {
  if (!graph || usecaseResultKind(graph.outputMap) !== "clips" || (output.clips?.length ?? 0) > 0) return null
  // Clips rendered, but the run stopped before captioning them: not "none rendered".
  if (output.captionsNotRun) return null
  const n = output.failedClips ?? 0
  if (n <= 0) return null
  return clipPackNoneRenderedMessage(n, output.renderError)
}

/** Why a completed run of this kind delivered nothing, in the user's words. */
export function usecaseNoResultMessage(graph: StoredInlineGraph | null, output?: UseCaseWrapperOutput): string {
  const noneRendered = output ? usecaseNoClipsRenderedMessage(graph, output) : null
  if (noneRendered) return noneRendered
  switch (graph ? usecaseResultKind(graph.outputMap) : "episode") {
    case "chapters":
      return "The plan found no chapters in this recording."
    case "clips":
      return "The plan found no clips in this recording."
    default:
      return "The run finished without a result"
  }
}
