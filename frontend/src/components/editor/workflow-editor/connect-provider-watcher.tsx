import { useEffect, useRef, useState } from "react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { isCloud } from "@/lib/edition"
import { fetchProviderReadiness } from "@/lib/provider-readiness"
import { ConnectProviderDialog } from "@/components/editor/connect-provider-dialog"

/**
 * Turns "a node failed on an install with no provider" into the Connect dialog
 * (#771).
 *
 * Deliberately a WATCHER rather than an edit at each failure site: node runs
 * fail in a dozen places across `execute-node.ts` and `asset-executors.ts`, and
 * every one of them already writes `executionStatus: "failed"` to the store.
 * Reading that one signal keeps this feature out of files three other open
 * issues are editing, and means a newly added node type is covered for free.
 *
 * The trigger is CAPABILITY, never a message: after a failure it asks
 * `/v1/setup/status` whether this install has any provider at all. A real
 * provider failure — bad key, upstream outage, unsupported model — leaves
 * `providers.ok` true and never reaches the dialog. An unknown answer (offline,
 * 5xx) is treated as "do not act", so a transient blip is never rendered as a
 * configuration problem.
 *
 * Never on cloud, where an install without providers is not a state that exists.
 */
export function ConnectProviderWatcher() {
  const nodes = useWorkflowStore((s) => s.nodes)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const [pending, setPending] = useState<{ label: string; id: string; alsoBlocked: number } | null>(null)
  /** Failures already considered — one dialog per failure, not one per render. */
  const seen = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (isCloud()) return

    const failed = nodes.filter((n) => (n.data as { executionStatus?: string }).executionStatus === "failed")

    // Forget any node that is no longer failed — a re-run flips it to
    // "running" and it must be able to open the dialog again if it fails
    // afresh. Clearing only when NOTHING is failed was wrong: with a second
    // node still failed the set never emptied, so a re-run of the first that
    // failed again was silently swallowed.
    const failedIds = new Set(failed.map((n) => n.id))
    for (const id of [...seen.current]) if (!failedIds.has(id)) seen.current.delete(id)
    if (failed.length === 0) return

    const fresh = failed.find((n) => !seen.current.has(n.id))
    if (!fresh) return
    seen.current.add(fresh.id)

    let cancelled = false
    void fetchProviderReadiness().then((readiness) => {
      if (cancelled || readiness === null || readiness.ok) return
      const data = fresh.data as { label?: string }
      setPending({
        id: fresh.id,
        label: data.label ?? "This node",
        // Everything else that stopped in the same run is blocked by the same
        // missing provider, so one connection covers them too.
        alsoBlocked: failed.length - 1,
      })
    })
    return () => {
      cancelled = true
    }
  }, [nodes])

  if (!pending) return null

  // onRetry is what keeps the dialog from being a dead end: after saving a key
  // there has to be a way to continue the run it interrupted. It is undefined
  // when the editor has not registered a runner, which hides the action rather
  // than offering one that does nothing.
  return (
    <ConnectProviderDialog
      open
      nodeLabel={pending.label}
      alsoBlockedCount={pending.alsoBlocked}
      onOpenChange={(open) => {
        if (!open) setPending(null)
      }}
      onRetry={runSingleNode ? () => runSingleNode(pending.id) : undefined}
    />
  )
}
