import { Trash2, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * The sticky bar of select mode: how many are selected, select-all-on-page,
 * clear, Done, and the one bulk action of the list — Delete (to the Trash)
 * on a live list, Restore on the Trash.
 */
export function CollectionBulkBar({
  selectedCount,
  inTrash,
  busy,
  onSelectAllPage,
  onClear,
  onDone,
  onDelete,
  onRestore,
  onDeleteForever,
}: {
  readonly selectedCount: number
  readonly inTrash: boolean
  readonly busy?: boolean
  readonly onSelectAllPage: () => void
  readonly onClear: () => void
  readonly onDone: () => void
  readonly onDelete: () => void
  readonly onRestore: () => void
  readonly onDeleteForever: () => void
}) {
  const t = useT()
  const none = selectedCount === 0
  const linkClass = "text-[13px] text-muted-foreground underline underline-offset-[3px] hover:text-foreground"
  return (
    <div className="sticky bottom-4 mt-5 flex flex-wrap items-center gap-3.5 rounded-xl border bg-card px-4 py-3 text-sm shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
      <span className="font-semibold">{selectedCount === 1 ? t("collections.selectedCountOne") : t("collections.selectedCount", { n: selectedCount })}</span>
      <button type="button" className={linkClass} onClick={onSelectAllPage}>
        {t("collections.selectAllPage")}
      </button>
      <button type="button" className={linkClass} onClick={onClear}>
        {t("collections.clearSelection")}
      </button>
      <div className="ms-auto flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" className="h-9" onClick={onDone}>
          {t("common.done")}
        </Button>
        {inTrash ? (
          <>
            <Button
              type="button"
              size="sm"
              className={cn(
                "h-9 gap-1.5 border font-bold",
                "border-[#bcd7ee] bg-[#e7f1fb] text-[#1f6fa8] hover:bg-[#d7e8f7] dark:border-[#27486a] dark:bg-[#1a2a3a] dark:text-[#7cc4f0] dark:hover:bg-[#23384d] dark:hover:text-white",
                none && "opacity-45",
              )}
              disabled={none || busy}
              onClick={onRestore}
            >
              <Undo2 className="h-4 w-4" />
              {t("collections.restoreSelected", { n: selectedCount })}
            </Button>
            <Button type="button" size="sm" className={cn("h-9 gap-1.5 bg-[#d9343c] font-bold text-white hover:bg-[#ef4a52]", none && "opacity-45")} disabled={none || busy} onClick={onDeleteForever}>
              <Trash2 className="h-4 w-4" />
              {t("collections.deleteForeverSelected", { n: selectedCount })}
            </Button>
          </>
        ) : (
          <Button type="button" size="sm" className={cn("h-9 gap-1.5 bg-[#d9343c] font-bold text-white hover:bg-[#ef4a52]", none && "opacity-45")} disabled={none || busy} onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
            {t("collections.deleteSelected", { n: selectedCount })}
          </Button>
        )}
      </div>
    </div>
  )
}
