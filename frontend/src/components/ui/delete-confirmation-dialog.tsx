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
}

export function DeleteConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  title = "Delete this version?",
  description = "This action cannot be undone. The generated result will be permanently removed.",
  className,
  overlayClassName,
}: DeleteConfirmationDialogProps) {
  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <AlertDialogContent className={className} overlayClassName={overlayClassName}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
