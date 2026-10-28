import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { STUDIO_CHILD_DIALOG_Z } from "@/components/editor/studio-shell/studio-modal-z"
import type { KeeperKind } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { ShelfFields } from "./shelf-fields"
import { useKeeperShelfState } from "./use-keeper-shelf-state"

export interface KeeperShelfDialogProps {
  kind: KeeperKind
  /** The item's row id — the dialog reads and writes that row. */
  entityId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * The admin's Nodaro Keepers dialog, opened from a studio header: shows
 * whether this item is on the shared shelf, with its heading and order, and
 * saves a change through `PUT` on the kind's catalog route. The state comes
 * from the item's own read on every open (`useKeeperShelfState`), so a change
 * made elsewhere (the SDK, the API) shows here too.
 */
export function KeeperShelfDialog({ kind, entityId, open, onOpenChange }: KeeperShelfDialogProps) {
  const t = useT()
  const form = useKeeperShelfState(kind, entityId, open)

  const handleSave = async () => {
    if (await form.submit()) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Opened from inside a studio (an opaque overlay at STUDIO_MODAL_Z): both the
          content and the backdrop must sit on the studio-child tier or the dialog
          renders behind the studio and the button looks dead. */}
      <DialogContent className={`sm:max-w-md ${STUDIO_CHILD_DIALOG_Z}`} overlayClassName={STUDIO_CHILD_DIALOG_Z}>
        <DialogHeader>
          <DialogTitle>{t("keepers.dialogTitle")}</DialogTitle>
          <DialogDescription>{t("keepers.dialogDesc")}</DialogDescription>
        </DialogHeader>

        <ShelfFields form={form} />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={form.submitting}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={!form.canSubmit}>
            {form.submitting ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default KeeperShelfDialog
