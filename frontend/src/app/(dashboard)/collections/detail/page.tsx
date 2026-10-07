import { useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { ArrowLeft, Download, Loader2, Search } from "lucide-react"
import { toast } from "sonner"
import type { CollectionExportFormat, CollectionRecord } from "@nodaro/shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { CollectionCapMeter } from "@/components/collections/collection-cap-meter"
import { CollectionRecordCard } from "@/components/collections/collection-record-card"
import { useCollection, useCollectionMutations, useCollectionRecords, useCollections } from "@/hooks/queries/use-collections-queries"
import { exportCollection, isNotFoundError } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import { cn } from "@/lib/utils"

const SEARCH_DELAY_MS = 300

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

/**
 * One collection's records, newest first: search them, open their links,
 * delete one, export them all as CSV or JSON.
 */
export default function CollectionDetailPage() {
  const t = useT()
  const isRtl = useAppDir() === "rtl"
  const { id } = useParams<{ id: string }>()
  const collection = useCollection(id)
  const list = useCollections()
  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  const [removing, setRemoving] = useState<CollectionRecord | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [search])

  const records = useCollectionRecords(id, { q: q || undefined })
  const { removeRecord } = useCollectionMutations()
  const rows = useMemo(() => records.data?.pages.flatMap((page) => page.data) ?? [], [records.data])
  const caps = list.data?.caps ?? { collections: null, records: null }
  const hasMedia = rows.some((r) => r.media.length > 0)

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

  const confirmRemove = (record: CollectionRecord) => {
    if (!id) return
    removeRecord.mutate(
      { id, recordId: record.id },
      {
        onSuccess: () => toast.success(t("collections.recordDeleted")),
        onError: (err) => toast.error(err instanceof Error ? err.message : t("apiErr.deleteCollectionRecord")),
      },
    )
  }

  return (
    <div className="container mx-auto max-w-4xl p-6">
      <Link to="/collections" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
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
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold" dir="auto">
                {collection.data.name}
              </h1>
              {collection.data.description && (
                <p className="mt-1 text-sm text-muted-foreground" dir="auto">
                  {collection.data.description}
                </p>
              )}
              <CollectionCapMeter count={collection.data.recordCount} cap={caps.records} className="mt-3 max-w-xs" />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={exporting || collection.data.recordCount === 0}>
                  {exporting ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : <Download className="me-1.5 h-4 w-4" />}
                  {t("collections.export")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void runExport("csv")}>{t("collections.exportCsv")}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void runExport("json")}>{t("collections.exportJson")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="relative mb-4 max-w-md">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("collections.searchPlaceholder")}
              aria-label={t("collections.searchPlaceholder")}
              className="ps-9"
              dir="auto"
            />
          </div>

          {records.isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : records.error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{t("apiErr.loadCollectionRecords")}</div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center">
              <p className="mx-auto max-w-md text-sm text-muted-foreground">{q ? t("collections.noMatches") : t("collections.noRecords")}</p>
            </div>
          ) : (
            <>
              <ul className="space-y-2">
                {rows.map((record) => (
                  <li key={record.id}>
                    <CollectionRecordCard
                      record={record}
                      busy={removeRecord.isPending && removeRecord.variables?.recordId === record.id}
                      onDelete={() => setRemoving(record)}
                    />
                  </li>
                ))}
              </ul>
              {records.hasNextPage && (
                <div className="mt-6 flex justify-center">
                  <Button variant="outline" onClick={() => void records.fetchNextPage()} disabled={records.isFetchingNextPage}>
                    {records.isFetchingNextPage && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                    {t("collections.loadMore")}
                  </Button>
                </div>
              )}
              {hasMedia && <p className="mt-6 text-xs text-muted-foreground">{t("collections.mediaExpiry")}</p>}
            </>
          )}
        </>
      )}

      <DeleteConfirmationDialog
        isOpen={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) confirmRemove(removing)
        }}
        title={t("collections.deleteRecordTitle")}
        description={t("collections.deleteRecordDesc")}
        confirmLabel={t("common.delete")}
      />
    </div>
  )
}
