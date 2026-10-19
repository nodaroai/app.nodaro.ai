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
 * A review run of Trailer delivers its preview alone: one row, and no list
 * (Clip Pack's review run delivers each clip's preview, one row each). A
 * Clip Pack of an audio recording delivers audio clips: its first clip is the
 * node's audio, never its video.
 */
import { USE_CASE_RESULT_KEYS, isUseCaseNodeType, usecaseDescriptor, usecaseListsItsResult } from "@nodaro/render-rules"
import { runResultIdentity } from "@/lib/run-result-identity"
import type { GeneratedResult } from "@/types/nodes"

type Output = Readonly<Record<string, unknown>>

/** What one delivery of the run says about itself beside its file. */
export interface UseCaseListRow {
  readonly url: string
  /** The row's own take (a Clip Pack's clip is its own render); the run's when it names none. */
  readonly quality?: "proxy" | "final"
  readonly format?: string
  readonly clipKey?: string
  readonly planBasis?: string
  readonly renderBasis?: string
  readonly title?: string
  readonly hook?: string
  /** Clip Pack: the still of the clip's file (none for an audio clip). */
  readonly thumbnailUrl?: string
  /** Clip Pack: the clip's captions could not be added — it is delivered uncaptioned. */
  readonly captionsFailed?: true
  /** An audio run's delivery (a Clip Pack of an audio recording): the run says so, whatever its file is named. */
  readonly medium?: "audio"
}

const ROW_KEYS = ["format", "clipKey", "planBasis", "renderBasis", "title", "hook", "thumbnailUrl"] as const

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined)

/** The deliveries a run reports, in order (an empty list for a review run's preview). */
export function usecaseListRowsOf(output: Output | null | undefined): UseCaseListRow[] {
  // Every delivery of an audio run is audio: its medium is the run's, never guessed from a file name.
  const audio = !!output && deliversAudio(output)
  const list = Array.isArray(output?.formats) ? output!.formats : Array.isArray(output?.clips) ? output!.clips : []
  return (list as ReadonlyArray<Record<string, unknown> | null>).flatMap((r) => {
    const url = str(r?.url)
    if (!url) return []
    const row: Record<string, unknown> = { url }
    const quality = qualityOf(r?.quality)
    if (quality) row.quality = quality
    for (const key of ROW_KEYS) {
      const value = str(r?.[key])
      if (value) row[key] = value
    }
    if (r?.captionsFailed === true) row.captionsFailed = true
    if (audio) row.medium = "audio"
    return [row as unknown as UseCaseListRow]
  })
}

const qualityOf = (v: unknown): "proxy" | "final" | undefined => (v === "proxy" || v === "final" ? v : undefined)

/** Whether a run's deliveries are audio (a Clip Pack of an audio recording): it reports an audio file and no video. */
const deliversAudio = (output: Output): boolean => !str(output.videoUrl) && !!str(output.audioUrl)

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
  const runQuality = qualityOf(output.quality)
  const rows = usecaseListRowsOf(output)
  const preview = str(output.videoUrl) ?? str(output.audioUrl)
  const shown: UseCaseListRow[] = rows.length > 0 ? rows : preview ? [{ url: preview }] : []
  const settings = output.useCaseSettings && typeof output.useCaseSettings === "object" && !Array.isArray(output.useCaseSettings) ? { useCaseSettings: output.useCaseSettings } : {}
  return shown.map((r) => {
    const quality = r.quality ?? runQuality
    return {
      ...rowFields(r.url),
      ...r,
      timestamp: at,
      ...(wrapperJobId ? { jobId: wrapperJobId } : {}),
      ...(quality ? { quality } : {}),
      ...settings,
    } as unknown as GeneratedResult
  })
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
  const described = str(output.videoUrl) ?? str(output.audioUrl)
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
 * The node's own list, its row stamps, and the first delivery on show (as
 * the node's audio when the run delivers audio, its video otherwise); empty
 * for any other node type. Each row's stamp is the one every lane writes
 * (the server's `listResultStamps` too): the take's quality (the row's own,
 * else the run's), its clip, its plan and render bases (the row's own, else
 * the run's) and the run's wrapper job when the lane knows it.
 */
export function usecaseListFields(nodeType: string, output: Output, wrapperJobId?: string | null): Record<string, unknown> {
  if (!usecaseListsItsResult(nodeType)) return {}
  const rows = usecaseListRowsOf(output)
  const runQuality = qualityOf(output.quality)
  const audio = deliversAudio(output)
  const first = rows[0]?.url ?? (audio ? str(output.audioUrl) : str(output.videoUrl))
  const runPlanBasis = str(output.planBasis)
  const runRenderBasis = str(output.renderBasis)
  const jobId = str(wrapperJobId)
  return {
    __listResults: rows.length > 0 ? rows.map((r) => r.url) : undefined,
    __listResultStamps: rows.length > 0
      ? rows.map((r) =>
          usecaseListStamp({
            quality: r.quality ?? runQuality,
            clipKey: r.clipKey,
            planBasis: r.planBasis ?? runPlanBasis,
            renderBasis: r.renderBasis ?? runRenderBasis,
            thumbnailUrl: r.thumbnailUrl,
            jobId,
          }),
        )
      : undefined,
    ...(audio ? { generatedAudioUrl: first, generatedVideoUrl: undefined } : { generatedVideoUrl: first }),
    activeResultIndex: 0,
  }
}

/** One row's stamp in the node's own list, as every lane writes it (the server's `listResultStamps` too). */
export function usecaseListStamp(r: {
  readonly quality?: string
  readonly clipKey?: string
  readonly planBasis?: string
  readonly renderBasis?: string
  readonly thumbnailUrl?: string
  readonly jobId?: string
}): Record<string, string> {
  return {
    ...(r.quality ? { quality: r.quality } : {}),
    ...(r.clipKey ? { clipKey: r.clipKey } : {}),
    ...(r.planBasis ? { planBasis: r.planBasis } : {}),
    ...(r.renderBasis ? { renderBasis: r.renderBasis } : {}),
    ...(r.thumbnailUrl ? { thumbnailUrl: r.thumbnailUrl } : {}),
    ...(r.jobId ? { jobId: r.jobId } : {}),
  }
}

/** What a run could not deliver, as the node names it under the run's takes. */
export interface UseCaseRunShortfall {
  /** Trailer: the formats whose render failed (the others were delivered). */
  readonly failedFormats?: readonly string[]
  /** Clip Pack: how many planned clips could not be rendered (the others were delivered). */
  readonly failedClips?: number
}

const count = (v: unknown): number | undefined => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : undefined)

/**
 * What a run could not deliver, as it reports it — the formats it could not
 * render (Trailer), how many clips it could not render (Clip Pack) — each
 * only when there is one. Every take of the run carries it, and the node
 * names it under the take on show.
 */
export function usecaseRunShortfall(output: Output | null | undefined): UseCaseRunShortfall {
  const formats = Array.isArray(output?.failedFormats) ? (output!.failedFormats as unknown[]).filter((f): f is string => typeof f === "string" && f !== "") : []
  const clips = count(output?.failedClips)
  return {
    ...(formats.length > 0 ? { failedFormats: formats } : {}),
    ...(clips !== undefined ? { failedClips: clips } : {}),
  }
}

/**
 * The deliveries the run could not make, on the node (Trailer's formats,
 * Clip Pack's clip count): named on a run that delivered, cleared otherwise —
 * a run's failure says what failed. Only the type's own fields; empty for any
 * other node type.
 */
export function usecaseFailedDeliveriesField(nodeType: string | null | undefined, output: Output | null | undefined): UseCaseRunShortfall {
  if (!usecaseListsItsResult(nodeType) || !isUseCaseNodeType(nodeType)) return {}
  const shortfall = usecaseListRowsOf(output).length > 0 ? usecaseRunShortfall(output) : {}
  // The fields a type's last run leaves beyond its failure code, by its result kind (Trailer's formats, Clip Pack's clip count).
  const fields = USE_CASE_RESULT_KEYS[usecaseDescriptor(nodeType).resultKind] as ReadonlyArray<keyof UseCaseRunShortfall>
  return Object.fromEntries(fields.map((field) => [field, shortfall[field]])) as UseCaseRunShortfall
}
