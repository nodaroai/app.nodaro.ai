import { useState } from "react"
import { CheckSquare, Loader2, ShieldBan, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { useBlockGalleryCreatorsMutation, useBulkRemoveGalleryItemsMutation } from "@/hooks/queries/use-gallery-admin-queries"
import { useT, tx } from "@/lib/i18n"

/** The admin's "Select" switch, beside the gallery filters. */
export function GallerySelectButton({ selecting, onToggle }: { readonly selecting: boolean; readonly onToggle: () => void }) {
  const t = useT()
  return (
    <Button variant={selecting ? "default" : "outline"} size="sm" onClick={onToggle} className="rounded-full">
      {selecting ? <X className="h-3.5 w-3.5 me-1" /> : <CheckSquare className="h-3.5 w-3.5 me-1" />}
      {selecting ? t("gallery.selectDone") : t("gallery.select")}
    </Button>
  )
}

interface GallerySelectionBarProps {
  readonly selectedIds: ReadonlySet<string>
  readonly shownCount: number
  /** Blocking creators lives in the admin panel's moderation lists — editions without one have no such lever. */
  readonly canBlock: boolean
  readonly onSelectAllShown: () => void
  readonly onClear: () => void
  /** After a removal or a block: the selected items are gone. */
  readonly onDone: () => void
}

type Confirm = "remove" | "block" | null

/**
 * What an admin can do with the selected items: take them out of the gallery,
 * or block whoever made them. Each asks once before it acts.
 */
export function GallerySelectionBar({ selectedIds, shownCount, canBlock, onSelectAllShown, onClear, onDone }: GallerySelectionBarProps) {
  const t = useT()
  const [confirm, setConfirm] = useState<Confirm>(null)
  const removeMutation = useBulkRemoveGalleryItemsMutation()
  const blockMutation = useBlockGalleryCreatorsMutation()
  const count = selectedIds.size
  const busy = removeMutation.isPending || blockMutation.isPending

  async function run() {
    const itemIds = [...selectedIds]
    try {
      if (confirm === "remove") {
        const { removed } = await removeMutation.mutateAsync({ itemIds })
        toast.success(tx("gallery.bulkRemoved", { n: removed }))
      } else if (confirm === "block") {
        const { blocked } = await blockMutation.mutateAsync({ itemIds })
        toast.success(tx("gallery.creatorsBlocked", { n: blocked }))
      }
      setConfirm(null)
      onDone()
    } catch {
      toast.error(confirm === "block" ? tx("gallery.blockFailed") : tx("gallery.bulkRemoveFailed"))
    }
  }

  return (
    <>
      <div className="fixed bottom-4 inset-x-0 z-40 flex justify-center px-4 pointer-events-none">
        <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-full border border-zinc-200 dark:border-zinc-800 bg-card/95 backdrop-blur px-4 py-2 shadow-lg">
          <span className="text-sm font-medium tabular-nums">{t("gallery.selectedCount", { n: count })}</span>
          {count < shownCount ? (
            <Button variant="ghost" size="sm" onClick={onSelectAllShown}>
              {t("gallery.selectAllShown")}
            </Button>
          ) : null}
          {count > 0 && (
            <Button variant="ghost" size="sm" onClick={onClear}>
              {t("gallery.clearSelection")}
            </Button>
          )}
          {canBlock && (
            <Button variant="outline" size="sm" disabled={count === 0 || busy} onClick={() => setConfirm("block")}>
              <ShieldBan className="h-3.5 w-3.5 me-1" />
              {t("gallery.blockCreators")}
            </Button>
          )}
          <Button size="sm" disabled={count === 0 || busy} onClick={() => setConfirm("remove")} className="bg-red-600 hover:bg-red-700 text-white">
            <Trash2 className="h-3.5 w-3.5 me-1" />
            {t("gallery.removeSelected")}
          </Button>
        </div>
      </div>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && !busy && setConfirm(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogTitle>
            {confirm === "block" ? t("gallery.blockTitle", { n: count }) : t("gallery.bulkRemoveTitle", { n: count })}
          </DialogTitle>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {confirm === "block" ? t("gallery.blockDesc") : t("gallery.bulkRemoveDesc")}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirm(null)} disabled={busy}>
                {t("common.cancel")}
              </Button>
              <Button size="sm" onClick={run} disabled={busy} className="bg-red-600 hover:bg-red-700 text-white">
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : confirm === "block" ? (
                  t("gallery.blockCreators")
                ) : (
                  t("common.remove")
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
