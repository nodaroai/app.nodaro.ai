import { useState } from "react"
import { Loader2, ShieldBan } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { useBlockGalleryCreatorsMutation } from "@/hooks/queries/use-gallery-admin-queries"
import type { GalleryItem } from "@/hooks/queries/use-gallery-queries"
import { useT, tx } from "@/lib/i18n"

/** In the preview, for admins: block whoever made this item from the gallery. */
export function GalleryBlockCreatorButton({ item, onBlocked }: { readonly item: GalleryItem; readonly onBlocked: () => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const mutation = useBlockGalleryCreatorsMutation()

  async function block() {
    try {
      await mutation.mutateAsync({ itemIds: [item.id] })
      toast.success(tx("gallery.creatorBlocked"))
      setOpen(false)
      onBlocked()
    } catch {
      toast.error(tx("gallery.blockFailed"))
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-red-300 dark:border-red-800 px-2.5 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
        title={t("gallery.blockCreator")}
      >
        <ShieldBan className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{t("gallery.blockCreator")}</span>
      </button>
      <Dialog open={open} onOpenChange={(next) => !mutation.isPending && setOpen(next)}>
        <DialogContent className="sm:max-w-sm">
          <DialogTitle>{t("gallery.blockTitleOne")}</DialogTitle>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("gallery.blockDesc")}</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={mutation.isPending}>
                {t("common.cancel")}
              </Button>
              <Button size="sm" onClick={block} disabled={mutation.isPending} className="bg-red-600 hover:bg-red-700 text-white">
                {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("gallery.blockCreator")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
