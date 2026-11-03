import { Loader2, PauseCircle, TriangleAlert } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useSyncSignIn, type AdminUserAccess } from "@/ee/hooks/queries/use-admin-access"
import { formatBlockDate } from "./block-format"
import { signInLag, type SignInLag } from "./sign-in-lag"

const LAG_WORDS: Readonly<Record<SignInLag, { readonly says: string; readonly cta: string }>> = {
  allow: { says: "Sign-in is still refused by an earlier block or suspension.", cta: "Allow sign-in" },
  refuse: { says: "Sign-in is not refused yet.", cta: "Refuse sign-in" },
  correct: { says: "Sign-in is refused, but not until the end the block or the suspension sets.", cta: "Correct sign-in" },
}

/**
 * The account's suspension under the repeat-infringer policy, with its end
 * (taken and lifted from its complaint), and, where sign-in disagrees with the
 * block and the suspension, the one button that brings it in line (it moves
 * nothing else).
 */
export function SuspensionAccess({ userId, access, onChanged }: { readonly userId: string; readonly access: AdminUserAccess; readonly onChanged: () => void }) {
  const syncSignIn = useSyncSignIn()
  const suspendedUntil = access.suspendedUntil ?? null
  const lag = signInLag(access)

  const doSyncSignIn = async () => {
    try {
      const out = await syncSignIn.mutateAsync({ userId })
      toast.success(out.signInBlocked ? "Sign-in refused" : "Sign-in allowed")
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to bring the account's sign-in in line")
    }
  }

  return (
    <>
      {suspendedUntil && (
        <p className="flex items-start gap-1 text-xs">
          <PauseCircle className="mt-0.5 h-3 w-3 shrink-0" />
          Suspended until {formatBlockDate(suspendedUntil)} under the repeat-infringer policy: sign-in and every request are refused until then. Lift it from its complaint.
        </p>
      )}
      {lag && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
          <TriangleAlert className="h-3 w-3" />
          {LAG_WORDS[lag].says}
          <Button size="sm" variant="outline" disabled={syncSignIn.isPending} onClick={doSyncSignIn}>
            {syncSignIn.isPending && <Loader2 className="me-1 h-3 w-3 animate-spin" />}
            {LAG_WORDS[lag].cta}
          </Button>
        </div>
      )}
    </>
  )
}
