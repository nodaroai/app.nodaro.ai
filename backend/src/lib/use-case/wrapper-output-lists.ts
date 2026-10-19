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
 */
import { chapterRowsOf, formatChapterListText, usecaseResultKind, type StoredInlineGraph } from "@nodaro/render-rules"
import { completedOutput, failedStepOf, isRecord, str, type UseCaseWrapperOutput } from "./wrapper-output-parts.js"

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
    default:
      // Clips fill their own branch as they ship.
      return { quality: "final", ...common }
  }
}

const stateOf = (states: Readonly<Record<string, unknown>>, id: string): unknown => (states[id] as { status?: unknown } | undefined)?.status

/**
 * Whether a run that FAILED still delivered what its kind promises and keeps
 * it (decided 2026-10-18): a final Trailer some of whose formats rendered
 * completes with those formats, its fee kept. Only a list result does; an
 * episode or chapters run that failed is a failure.
 */
export function usecaseWrapperKeepsPartial(graph: StoredInlineGraph | null, output: UseCaseWrapperOutput): boolean {
  if (!graph || graph.outputMap.kind !== "formats") return false
  return output.quality === "final" && (output.formats?.length ?? 0) > 0
}

/** Why a completed run of this kind delivered nothing, in the user's words. */
export function usecaseNoResultMessage(graph: StoredInlineGraph | null): string {
  switch (graph ? usecaseResultKind(graph.outputMap) : "episode") {
    case "chapters":
      return "The plan found no chapters in this recording."
    case "clips":
      return "The plan found no clips in this recording."
    default:
      return "The run finished without a result"
  }
}
