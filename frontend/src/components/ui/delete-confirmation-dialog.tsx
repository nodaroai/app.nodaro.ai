"use client"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { AlertTriangle } from "lucide-react"
import { useT } from "@/lib/i18n"

interface DeleteConfirmationDialogProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly onConfirm: () => void
  readonly title?: string
  readonly description?: string
  /** Extra classes for the dialog panel — pass STUDIO_CHILD_DIALOG_Z when the
   *  dialog is opened from inside a full-screen studio modal, else it renders
   *  behind it (stock z-50 vs the studio's z-[100]). */
  readonly className?: string
  /** Extra classes for the backdrop overlay (pair with `className`). */
  readonly overlayClassName?: string
  /**
   * Word on the confirming button. Defaults to "Delete" — pass the real verb
   * when the action is not a deletion ("Disconnect"), so the dialog does not
   * name one action in its question and a different one on its button.
   */
  readonly confirmLabel?: string
  /** A consequence the person must not miss, shown apart from the description. */
  readonly warning?: string
}

export function DeleteConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  className,
  overlayClassName,
  confirmLabel,
  warning,
}: DeleteConfirmationDialogProps) {
  const t = useT()
  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <AlertDialogContent className={className} overlayClassName={overlayClassName}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title ?? t("misc.deleteVersionTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{description ?? t("misc.deleteVersionDesc")}</AlertDialogDescription>
        </AlertDialogHeader>
        {warning && (
          <p role="alert" className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
            <span>{warning}</span>
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmLabel ?? t("common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
