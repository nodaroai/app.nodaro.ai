import { Check, CheckCircle2, ExternalLink, History, Play, Trash2, Undo2, Workflow, X } from "lucide-react"
import { collectionRecordHeadline, type CollectionRecord, type CollectionRecordSource } from "@nodaro/shared"
import { Button } from "@/components/ui/button"
import { MetaAdMedia } from "@/components/nodes/meta-ad-media"
import { useT, type MessageKey } from "@/lib/i18n"
import { formatDateTime } from "@/lib/i18n/format"
import { FIELDS_SHOWN_ELSEWHERE, cardTint, recordAuthor, recordOrigin, recordSource, recordStill, recordVideo } from "@/lib/collection-record-view"
import { initialOf } from "@/lib/post-display"
import { cn } from "@/lib/utils"

/** The field shown as a one-line preview under the provenance row (a post ready to publish). */
const PREVIEW_FIELD = "post"
const CHIPS_SHOWN = 3

/** How a record was marked used by hand: the API, MCP, the page. */
const USED_VIA_KEY: Record<string, MessageKey> = {
  api: "collections.usedViaApi",
  mcp: "collections.usedViaMcp",
  ui: "collections.usedByHand",
}

/** "by <workflow>" (a link to its editor and to the run) or how the record was marked by hand. */
function UsedBy({ source }: { readonly source: CollectionRecordSource | undefined }) {
  const t = useT()
  if (!source) return null
  const { workflowHref, runHref } = recordOrigin(source)
  if (source.workflowId) {
    const label = source.workflowName ? t("collections.usedByWorkflow", { workflow: source.workflowName }) : t("collections.usedByWorkflowUnknown")
    return (
      <>
        {workflowHref ? (
          <a href={workflowHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium hover:underline" dir="auto">
            <Workflow className="h-3 w-3" />
            {label}
          </a>
        ) : (
          <span className="inline-flex items-center gap-1" dir="auto">
            <Workflow className="h-3 w-3" />
            {label}
          </span>
        )}
        {runHref && (
          <a href={runHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#c8237f] hover:underline">
            <History className="h-3 w-3" />
            {t("collections.openRun")}
          </a>
        )}
      </>
    )
  }
  const via = source.via ? USED_VIA_KEY[source.via] : undefined
  return via ? <span>{t(via)}</span> : null
}

/**
 * One record of the list: its running number (and, in select mode, its
 * checkbox) beside a tinted card — the headline with the actions (Mark as
 * used / Used · Undo, Delete or Restore), the text, a media thumbnail, the
 * provenance row (Source, Workflow, when it was saved, Open run), the used
 * line, the post preview and the field chips.
 */
export function CollectionRecordCard({
  record,
  number,
  total,
  selectMode,
  selected,
  busy,
  onSelectToggle,
  onToggleUsed,
  onDelete,
  onRestore,
  onDeleteForever,
}: {
  readonly record: CollectionRecord
  /** The running number in the list (1-based). */
  readonly number: number
  /** How many records the list holds in all; null when the server did not count. */
  readonly total: number | null
  readonly selectMode: boolean
  readonly selected: boolean
  readonly busy?: boolean
  readonly onSelectToggle: () => void
  /** Mark the record used (true) or not used again (false); absent when the server cannot mark yet. */
  readonly onToggleUsed?: (used: boolean) => void
  /** Move the record to the Trash; absent when the server has no Trash yet. */
  readonly onDelete?: () => void
  readonly onRestore: () => void
  /** Delete a record already in the Trash for good. */
  readonly onDeleteForever: () => void
}) {
  const t = useT()
  const headline = collectionRecordHeadline(record)
  const inTrash = typeof record.deletedAt === "string" && record.deletedAt.length > 0
  const used = typeof record.usedAt === "string" && record.usedAt.length > 0
  const source = recordSource(record)
  const { workflowHref, runHref } = recordOrigin(record.source)
  const workflowName = record.source.workflowName
  const still = recordStill(record)
  const video = recordVideo(record)
  const body = record.text.trim() && record.text.trim() !== headline ? record.text.trim() : ""
  const preview = record.fields[PREVIEW_FIELD]
  const chips = Object.entries(record.fields).filter(([key]) => key !== PREVIEW_FIELD && !FIELDS_SHOWN_ELSEWHERE.has(key))
  const surface = "bg-background/60 dark:bg-black/20"

  return (
    <div className="grid grid-cols-[44px_minmax(0,1fr)] items-start gap-2.5">
      <div className="flex flex-col items-end gap-2.5 pt-3 tabular-nums">
        <div className="text-end">
          <div className="text-lg font-bold leading-none">{number}</div>
          {total !== null && <div className="mt-[3px] text-[11px] text-muted-foreground">{t("collections.ofTotal", { total })}</div>}
        </div>
        {selectMode && (
          <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-label={t("collections.selectRecord", { n: number })}
            onClick={onSelectToggle}
            className={cn(
              "flex h-[22px] w-[22px] items-center justify-center rounded-[5px] border-2 text-white",
              selected ? "border-[#c8237f] bg-[#c8237f]" : "border-muted-foreground/60 bg-transparent",
            )}
          >
            {selected && <Check className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      <article
        className={cn("flex min-w-0 flex-col rounded-[10px] border border-s-4 px-[18px] pb-4 pt-[18px]", cardTint(number - 1), selected && "border-[#c8237f]", inTrash && "opacity-60")}
        aria-busy={busy || undefined}
      >
        <div className="flex items-start gap-3.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-[17px] font-semibold leading-[1.35]" dir="auto">
                {headline}
              </h3>
              <div className="flex flex-none items-center gap-2">
                {!inTrash && used && (
                  <>
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:border-[#1f4a37] dark:bg-[#12291f] dark:text-[#5fd3a0]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#3cb389]" />
                      {t("collections.usedBadge")}
                    </span>
                    {onToggleUsed && (
                      <Button type="button" variant="outline" size="sm" className="h-7 px-2.5 text-xs text-muted-foreground" onClick={() => onToggleUsed(false)} disabled={busy}>
                        {t("collections.undoUsed")}
                      </Button>
                    )}
                  </>
                )}
                {!inTrash && !used && onToggleUsed && (
                  <Button type="button" size="sm" className="h-7 gap-1.5 rounded-md bg-[#3cb389] px-3 text-xs font-bold text-[#06211a] hover:bg-[#52c99d]" onClick={() => onToggleUsed(true)} disabled={busy}>
                    <Check className="h-3.5 w-3.5" />
                    {t("collections.markUsed")}
                  </Button>
                )}
                {inTrash ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 gap-1.5 rounded-md border border-[#bcd7ee] bg-[#e7f1fb] px-3 text-xs font-bold text-[#1f6fa8] hover:bg-[#d7e8f7] dark:border-[#27486a] dark:bg-[#1a2a3a] dark:text-[#7cc4f0] dark:hover:bg-[#23384d] dark:hover:text-white"
                      onClick={onRestore}
                      disabled={busy}
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                      {t("collections.restore")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 gap-1.5 rounded-md border border-[#f3bfc2] bg-[#fdecec] px-3 text-xs font-bold text-[#c22b33] hover:border-[#d9343c] hover:bg-[#d9343c] hover:text-white dark:border-[#5a2328] dark:bg-[#2a1416] dark:text-[#ff8a90]"
                      onClick={onDeleteForever}
                      disabled={busy}
                    >
                      <X className="h-3.5 w-3.5" />
                      {t("collections.deleteForever")}
                    </Button>
                  </>
                ) : onDelete ? (
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 gap-1.5 rounded-md border border-[#f3bfc2] bg-[#fdecec] px-3 text-xs font-bold text-[#c22b33] hover:border-[#d9343c] hover:bg-[#d9343c] hover:text-white dark:border-[#5a2328] dark:bg-[#2a1416] dark:text-[#ff8a90]"
                    onClick={onDelete}
                    disabled={busy}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t("common.delete")}
                  </Button>
                ) : null}
              </div>
            </div>
            {body && (
              <p className="mt-1.5 line-clamp-3 text-sm leading-[1.45] text-muted-foreground" dir="auto">
                {body}
              </p>
            )}
          </div>
          {(still || video) && (
            // The thumbnail opens the medium itself in a new tab; a video without a poster shows its first frame.
            <a
              href={video?.url ?? still ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="relative block h-[90px] w-40 flex-none overflow-hidden rounded-lg border bg-black/80"
              aria-label={video ? t("collections.videoThumb") : t("collections.openLink")}
            >
              {still ? (
                <MetaAdMedia src={still} initial={initialOf(recordAuthor(record).label || headline)} className="h-full w-full" initialClassName="text-[15px]" />
              ) : (
                video && <video src={video.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
              )}
              {video && (
                <span className="absolute inset-0 m-auto flex h-[26px] w-[26px] items-center justify-center rounded-full bg-black/60 text-white">
                  <Play className="h-3 w-3 fill-current" />
                </span>
              )}
            </a>
          )}
        </div>

        <div className="mt-auto pt-3" />
        <div className={cn("flex flex-wrap items-center gap-x-[18px] gap-y-2 rounded-lg border px-3 py-2 text-[13px]", surface)}>
          {source &&
            (source.href ? (
              <a href={source.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1.5 hover:underline">
                <span className="text-muted-foreground">{t("collections.sourceLabel")}</span>
                <span className="max-w-[200px] truncate" dir="auto">
                  {source.name}
                </span>
                <ExternalLink className="h-3 w-3 text-muted-foreground" />
              </a>
            ) : (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span className="text-muted-foreground">{t("collections.sourceLabel")}</span>
                <span className="max-w-[200px] truncate" dir="auto">
                  {source.name}
                </span>
              </span>
            ))}
          {workflowName &&
            (workflowHref ? (
              // The workflow and its run open in a new tab: the list stays where it was.
              <a href={workflowHref} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1.5 hover:underline">
                <span className="text-muted-foreground">{t("collections.workflowLabel")}</span>
                <span className="max-w-[220px] truncate" dir="auto">
                  {workflowName}
                </span>
                <ExternalLink className="h-3 w-3 text-muted-foreground" />
              </a>
            ) : (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span className="text-muted-foreground">{t("collections.workflowLabel")}</span>
                <span className="max-w-[220px] truncate" dir="auto">
                  {workflowName}
                </span>
              </span>
            ))}
          <div className="ms-auto inline-flex items-center gap-2.5">
            <span className="text-xs tabular-nums">{formatDateTime(record.createdAt)}</span>
            {runHref && (
              <a href={runHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-md bg-[#c8237f] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#e02d91]">
                {t("collections.openRun")}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
        {used && (
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-3 w-3" />
            <span>{t("collections.usedOn", { date: formatDateTime(record.usedAt as string) })}</span>
            <UsedBy source={record.usedBy} />
          </p>
        )}
        {typeof preview === "string" && preview.trim() && (
          <div className={cn("mt-3 truncate rounded-md px-2 py-1 text-xs text-muted-foreground", surface)} dir="auto">
            <span>{`${PREVIEW_FIELD}${t("common.labelColon")}`}</span>
            {preview}
          </div>
        )}
        {chips.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
            {chips.slice(0, CHIPS_SHOWN).map(([key, value]) => (
              <li key={key} className={cn("max-w-full truncate rounded-md px-2 py-[3px]", surface)} dir="auto">
                {`${key}${t("common.labelColon")}${String(value)}`}
              </li>
            ))}
            {chips.length > CHIPS_SHOWN && <li className="px-1 py-[3px]">{t("collections.fieldsMore", { n: chips.length - CHIPS_SHOWN })}</li>}
          </ul>
        )}
      </article>
    </div>
  )
}
