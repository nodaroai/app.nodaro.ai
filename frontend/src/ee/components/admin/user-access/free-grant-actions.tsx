import { useState } from "react"
import { Loader2, RotateCcw, Undo2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
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
import { useRestoreFreeGrant, useRevokeFreeGrant } from "@/ee/hooks/queries/use-admin-access"

/**
 * Take back / restore an account's free signup credits — ONE component for
 * the user panel and the free-grants table, so the two never disagree.
 *
 * Shown for the states where it can act: granted or withheld → Take back;
 * revoked → Restore. The server is the judge (a paid account, or one with work
 * still running, is refused with a sentence that is shown as is).
 */
export function FreeGrantActions({
  userId,
  state,
  size = "sm",
  onChanged,
}: {
  readonly userId: string
  readonly state: string | null | undefined
  readonly size?: "sm" | "xs"
  readonly onChanged?: () => void
}) {
  const [confirming, setConfirming] = useState<"revoke" | "restore" | null>(null)
  const revoke = useRevokeFreeGrant()
  const restore = useRestoreFreeGrant()
  const busy = revoke.isPending || restore.isPending

  const canRevoke = state === "granted" || state === "withheld"
  const canRestore = state === "revoked"
  if (!canRevoke && !canRestore) return null

  const run = async () => {
    const action = confirming
    setConfirming(null)
    try {
      if (action === "revoke") {
        const out = await revoke.mutateAsync({ userId })
        toast.success(out.credits ? `Took back ${out.credits.toLocaleString()} free credits` : "Free credits taken back")
      } else if (action === "restore") {
        const out = await restore.mutateAsync({ userId })
        toast.success(out.credits ? `Restored ${out.credits.toLocaleString()} free credits` : "Free credits restored")
      }
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    }
  }

  const buttonClass = size === "xs" ? "h-7 px-2 text-xs" : undefined

  return (
    <>
      {canRevoke ? (
        <Button
          variant="outline"
          size="sm"
          className={buttonClass}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation()
            setConfirming("revoke")
          }}
        >
          {revoke.isPending ? <Loader2 className="me-1 h-3 w-3 animate-spin" /> : <Undo2 className="me-1 h-3 w-3" />}
          Take back free credits
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className={buttonClass}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation()
            setConfirming("restore")
          }}
        >
          {restore.isPending ? <Loader2 className="me-1 h-3 w-3 animate-spin" /> : <RotateCcw className="me-1 h-3 w-3" />}
          Restore free credits
        </Button>
      )}

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirming === "revoke" ? "Take back the free credits?" : "Restore the free credits?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirming === "revoke"
                ? "What is left of this account's free signup credits will be removed. Credits it bought are not touched, and it cannot get the free credits back by itself."
                : "Exactly the credits that were taken back will be returned to this account."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={run}>{confirming === "revoke" ? "Take back" : "Restore"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
