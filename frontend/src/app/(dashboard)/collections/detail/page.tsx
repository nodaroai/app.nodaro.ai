import { useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { ArrowLeft, Check, Download, Loader2, Search, SquareDashed } from "lucide-react"
import { toast } from "sonner"
import {
  COLLECTION_RECORDS_OFFSET_MAX,
  collectionRecordHeadline,
  type CollectionExportFormat,
  type CollectionRecord,
  type CollectionRecordStatus,
  type CollectionUsage,
} from "@nodaro/shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { CollectionCapMeter } from "@/components/collections/collection-cap-meter"
import { CollectionRecordCard } from "@/components/collections/collection-record-card"
import { CollectionStatusTabs, type CollectionTab } from "@/components/collections/collection-status-tabs"
import { CollectionPagination, DEFAULT_PAGE_SIZE, type PageSize } from "@/components/collections/collection-pagination"
import { CollectionBulkBar } from "@/components/collections/collection-bulk-bar"
import { useCollection, useCollectionMutations, useCollectionRecordsPage, useCollections } from "@/hooks/queries/use-collections-queries"
import { exportCollection, isNotFoundError } from "@/lib/api"
import { localDayOf, localDayStartIso } from "@/lib/collection-record-view"
import { useT } from "@/lib/i18n"
import { formatDate } from "@/lib/i18n/format"
import { useAppDir } from "@/lib/locale-store"
import { cn } from "@/lib/utils"

const SEARCH_DELAY_MS = 300
type RecordOrder = "newest" | "oldest"
/** A delete waiting for its confirmation: to the Trash, or for good (records already in the Trash). */
type PendingDelete = { readonly kind: "trash" | "forever"; readonly records: readonly CollectionRecord[] }

/** Hand the browser a file to save. */
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Today as `YYYY-MM-DD` in the browser's timezone, shifted by `offsetDays`. */
function dayOffset(offsetDays: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return localDayOf(d.toISOString())
}

/** What a tab lists: the live records (all, used, not yet) or the Trash. */
function tabFilters(tab: CollectionTab): { usage: CollectionUsage; status: CollectionRecordStatus } {
  if (tab === "trash") return { usage: "all", status: "trash" }
  return { usage: tab === "used" ? "used" : tab === "new" ? "unused" : "all", status: "active" }
}

/**
 * One collection's records as numbered, tinted cards: every live record, the
 * used ones, the ones not used yet, or the Trash; newest or oldest first;
 * narrowed by words and by the days they were saved; a page at a time. Each
 * card says where the record came from, which workflow and run saved it (with
 * links), whether and by what it was used, and can be marked used, moved to
 * the Trash (alone or with others in select mode), restored, or — from the
 * Trash — deleted for good. Export downloads the live records.
 */
export default function CollectionDetailPage() {
  const t = useT()
  const isRtl = useAppDir() === "rtl"
  const { id } = useParams<{ id: string }>()
  const collection = useCollection(id)
  const list = useCollections()
  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  const [tab, setTab] = useState<CollectionTab>("all")
  const [order, setOrder] = useState<RecordOrder>("newest")
  const [fromDay, setFromDay] = useState("")
  const [toDay, setToDay] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [pending, setPending] = useState<PendingDelete | null>(null)
  const [exporting, setExporting] = useState(false)

  // The typed words reach the query a moment after typing stops, and only a CHANGED query
  // starts the list over: an unconditional reset fired once on opening too, and undid a page
  // picked in that first moment.
  useEffect(() => {
    const next = search.trim()
    if (next === q) return
    const timer = setTimeout(() => {
      setQ(next)
      setPage(1)
    }, SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [search, q])

  const since = fromDay ? localDayStartIso(fromDay) : undefined
  // The day picked as "to" is included: the filter ends at the next day's start.
  const until = toDay ? localDayStartIso(toDay, 1) : undefined
  const { usage, status } = tabFilters(tab)
  const offset = (page - 1) * pageSize
  const records = useCollectionRecordsPage(id, { q: q || undefined, usage, status, order, since, until }, { offset, limit: pageSize })
  const { removeRecord, deleteForever, restoreRecord, bulkRecords, setUsed } = useCollectionMutations()
  const rows = useMemo(() => records.data?.data ?? [], [records.data])
  // How many match in all — when the server counted. Without it the pages are turned one at a time.
  const total = records.data?.total ?? null
  const maxPages = Math.floor(COLLECTION_RECORDS_OFFSET_MAX / pageSize) + 1
  const pageCount = total !== null ? Math.max(1, Math.min(Math.ceil(total / pageSize), maxPages)) : page + (records.data?.nextCursor ? 1 : 0)
  // A page past the end (records gone meanwhile) goes back to the last one — on a real answer only,
  // never on an error or while the previous page is still on screen.
  useEffect(() => {
    if (records.isSuccess && !records.isPlaceholderData && total !== null && page > pageCount) setPage(pageCount)
  }, [records.isSuccess, records.isPlaceholderData, total, page, pageCount])

  const caps = list.data?.caps ?? { collections: null, records: null }
  const recordCount = collection.data?.recordCount ?? 0
  const usedCount = collection.data?.usedCount
  const trashCount = collection.data?.trashCount
  // A server before the usage release answers neither count: it can neither filter nor mark nor keep a
  // Trash, so the page shows neither the tabs nor those buttons rather than failing requests.
  const usageAvailable = typeof usedCount === "number"
  const trashAvailable = typeof trashCount === "number"
  const liveCount = recordCount - (trashCount ?? 0)
  const hasMedia = rows.some((r) => r.media.length > 0)
  const today = dayOffset(0)
  const yesterday = dayOffset(-1)
  const busyId = (m: { isPending: boolean; variables?: { recordId?: string } | undefined }) => (m.isPending ? m.variables?.recordId : undefined)
  const bulkBusy = bulkRecords.isPending

  const changeTab = (next: CollectionTab) => {
    setTab(next)
    setPage(1)
    setSelectMode(false)
    setSelected(new Set())
  }
  const changePageSize = (size: PageSize) => {
    setPageSize(size)
    setPage(1)
  }
  const resetToFirstPage = () => setPage(1)
  const setDays = (from: string, to: string) => {
    setFromDay(from)
    setToDay(to)
    resetToFirstPage()
  }
  const toggleSelectMode = () => {
    setSelectMode((on) => !on)
    setSelected(new Set())
  }
  const toggleSelected = (recordId: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(recordId)) next.delete(recordId)
      else next.add(recordId)
      return next
    })
  const selectAllOnPage = () => setSelected(new Set(rows.map((r) => r.id)))
  const clearSelection = () => setSelected(new Set())
  const selectedRows = rows.filter((r) => selected.has(r.id))
  const endSelection = () => {
    setSelected(new Set())
    setSelectMode(false)
  }

  const runExport = async (format: CollectionExportFormat) => {
    if (!id) return
    setExporting(true)
    try {
      const { blob, filename } = await exportCollection(id, format)
      saveBlob(blob, filename)
      toast.success(t("collections.exported"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("apiErr.exportCollection"))
    } finally {
      setExporting(false)
    }
  }

  // A failed mutation is announced once, by the query client; only the successes speak here.
  const toggleUsed = (record: CollectionRecord, used: boolean) => {
    if (!id) return
    setUsed.mutate({ id, recordId: record.id, used }, { onSuccess: () => toast.success(used ? t("collections.markedUsed") : t("collections.markedUnused")) })
  }
  const restoreOne = (record: CollectionRecord) => {
    if (!id) return
    restoreRecord.mutate({ id, recordId: record.id }, { onSuccess: () => toast.success(t("collections.restored")) })
  }
  const restoreSelected = () => {
    if (!id || selectedRows.length === 0) return
    bulkRecords.mutate(
      { id, ids: selectedRows.map((r) => r.id), action: "restore" },
      {
        onSuccess: (res) => {
          toast.success(res.updated === 1 ? t("collections.restored") : t("collections.restoredMany", { n: res.updated }))
          endSelection()
        },
      },
    )
  }

  // The confirmed delete: one record goes through the single call, several through the bulk one.
  const confirmPending = () => {
    if (!id || !pending || pending.records.length === 0) return
    const { kind, records: targets } = pending
    const one = targets.length === 1 ? targets[0]! : null
    if (kind === "trash") {
      if (one) removeRecord.mutate({ id, recordId: one.id }, { onSuccess: () => (toast.success(t("collections.trashed")), endSelection()) })
      else
        bulkRecords.mutate(
          { id, ids: targets.map((r) => r.id), action: "trash" },
          { onSuccess: (res) => (toast.success(t("collections.trashedMany", { n: res.updated })), endSelection()) },
        )
      return
    }
    if (one) deleteForever.mutate({ id, recordId: one.id }, { onSuccess: () => (toast.success(t("collections.deletedForever")), endSelection()) })
    else
      bulkRecords.mutate(
        { id, ids: targets.map((r) => r.id), action: "delete" },
        { onSuccess: (res) => (toast.success(t("collections.deletedForeverMany", { n: res.updated })), endSelection()) },
      )
  }

  const dayHeading = (day: string) =>
    day === today
      ? t("collections.todayHeading")
      : day === yesterday
        ? t("collections.yesterdayHeading")
        : formatDate(`${day}T12:00:00`, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
  const singleDay = fromDay && fromDay === toDay ? fromDay : null
  const rangeLabel = singleDay
    ? dayHeading(singleDay)
    : fromDay || toDay
      ? t("collections.rangeBetween", { from: formatDate(`${fromDay || toDay}T12:00:00`), to: formatDate(`${toDay || today}T12:00:00`) })
      : t("collections.dateAll")

  const emptyText =
    tab === "trash"
      ? t("collections.noTrash")
      : q || fromDay || toDay
        ? t("collections.noMatches")
        : tab === "new"
          ? t("collections.noUnused")
          : tab === "used"
            ? t("collections.noUsed")
            : t("collections.noRecords")

  const pendingCount = pending?.records.length ?? 0
  const pendingOne = pending && pending.records.length === 1 ? collectionRecordHeadline(pending.records[0]!) : null
  const dialogTitle =
    pending?.kind === "forever"
      ? pendingOne !== null
        ? t("collections.deleteForeverTitleOne")
        : t("collections.deleteForeverTitle", { n: pendingCount })
      : pendingOne !== null
        ? t("collections.trashTitleOne")
        : t("collections.trashTitle", { n: pendingCount })
  const dialogBody =
    pending?.kind === "forever"
      ? pendingOne !== null
        ? t("collections.deleteForeverBodyOne", { title: pendingOne })
        : t("collections.deleteForeverBody", { n: pendingCount })
      : pendingOne !== null
        ? t("collections.trashBodyOne", { title: pendingOne })
        : t("collections.trashBodyMany", { n: pendingCount })
  const from = rows.length === 0 ? 0 : offset + 1
  const to = offset + rows.length

  return (
    <div className="mx-auto max-w-[1400px] px-8 pb-20 pt-5">
      <Link to="/collections" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className={cn("h-4 w-4", isRtl && "rotate-180")} />
        {t("collections.back")}
      </Link>

      {collection.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : collection.error || !collection.data ? (
        isNotFoundError(collection.error) ? (
          <div className="rounded-lg border bg-muted/40 p-6 text-center text-sm text-muted-foreground">{t("collections.notFound")}</div>
        ) : (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{t("apiErr.loadCollections")}</div>
        )
      ) : (
        <>
          <div className="mt-[22px] flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-[26px] font-semibold" dir="auto">
                {collection.data.name}
              </h1>
              {collection.data.description && (
                <p className="mt-1 text-sm text-muted-foreground" dir="auto">
                  {collection.data.description}
                </p>
              )}
              {/* Every record counts toward the cap, the Trash included — the meter says what the cap sees. */}
              <CollectionCapMeter count={recordCount} cap={caps.records} className="mt-3.5 max-w-xs" />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={exporting || recordCount === 0}>
                  {exporting ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Download className="me-2 h-4 w-4" />}
                  {t("collections.export")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void runExport("csv")}>{t("collections.exportCsv")}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void runExport("json")}>{t("collections.exportJson")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="mt-[22px] flex flex-wrap items-center gap-2.5">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("collections.searchPlaceholder")}
                aria-label={t("collections.searchPlaceholder")}
                className="h-10 ps-10"
                dir="auto"
              />
            </div>
            <Select
              value={order}
              onValueChange={(v) => {
                setOrder(v as RecordOrder)
                resetToFirstPage()
              }}
            >
              <SelectTrigger className="h-10 w-[170px]" aria-label={t("collcfg.order")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">{t("collections.sortNewest")}</SelectItem>
                <SelectItem value="oldest">{t("collections.sortOldest")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="mt-3.5 flex flex-wrap items-center gap-2.5 text-[13px] text-muted-foreground">
            <label className="flex items-center gap-1.5">
              {t("collections.dateFrom")}
              <Input type="date" value={fromDay} max={toDay || undefined} onChange={(e) => setDays(e.target.value, toDay)} className="h-9 w-[150px]" dir="ltr" aria-label={t("collections.dateFrom")} />
            </label>
            <label className="flex items-center gap-1.5">
              {t("collections.dateTo")}
              <Input type="date" value={toDay} min={fromDay || undefined} onChange={(e) => setDays(fromDay, e.target.value)} className="h-9 w-[150px]" dir="ltr" aria-label={t("collections.dateTo")} />
            </label>
            <Button type="button" variant={fromDay === today && toDay === today ? "secondary" : "ghost"} size="sm" className="ms-2 h-9 text-sm" onClick={() => setDays(today, today)}>
              {t("collections.dateToday")}
            </Button>
            <Button type="button" variant={fromDay === dayOffset(-6) && toDay === today ? "secondary" : "ghost"} size="sm" className="h-9 text-sm" onClick={() => setDays(dayOffset(-6), today)}>
              {t("collections.date7")}
            </Button>
            <Button type="button" variant={fromDay === dayOffset(-29) && toDay === today ? "secondary" : "ghost"} size="sm" className="h-9 text-sm" onClick={() => setDays(dayOffset(-29), today)}>
              {t("collections.date30")}
            </Button>
            <Button type="button" variant={!fromDay && !toDay ? "secondary" : "ghost"} size="sm" className="h-9 text-sm" onClick={() => setDays("", "")}>
              {t("collections.dateAll")}
            </Button>
          </div>

          {(usageAvailable || trashAvailable) && (
            <CollectionStatusTabs
              value={tab}
              onChange={changeTab}
              counts={{ all: liveCount, used: usedCount ?? 0, notYet: liveCount - (usedCount ?? 0), trash: trashCount ?? 0 }}
              showUsage={usageAvailable}
              showTrash={trashAvailable}
            />
          )}
          {tab === "trash" && <p className="mt-2.5 text-xs text-muted-foreground">{t("collections.trashHint")}</p>}

          <div className="mb-2.5 mt-[18px] flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex flex-wrap items-baseline gap-2.5">
              <span className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">{rangeLabel}</span>
              {total !== null && <span className="text-[13px] font-semibold">{total === 1 ? t("collections.recordsCountOne") : t("collections.recordsCount", { n: total })}</span>}
              {singleDay && <span className="text-xs text-muted-foreground">{t("collections.onDay", { date: formatDate(`${singleDay}T12:00:00`) })}</span>}
            </div>
            <div className="flex items-center gap-3.5">
              {total !== null && <span className="text-xs text-muted-foreground">{t("collections.showing", { from, to, total })}</span>}
              {trashAvailable && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-pressed={selectMode}
                  className={cn("h-8 gap-1.5 text-[13px] font-semibold", selectMode && "border-[#c8237f] bg-[#c8237f] text-white hover:bg-[#e02d91] hover:text-white")}
                  onClick={toggleSelectMode}
                >
                  {selectMode ? <Check className="h-3.5 w-3.5" /> : <SquareDashed className="h-3.5 w-3.5" />}
                  {selectMode ? t("collections.selecting") : t("collections.selectMultiple")}
                </Button>
              )}
            </div>
          </div>

          {records.isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : records.error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{t("apiErr.loadCollectionRecords")}</div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center">
              <p className="mx-auto max-w-md text-sm text-muted-foreground">{emptyText}</p>
            </div>
          ) : (
            <>
              <div className="grid gap-[18px] [grid-template-columns:repeat(auto-fill,minmax(min(100%,520px),1fr))]">
                {rows.map((record, i) => (
                  <CollectionRecordCard
                    key={record.id}
                    record={record}
                    number={offset + i + 1}
                    total={total}
                    selectMode={selectMode}
                    selected={selected.has(record.id)}
                    busy={
                      busyId(removeRecord) === record.id ||
                      busyId(deleteForever) === record.id ||
                      busyId(setUsed) === record.id ||
                      busyId(restoreRecord) === record.id ||
                      (bulkBusy && selected.has(record.id))
                    }
                    onSelectToggle={() => toggleSelected(record.id)}
                    onToggleUsed={usageAvailable ? (used) => toggleUsed(record, used) : undefined}
                    onDelete={trashAvailable ? () => setPending({ kind: "trash", records: [record] }) : undefined}
                    onRestore={() => restoreOne(record)}
                    onDeleteForever={() => setPending({ kind: "forever", records: [record] })}
                  />
                ))}
              </div>
              {selectMode && (
                <CollectionBulkBar
                  selectedCount={selectedRows.length}
                  inTrash={tab === "trash"}
                  busy={bulkBusy}
                  onSelectAllPage={selectAllOnPage}
                  onClear={clearSelection}
                  onDone={toggleSelectMode}
                  onDelete={() => setPending({ kind: "trash", records: selectedRows })}
                  onRestore={restoreSelected}
                  onDeleteForever={() => setPending({ kind: "forever", records: selectedRows })}
                />
              )}
              <CollectionPagination page={page} pageCount={pageCount} pageSize={pageSize} onPage={setPage} onPageSize={changePageSize} disabled={records.isFetching} />
              {hasMedia && <p className="mt-6 text-xs text-muted-foreground">{t("collections.mediaExpiry")}</p>}
            </>
          )}
        </>
      )}

      <DeleteConfirmationDialog
        isOpen={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={confirmPending}
        title={dialogTitle}
        description={dialogBody}
        confirmLabel={pending?.kind === "forever" ? t("collections.deleteForever") : t("collections.moveToTrash")}
      />
    </div>
  )
}
