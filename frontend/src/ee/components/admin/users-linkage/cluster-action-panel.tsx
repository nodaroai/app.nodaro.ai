import { useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AccessError, useBlockUser, useRevokeFreeGrant } from "@/ee/hooks/queries/use-admin-access"
import { formatCreditUnits } from "@/lib/credit-units"
import { BLOCKS_PER_MINUTE, type LinkageCluster, type LinkageMember } from "./types"
import { blockReason, memberName, planBlock, planRevoke } from "./linkage-model"
import { ON_TIER, tierVar } from "./linkage-styles"

/**
 * One action over many accounts, made safe: block them, or take their free
 * credits back. The admin sees every account the action will touch, by
 * email; each goes through the ordinary per-account route one at a time, so
 * every one has its own audit entry.
 *
 * The member list is frozen when the panel opens: each request invalidates
 * the users query, and a cluster that re-renders mid-run must not change what
 * the admin agreed to. What the server refuses for ONE account is skipped and
 * the run goes on (a block: 403 for a protected account; a take-back: 409 for
 * a paying account, nothing left, or work running, 404 for a gone account).
 * A 429 waits the server's Retry-After out once. A take-back refused with 403
 * is the operator gate itself, so that stops the run. Anything else stops the
 * run, which then says exactly which accounts it reached. Stop ends the run
 * after the request in flight; so does leaving the page.
 */

export type ClusterAction = "block" | "revoke"

interface Progress {
  readonly done: number
  readonly total: number
  readonly waiting: boolean
}

interface Outcome {
  readonly done: readonly string[]
  readonly skipped: readonly string[]
  readonly stoppedAt: string | null
  readonly message: string | null
  readonly credits: number
}

type Attempt =
  | { kind: "done"; credits: number }
  | { kind: "skipped"; message: string }
  | { kind: "failed"; message: string }

const accounts = (n: number) => `${n} ${n === 1 ? "account" : "accounts"}`
const DEFAULT_RETRY_SECONDS = 60

/** Sleeps in one-second steps so Stop is honoured during a rate-limit wait. */
async function waitUnlessStopped(seconds: number, stopped: () => boolean): Promise<void> {
  for (let i = 0; i < seconds && !stopped(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

export function ClusterActionPanel({
  action,
  cluster,
  scopeLabel,
  members,
  blockedIds,
  viewerId,
  onRunningChange,
  onDone,
  onClose,
}: {
  readonly action: ClusterAction
  readonly cluster: LinkageCluster
  /** Names a pinned-key scope ("13 on Network 8878a1b2"); null for the whole cluster. */
  readonly scopeLabel: string | null
  readonly members: readonly LinkageMember[]
  readonly blockedIds: ReadonlySet<string>
  readonly viewerId: string
  readonly onRunningChange: (running: boolean) => void
  readonly onDone: () => void
  readonly onClose: () => void
}) {
  const blockUser = useBlockUser()
  const revoke = useRevokeFreeGrant()
  // Frozen at open — see the header.
  const [frozen] = useState(() => members)
  const [reason, setReason] = useState(() => blockReason(cluster))
  const [progress, setProgress] = useState<Progress | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const stopRef = useRef(false)

  // Unmount only: the run must stop when the panel goes away.
  useEffect(() => {
    return () => {
      stopRef.current = true
      onRunningChange(false)
    }
  }, [])

  const blockPlan = action === "block" ? planBlock(frozen, blockedIds, viewerId) : null
  const revokePlan = action === "revoke" ? planRevoke(frozen) : null
  const targets = blockPlan?.targets ?? revokePlan?.targets ?? []
  const verb = action === "block" ? "Block" : "Take back the free credits of"

  const attempt = async (member: LinkageMember, text: string | undefined): Promise<Attempt> => {
    for (let tries = 0; tries < 2; tries++) {
      try {
        if (action === "block") {
          await blockUser.mutateAsync({ userId: member.userId, reason: text })
          return { kind: "done", credits: 0 }
        }
        const out = await revoke.mutateAsync({ userId: member.userId })
        return { kind: "done", credits: out.credits ?? 0 }
      } catch (err) {
        const message = err instanceof Error ? err.message : "The request failed"
        const status = err instanceof AccessError ? err.status : null
        if (status === 429 && tries === 0) {
          setProgress((p) => (p ? { ...p, waiting: true } : p))
          await waitUnlessStopped((err as AccessError).retryAfterSeconds ?? DEFAULT_RETRY_SECONDS, () => stopRef.current)
          setProgress((p) => (p ? { ...p, waiting: false } : p))
          if (stopRef.current) return { kind: "failed", message: "Stopped." }
          continue
        }
        if (action === "block" && status === 403) return { kind: "skipped", message }
        if (action === "revoke" && (status === 409 || status === 404)) return { kind: "skipped", message }
        return { kind: "failed", message }
      }
    }
    return { kind: "failed", message: "The server is still rate-limiting." }
  }

  const run = async () => {
    const queue = targets
    const text = reason.trim() || undefined
    stopRef.current = false
    onRunningChange(true)
    setOutcome(null)
    setProgress({ done: 0, total: queue.length, waiting: false })

    let done: readonly string[] = []
    let skipped: readonly string[] = []
    let credits = 0
    let stoppedAt: string | null = null
    let message: string | null = null
    for (const member of queue) {
      if (stopRef.current) {
        message = "Stopped."
        break
      }
      const result = await attempt(member, text)
      if (result.kind === "done") {
        done = [...done, memberName(member)]
        credits += result.credits
      } else if (result.kind === "skipped") {
        skipped = [...skipped, `${memberName(member)} (${result.message})`]
      } else {
        stoppedAt = memberName(member)
        message = result.message
        break
      }
      setProgress({ done: done.length + skipped.length, total: queue.length, waiting: false })
    }

    setOutcome({ done, skipped, stoppedAt, message, credits })
    setProgress(null)
    onRunningChange(false)
    if (!stoppedAt && !message) toast.success(summaryOf(action, done.length, credits))
    onDone()
  }

  const running = progress !== null

  return (
    <div data-testid="cluster-action-panel" className="order-3 basis-full space-y-2 rounded-lg border bg-background p-3">
      <div className="text-sm font-semibold">
        {verb} {accounts(targets.length)} in cluster #{cluster.id}
        {scopeLabel && <span className="font-normal text-muted-foreground"> — {scopeLabel}</span>}
      </div>
      {blockPlan && blockPlan.alreadyBlocked > 0 && (
        <p className="text-xs text-muted-foreground">{blockPlan.alreadyBlocked} already blocked — skipped.</p>
      )}
      {blockPlan && blockPlan.admins > 0 && (
        <p className="text-xs text-muted-foreground">
          {blockPlan.admins === 1 ? "1 admin account skipped" : `${blockPlan.admins} admin accounts skipped`} — the block route refuses them.
        </p>
      )}
      {revokePlan && revokePlan.nothingToTakeBack > 0 && (
        <p className="text-xs text-muted-foreground">
          {revokePlan.nothingToTakeBack} with nothing to take back (never claimed, or already taken) — skipped.
        </p>
      )}
      {!scopeLabel && cluster.unresolved > 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {cluster.unresolved} {cluster.unresolved === 1 ? "member" : "members"} of this cluster could not be listed and will not be touched.
        </p>
      )}
      <ul className="max-h-40 overflow-y-auto rounded border bg-card px-3 py-2 font-mono text-xs">
        {targets.map((member) => (
          <li key={member.userId}>{memberName(member)}</li>
        ))}
      </ul>
      {action === "block" && (
        <Input
          aria-label="Block reason"
          value={reason}
          maxLength={500}
          disabled={running || outcome !== null}
          onChange={(e) => setReason(e.target.value)}
        />
      )}
      <p className="text-xs text-muted-foreground">
        {action === "block"
          ? "Each account is blocked on its own, with this reason, one after another. An account the server refuses is skipped; any other failure stops the run there, and the ones before it stay blocked."
          : "What is left of each account's free credits is taken back on its own, one after another — the same take-back as the Access panel's button, never purchased top-ups. A paying account, one with work running, or one with nothing left is refused by the server and skipped; any other failure stops the run."}
        {action === "block" &&
          targets.length > BLOCKS_PER_MINUTE &&
          ` The server allows ${BLOCKS_PER_MINUTE} blocks a minute, so this run will pause and resume.`}
      </p>
      {progress && (
        <p className="text-xs" aria-live="polite">
          {progress.waiting ? "Waiting for the rate limit…" : `${action === "block" ? "Blocking" : "Taking back"} ${progress.done} / ${progress.total}…`}
        </p>
      )}
      {outcome && (
        <div className="space-y-1 text-xs" aria-live="polite">
          {outcome.stoppedAt ? (
            <p className="text-destructive">
              Stopped at {outcome.stoppedAt}: {outcome.message}. {summaryOf(action, outcome.done.length, outcome.credits)}
            </p>
          ) : outcome.message ? (
            <p>
              {outcome.message} {summaryOf(action, outcome.done.length, outcome.credits)}
            </p>
          ) : (
            <p className="text-green-700 dark:text-green-400">{summaryOf(action, outcome.done.length, outcome.credits)}</p>
          )}
          {outcome.skipped.map((line) => (
            <p key={line} className="text-muted-foreground">
              Skipped {line}
            </p>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        {!outcome && (
          <Button
            size="sm"
            style={{ background: tierVar(cluster.tier, "color"), color: ON_TIER }}
            disabled={running || targets.length === 0}
            onClick={run}
          >
            {running && <Loader2 className="me-1 h-3 w-3 animate-spin" />}
            {action === "block" ? `Block ${accounts(targets.length)}` : `Take back from ${accounts(targets.length)}`}
          </Button>
        )}
        {running ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              stopRef.current = true
            }}
          >
            Stop
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={onClose}>
            {outcome ? "Close" : "Cancel"}
          </Button>
        )}
      </div>
    </div>
  )
}

/** The figure goes through the credit-unit seam like every other figure the admin sees. */
function summaryOf(action: ClusterAction, count: number, credits: number): string {
  if (action === "block") return `Blocked ${accounts(count)}.`
  return `Took back ${formatCreditUnits(credits, { localized: true })} from ${accounts(count)}.`
}
