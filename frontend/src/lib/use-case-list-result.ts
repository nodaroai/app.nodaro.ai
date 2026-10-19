/**
 * A use-case node whose own result is a list (Trailer's formats; Clip Pack's
 * clips) lands it as the rows of ONE run (decided 2026-10-14): one result row
 * per delivery, each naming the run's wrapper job (so Render final and
 * Continue can address it) and its quality, the first on show; the node's own
 * list (`__listResults`, what an Each wire reads) and its row stamps beside it.
 * One mapping for the canvas's own run and every server lane:
 *
 *  - the canvas run lands the rows whole (`usecaseListRows`, `usecaseListFields`);
 *  - a server lane builds each row from the run's list (URLs and stamps) and
 *    merges in what the row delivers, matched by its file
 *    (`usecaseListRowFields` — through `usecaseTakeFields`, which every lane
 *    already spreads on the take it lands);
 *  - a lane that restores a run that finished while the tab was closed (from
 *    its wrapper job) lands the same rows the live run lands
 *    (`usecaseRunRows`), merged over the node's results (`usecaseMergeRunRows`).
 *
 * A review run delivers its preview alone: one row, and no list.
 */
import { usecaseListsItsResult } from "@nodaro/render-rules"
import { runResultIdentity } from "@/lib/run-result-identity"
import type { GeneratedResult } from "@/types/nodes"

type Output = Readonly<Record<string, unknown>>

/** What one delivery of the run says about itself beside its file. */
export interface UseCaseListRow {
  readonly url: string
  readonly format?: string
  readonly clipKey?: string
  readonly planBasis?: string
  readonly renderBasis?: string
  readonly title?: string
  readonly hook?: string
}

const ROW_KEYS = ["format", "clipKey", "planBasis", "renderBasis", "title", "hook"] as const

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined)

/** The deliveries a run reports, in order (an empty list for a review run's preview). */
export function usecaseListRowsOf(output: Output | null | undefined): UseCaseListRow[] {
  const list = Array.isArray(output?.formats) ? output!.formats : Array.isArray(output?.clips) ? output!.clips : []
  return (list as ReadonlyArray<Record<string, unknown> | null>).flatMap((r) => {
    const url = str(r?.url)
    if (!url) return []
    const row: Record<string, string> = { url }
    for (const key of ROW_KEYS) {
      const value = str(r?.[key])
      if (value) row[key] = value
    }
    return [row as unknown as UseCaseListRow]
  })
}

const qualityOf = (output: Output): "proxy" | "final" | undefined => (output.quality === "proxy" || output.quality === "final" ? output.quality : undefined)

/**
 * What the row whose file is `url` delivers (its format, or its clip's key,
 * bases, title and hook), for a lane that built the row from the run's list;
 * `undefined` for any other node type or a file the run did not deliver.
 */
export function usecaseListRowFields(nodeType: string | null | undefined, output: Output | null | undefined, url: string | null | undefined): Omit<UseCaseListRow, "url"> | undefined {
  if (!usecaseListsItsResult(nodeType) || !url) return undefined
  const row = usecaseListRowsOf(output).find((r) => r.url === url)
  if (!row) return undefined
  const { url: _url, ...fields } = row
  return fields
}

/**
 * The run's deliveries as result rows, newest run first in the node's
 * results: each names the run (`wrapperJobId`), its quality and what it
 * delivers, with the fields every take of the run keeps (`rowFields`: the
 * run's plan, transcript and settings). A review run's preview is one row.
 */
export function usecaseListRows(
  nodeType: string,
  output: Output,
  wrapperJobId: string | undefined,
  at: string,
  rowFields: (url: string) => Readonly<Record<string, unknown>> | undefined = () => undefined,
): GeneratedResult[] {
  if (!usecaseListsItsResult(nodeType)) return []
  const quality = qualityOf(output)
  const rows = usecaseListRowsOf(output)
  const preview = str(output.videoUrl)
  const shown: UseCaseListRow[] = rows.length > 0 ? rows : preview ? [{ url: preview }] : []
  const settings = output.useCaseSettings && typeof output.useCaseSettings === "object" && !Array.isArray(output.useCaseSettings) ? { useCaseSettings: output.useCaseSettings } : {}
  return shown.map((r) => ({
    ...rowFields(r.url),
    ...r,
    timestamp: at,
    ...(wrapperJobId ? { jobId: wrapperJobId } : {}),
    ...(quality ? { quality } : {}),
    ...settings,
  }) as unknown as GeneratedResult)
}

/**
 * Every delivery of a finished run as the rows it lands, stamped as the live
 * run stamps them: the run's wrapper job, its render stamps (quality and
 * bases) on every row, the length and thumbnail only on the file they
 * describe, and what every take of the run keeps (`keep`: its plan,
 * transcript and settings). A review run's preview is one row.
 */
export function usecaseRunRows(
  nodeType: string,
  output: Output,
  wrapperJobId: string | undefined,
  at: string,
  keep: (url: string) => Readonly<Record<string, unknown>> | undefined,
): GeneratedResult[] {
  const { thumbnailUrl, duration, ...stamps } = runResultIdentity(nodeType, output)
  const described = str(output.videoUrl)
  return usecaseListRows(nodeType, output, wrapperJobId, at, (url) => ({
    ...stamps,
    ...(url === described ? { ...(thumbnailUrl ? { thumbnailUrl } : {}), ...(duration !== undefined ? { duration } : {}) } : {}),
    ...keep(url),
  }))
}

/**
 * The node's results once a restored run's rows land: the rows first (the
 * first on show), then the earlier results — less a placeholder of that run
 * (its job with no file yet) and any row already holding one of its files, so
 * a run restored twice, or partly landed, never shows a delivery twice.
 */
export function usecaseMergeRunRows(prior: readonly GeneratedResult[], rows: readonly GeneratedResult[], jobId: string): GeneratedResult[] {
  const files = new Set(rows.map((r) => r.url))
  return [...rows, ...prior.filter((r) => !files.has(r.url) && !(r.jobId === jobId && !r.url))]
}

/**
 * The node's own list, its row stamps, and the first delivery on show; empty
 * for any other node type. Each row's stamp is the one every lane writes
 * (the server's `listResultStamps` too): the take's quality, its clip, its
 * plan and render bases (the row's own, else the run's) and the run's
 * wrapper job when the lane knows it.
 */
export function usecaseListFields(nodeType: string, output: Output, wrapperJobId?: string | null): Record<string, unknown> {
  if (!usecaseListsItsResult(nodeType)) return {}
  const rows = usecaseListRowsOf(output)
  const quality = qualityOf(output)
  const runPlanBasis = str(output.planBasis)
  const runRenderBasis = str(output.renderBasis)
  const jobId = str(wrapperJobId)
  return {
    __listResults: rows.length > 0 ? rows.map((r) => r.url) : undefined,
    __listResultStamps: rows.length > 0
      ? rows.map((r) => {
          const planBasis = r.planBasis ?? runPlanBasis
          const renderBasis = r.renderBasis ?? runRenderBasis
          return {
            ...(quality ? { quality } : {}),
            ...(r.clipKey ? { clipKey: r.clipKey } : {}),
            ...(planBasis ? { planBasis } : {}),
            ...(renderBasis ? { renderBasis } : {}),
            ...(jobId ? { jobId } : {}),
          }
        })
      : undefined,
    generatedVideoUrl: rows[0]?.url ?? str(output.videoUrl),
    activeResultIndex: 0,
  }
}

/**
 * The deliveries the run could not make (Trailer: the formats whose render
 * failed, the others delivered), as the node names them: the list on a run
 * that delivered, cleared otherwise — a run's failure says what failed. Empty
 * for any other node type.
 */
/** The formats a run could not render (Trailer), as the run reports them; empty when none. */
export function usecaseRunFailedFormats(output: Output | null | undefined): string[] {
  return Array.isArray(output?.failedFormats) ? (output!.failedFormats as unknown[]).filter((f): f is string => typeof f === "string" && f !== "") : []
}

export function usecaseFailedDeliveriesField(nodeType: string | null | undefined, output: Output | null | undefined): { failedFormats?: readonly string[] } {
  if (!usecaseListsItsResult(nodeType)) return {}
  const failed = usecaseRunFailedFormats(output)
  return { failedFormats: usecaseListRowsOf(output).length > 0 && failed.length > 0 ? failed : undefined }
}
