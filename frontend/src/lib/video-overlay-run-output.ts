/**
 * A finished Video Overlay run's facts, under the keys the node reads: the
 * worker's `warnings` (the panel's one "Last run" line), the output canvas
 * `width` × `height`, the output length `durationSec` and the freshness key
 * `resultCompositionKey` a backend DAG run stamps (payload-builder →
 * the worker's output_data; `videoOverlayCompositionKey` in @nodaro/shared) or
 * a canvas single-node Run sent with its request (the REST job echoes it), so
 * a result from Execute All, Run from here, a schedule, a webhook, an app run
 * or a single-node Run restored after a reload reads fresh, not "Result (old)".
 *
 * Every lane that lands a run's result on the node calls this ONE mapping —
 * the single-node Run (execute-node), the backend run's live sync
 * (run-handlers `syncNodeStatesToStore`), the job restore after a reload
 * (run-handlers `applyRestoredJobCompletion`, lib/reconcile-completed-jobs) and
 * the three load-time lanes in use-workflow-persistence (the job sync
 * `syncNodeResultsFromDB`, which lands a single-node Run that finished while
 * the tab was closed, and the two execution-state lanes) — so the line reads the
 * same whichever path ran (UX §2.7 / §6), and never survives a later run that
 * did not produce it.
 *
 * Every key is always present: a run with no warnings writes `[]`, a missing
 * canvas, length or key writes `undefined` — so a later run OVERWRITES what an
 * earlier one left, instead of merging over it. An output without the key (a
 * REST call that sent none — the live canvas Run writes its own key after this
 * spread) leaves the result unstamped: it reads "Result (old)".
 */
export interface VideoOverlayRunOutputFields {
  readonly warnings: readonly unknown[]
  readonly width: number | undefined
  readonly height: number | undefined
  readonly durationSec: number | undefined
  readonly resultCompositionKey: string | undefined
}

export interface VideoOverlayRunOutputSource {
  readonly warnings?: unknown
  readonly width?: unknown
  readonly height?: unknown
  readonly durationSec?: unknown
  readonly resultCompositionKey?: unknown
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

/** `output`: a job's `output_data` or a node state's `output` — any object; only the five keys are read. */
export function videoOverlayRunOutputFields(output: object | null | undefined): VideoOverlayRunOutputFields {
  const o: VideoOverlayRunOutputSource = output ?? {}
  const size = finite(o.width) && finite(o.height)
  return {
    warnings: Array.isArray(o.warnings) ? o.warnings : [],
    width: size ? (o.width as number) : undefined,
    height: size ? (o.height as number) : undefined,
    durationSec: finite(o.durationSec) ? o.durationSec : undefined,
    resultCompositionKey:
      typeof o.resultCompositionKey === "string" && o.resultCompositionKey.length > 0 ? o.resultCompositionKey : undefined,
  }
}

/**
 * A list fan-out's result rows are separate compositions — one per list item —
 * so each row carries the key of the composition that produced it: the
 * backend's `listResultCompositionKeys`, row-aligned with `listResults`
 * (fan-out-result.ts), looked up by the row's URL. Never the node's key (that
 * is the first item's). The three lanes that build fan-out rows — the live sync
 * (run-handlers `syncNodeStatesToStore`) and both load-time lanes in
 * use-workflow-persistence — spread `rowFields(url)` onto each row. Any other
 * node type gets `{}`.
 */
export function videoOverlayListRowFields(
  nodeType: string,
  output: { readonly listResults?: unknown; readonly listResultCompositionKeys?: unknown } | null | undefined,
): (url: string) => { resultCompositionKey?: string } {
  if (nodeType !== "video-overlay") return () => ({})
  const urls = Array.isArray(output?.listResults) ? output.listResults : []
  const keys = Array.isArray(output?.listResultCompositionKeys) ? output.listResultCompositionKeys : []
  const byUrl = new Map<string, string>()
  urls.forEach((url, row) => {
    const key = keys[row]
    if (typeof url === "string" && url && typeof key === "string" && key && !byUrl.has(url)) byUrl.set(url, key)
  })
  return (url) => ({ resultCompositionKey: byUrl.get(url) })
}

