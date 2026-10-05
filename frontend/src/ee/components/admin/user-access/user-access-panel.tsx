import { useState } from "react"
import { Ban, Loader2, Network, ShieldCheck, TriangleAlert } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { AdminUser } from "@/ee/hooks/queries/use-admin-queries"
import {
  useAdminUserAccess,
  useBlockNetwork,
  useBlockUser,
  useRevokeFreeGrant,
  useUnblockUser,
  type BlockDays,
} from "@/ee/hooks/queries/use-admin-access"
import { FreeGrantActions } from "./free-grant-actions"
import { BLOCK_DAYS, DEFAULT_BLOCK_DAYS, blockDaysLabel, formatBlockDate } from "./block-format"

const GRANT_STATE_LABEL: Record<string, string> = {
  unclaimed: "Not claimed yet",
  granted: "Given",
  withheld: "Withheld (abuse check)",
  revoked: "Taken back by an admin",
}

/**
 * The Access card in a user's expanded row: block / unblock the account, take
 * back / restore its free credits, and block the network it signed up from.
 *
 * Every refusal comes from the server with its own sentence (admins and the
 * owner cannot be blocked, a busy network needs a super admin, …) and is shown
 * as is — this panel decides nothing the server would not.
 */
export function UserAccessPanel({
  user,
  isSuperAdmin,
  showFreeCredits,
  onChanged,
}: {
  readonly user: AdminUser
  readonly isSuperAdmin: boolean
  /** False where free signup credits do not exist (no credits, or one account pays for everyone). */
  readonly showFreeCredits: boolean
  readonly onChanged: () => void
}) {
  const { data: access, isLoading, isError, refetch } = useAdminUserAccess(user.id)
  const blockUser = useBlockUser()
  const unblockUser = useUnblockUser()
  const revoke = useRevokeFreeGrant()
  const blockNetwork = useBlockNetwork()

  const [composing, setComposing] = useState(false)
  const [reason, setReason] = useState("")
  const grantState = user.free_grant_state ?? null
  const canTakeBack = showFreeCredits && (grantState === "granted" || grantState === "withheld")
  const [alsoTakeBack, setAlsoTakeBack] = useState(true)
  const [days, setDays] = useState<BlockDays>(DEFAULT_BLOCK_DAYS)
  const paidPlan = (user.subscription_tier ?? "free") !== "free"

  const doBlock = async () => {
    try {
      const out = await blockUser.mutateAsync({ userId: user.id, reason: reason.trim() || undefined })
      if (out.warning) toast.warning(out.warning)
      else toast.success("Account blocked")
      // A second request, to the operator-gated route: blocking itself never moves money.
      if (alsoTakeBack && canTakeBack) {
        try {
          const back = await revoke.mutateAsync({ userId: user.id })
          toast.success(back.credits ? `Took back ${back.credits.toLocaleString()} free credits` : "Free credits taken back")
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Failed to take back the free credits")
        }
      }
      setComposing(false)
      setReason("")
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to block the account")
    }
  }

  // "Block again": the row is there and only the sign-in step failed. It sends
  // the same request (the server keeps the original reason and admin) and
  // never takes credits back — that is the composer's choice, made once.
  const doRepair = async () => {
    try {
      const out = await blockUser.mutateAsync({ userId: user.id, reason: access?.reason ?? undefined })
      if (out.warning) toast.warning(out.warning)
      else toast.success("Sign-in blocked")
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to block the account")
    }
  }

  const doUnblock = async () => {
    try {
      const out = await unblockUser.mutateAsync({ userId: user.id })
      if (out.warning) toast.warning(out.warning)
      else toast.success("Account unblocked")
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to unblock the account")
    }
  }

  const doBlockNetwork = async () => {
    try {
      const out = await blockNetwork.mutateAsync({ userId: user.id, days })
      toast.success(`Network blocked until ${formatBlockDate(out.expiresAt)}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to block the network")
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-card p-3 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading access…
      </div>
    )
  }

  // Unknown is not "Active": a blocked account must never look open, and no
  // action is offered on a state nobody could read.
  if (isError || !access) {
    return (
      <div className="space-y-2 rounded-lg border bg-card p-3 text-xs">
        <div className="flex items-center gap-2 text-sm font-medium">
          <TriangleAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          Access
        </div>
        <p className="text-muted-foreground">Could not read whether this account is blocked.</p>
        <Button size="sm" variant="outline" onClick={() => void refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  const network = access.network
  const notReady = !access.ready

  return (
    <div className="space-y-3 rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          {access.blocked ? <Ban className="h-4 w-4 text-destructive" /> : <ShieldCheck className="h-4 w-4" />}
          Access
        </div>
        {access.blocked ? <Badge variant="destructive">Blocked</Badge> : <Badge variant="secondary">Active</Badge>}
      </div>

      {notReady && (
        <p className="text-xs text-muted-foreground">Blocking becomes available after the next production release.</p>
      )}

      {/* Account block */}
      {access.blocked ? (
        <div className="space-y-2 text-xs">
          <p>
            Blocked since {formatBlockDate(access.blockedAt)}
            {access.reason ? ` — ${access.reason}` : ""}
          </p>
          {access.signInBlocked === false && (
            <p className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
              <TriangleAlert className="h-3 w-3" /> Sign-in is not blocked yet. Press Block again to retry.
            </p>
          )}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={unblockUser.isPending} onClick={doUnblock}>
              {unblockUser.isPending && <Loader2 className="me-1 h-3 w-3 animate-spin" />}
              Unblock
            </Button>
            {access.signInBlocked === false && (
              <Button size="sm" variant="destructive" disabled={blockUser.isPending || notReady} onClick={doRepair}>
                Block again
              </Button>
            )}
          </div>
        </div>
      ) : composing ? (
        <div className="space-y-2">
          <Input
            placeholder="Reason (optional, for other admins)"
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
          />
          {canTakeBack && (
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={alsoTakeBack} onCheckedChange={(v) => setAlsoTakeBack(v === true)} />
              Also take back the free credits
            </label>
          )}
          {paidPlan && (
            <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
              <TriangleAlert className="h-3 w-3" /> This account has a paid plan. Blocking does not cancel its subscription.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            The person cannot sign in or use anything, their scheduled runs stop and their published apps stop running.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" disabled={blockUser.isPending || notReady} onClick={doBlock}>
              {blockUser.isPending && <Loader2 className="me-1 h-3 w-3 animate-spin" />}
              Block account
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setComposing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" disabled={notReady} onClick={() => setComposing(true)}>
          <Ban className="me-1 h-3 w-3" />
          Block account…
        </Button>
      )}

      {/* Free credits */}
      {showFreeCredits && (
        <div className="space-y-2 border-t pt-3">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Free credits</span>
            <span className="font-medium">{grantState ? (GRANT_STATE_LABEL[grantState] ?? grantState) : "—"}</span>
          </div>
          <FreeGrantActions userId={user.id} state={grantState} onChanged={onChanged} />
        </div>
      )}

      {/* Signup network */}
      <div className="space-y-2 border-t pt-3 text-xs">
        <div className="flex items-center gap-2 font-medium">
          <Network className="h-3 w-3" /> Signup network
        </div>
        {!network ? (
          <p className="text-muted-foreground">No signup network recorded.</p>
        ) : (
          <>
            <div className="flex justify-between">
              <span className="font-mono">{network.token ?? "—"}</span>
              {network.blocked && <Badge variant="destructive">Blocked</Badge>}
            </div>
            <p className="text-muted-foreground">
              Signed up {formatBlockDate(network.signupAt)} · {network.otherAccounts.toLocaleString()} other account
              {network.otherAccounts === 1 ? "" : "s"} signed up from it
              {network.payingAccounts > 0 ? ` (${network.payingAccounts} paying)` : ""}
            </p>
            {!network.blockable ? (
              <p className="text-muted-foreground">
                Recorded before real addresses were read, or the address was unknown — it cannot be blocked.
              </p>
            ) : network.blocked ? null : network.needsSuperAdmin && !isSuperAdmin ? (
              <p className="text-amber-600 dark:text-amber-400">
                Many accounts or a paying account signed up here — only a super admin can block this network.
              </p>
            ) : (
              <div className="flex items-center gap-2">
                <Select value={String(days)} onValueChange={(v) => setDays(Number(v) as BlockDays)}>
                  <SelectTrigger className="h-8 w-[110px]" aria-label="Block duration">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" className="z-[9999]">
                    {BLOCK_DAYS.map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {blockDaysLabel(d)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" disabled={blockNetwork.isPending || notReady} onClick={doBlockNetwork}>
                  {blockNetwork.isPending && <Loader2 className="me-1 h-3 w-3 animate-spin" />}
                  Block network
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
