import { useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AccessError, useBlockUser } from "@/ee/hooks/queries/use-admin-access"
import { BLOCKS_PER_MINUTE, type LinkageCluster, type LinkageMember } from "./types"
import { blockReason, memberName, planBlock } from "./linkage-model"
import { ON_TIER, tierVar } from "./linkage-styles"

/**
 * Blocking a whole cluster, made safe: the admin sees every account that will
 * be blocked, by email, and the reason each block row will carry (which
 * cluster, how big, joined by what). The blocks go one at a time through the
 * ordinary per-account route, so every one has its own audit entry.
 *
 * The member list is frozen when the panel opens: each block invalidates the
 * users query, and a cluster that re-renders mid-run must not change what the
 * admin agreed to. Admins and the viewer are left out up front (the route
 * refuses them); a 403 for anyone else is skipped and the run goes on; a 429
 * waits the server's Retry-After out once; anything else stops the run, which
 * then says exactly which accounts are blocked. Stop ends the run after the
 * request in flight; so does leaving the page.
 */

interface Progress {
  readonly done: number
  readonly total: number
  readonly waiting: boolean
}

interface Outcome {
  readonly blocked: readonly string[]
  readonly skipped: readonly string[]
  readonly stoppedAt: string | null
  readonly message: string | null
}

type Attempt = { kind: "blocked" } | { kind: "skipped"; message: string } | { kind: "failed"; message: string }

const accounts = (n: number) => `${n} ${n === 1 ? "account" : "accounts"}`
const DEFAULT_RETRY_SECONDS = 60

/** Sleeps in one-second steps so Stop is honoured during a rate-limit wait. */
async function waitUnlessStopped(seconds: number, stopped: () => boolean): Promise<void> {
  for (let i = 0; i < seconds && !stopped(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

export function BlockClusterPanel({
  cluster,
  members,
  blockedIds,
  viewerId,
  onRunningChange,
  onDone,
  onClose,
}: {
  readonly cluster: LinkageCluster
  readonly members: readonly LinkageMember[]
  readonly blockedIds: ReadonlySet<string>
  readonly viewerId: string
  readonly onRunningChange: (running: boolean) => void
  readonly onDone: () => void
  readonly onClose: () => void
}) {
  const blockUser = useBlockUser()
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

  const plan = planBlock(frozen, blockedIds, viewerId)

  const attempt = async (member: LinkageMember, text: string | undefined): Promise<Attempt> => {
    for (let tries = 0; tries < 2; tries++) {
      try {
        await blockUser.mutateAsync({ userId: member.userId, reason: text })
        return { kind: "blocked" }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to block the account"
        const status = err instanceof AccessError ? err.status : null
        if (status === 403) return { kind: "skipped", message }
        if (status === 429 && tries === 0) {
          setProgress((p) => (p ? { ...p, waiting: true } : p))
          await waitUnlessStopped((err as AccessError).retryAfterSeconds ?? DEFAULT_RETRY_SECONDS, () => stopRef.current)
          setProgress((p) => (p ? { ...p, waiting: false } : p))
          if (stopRef.current) return { kind: "failed", message: "Stopped." }
          continue
        }
        return { kind: "failed", message }
      }
    }
    return { kind: "failed", message: "The server is still rate-limiting blocks." }
  }

  const run = async () => {
    const queue = plan.targets
    const text = reason.trim() || undefined
    stopRef.current = false
    onRunningChange(true)
    setOutcome(null)
    setProgress({ done: 0, total: queue.length, waiting: false })

    let blocked: readonly string[] = []
    let skipped: readonly string[] = []
    let stoppedAt: string | null = null
    let message: string | null = null
    for (const member of queue) {
      if (stopRef.current) {
        message = "Stopped."
        break
      }
      const result = await attempt(member, text)
      if (result.kind === "blocked") blocked = [...blocked, memberName(member)]
      else if (result.kind === "skipped") skipped = [...skipped, `${memberName(member)} (${result.message})`]
      else {
        stoppedAt = memberName(member)
        message = result.message
        break
      }
      setProgress({ done: blocked.length + skipped.length, total: queue.length, waiting: false })
    }

    setOutcome({ blocked, skipped, stoppedAt, message })
    setProgress(null)
    onRunningChange(false)
    if (!stoppedAt && !message) toast.success(`Blocked ${accounts(blocked.length)}`)
    onDone()
  }

  const running = progress !== null

  return (
    <div data-testid="block-cluster-panel" className="order-3 basis-full space-y-2 rounded-lg border bg-background p-3">
      <div className="text-sm font-semibold">
        Block {accounts(plan.targets.length)} in cluster #{cluster.id}
      </div>
      {plan.alreadyBlocked > 0 && (
        <p className="text-xs text-muted-foreground">{plan.alreadyBlocked} already blocked — skipped.</p>
      )}
      {plan.admins > 0 && (
        <p className="text-xs text-muted-foreground">
          {plan.admins === 1 ? "1 admin account skipped" : `${plan.admins} admin accounts skipped`} — the block route refuses them.
        </p>
      )}
      {cluster.unresolved > 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {cluster.unresolved} {cluster.unresolved === 1 ? "member" : "members"} of this cluster could not be listed and will not be blocked.
        </p>
      )}
      <ul className="max-h-40 overflow-y-auto rounded border bg-card px-3 py-2 font-mono text-xs">
        {plan.targets.map((member) => (
          <li key={member.userId}>{memberName(member)}</li>
        ))}
      </ul>
      <Input
        aria-label="Block reason"
        value={reason}
        maxLength={500}
        disabled={running || outcome !== null}
        onChange={(e) => setReason(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        Each account is blocked on its own, with this reason, one after another. An account the server refuses is
        skipped; any other failure stops the run there, and the ones before it stay blocked.
        {plan.targets.length > BLOCKS_PER_MINUTE &&
          ` The server allows ${BLOCKS_PER_MINUTE} blocks a minute, so this run will pause and resume.`}
      </p>
      {progress && (
        <p className="text-xs" aria-live="polite">
          {progress.waiting ? "Waiting for the rate limit…" : `Blocking ${progress.done} / ${progress.total}…`}
        </p>
      )}
      {outcome && (
        <div className="space-y-1 text-xs" aria-live="polite">
          {outcome.stoppedAt ? (
            <p className="text-destructive">
              Stopped at {outcome.stoppedAt}: {outcome.message}. {accounts(outcome.blocked.length)} blocked before it.
            </p>
          ) : outcome.message ? (
            <p>
              {outcome.message} {accounts(outcome.blocked.length)} blocked.
            </p>
          ) : (
            <p className="text-green-700 dark:text-green-400">Blocked {accounts(outcome.blocked.length)}.</p>
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
            disabled={running || plan.targets.length === 0}
            onClick={run}
          >
            {running && <Loader2 className="me-1 h-3 w-3 animate-spin" />}
            Block {accounts(plan.targets.length)}
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
