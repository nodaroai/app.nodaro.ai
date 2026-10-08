import { useMemo } from "react"
import { Rewind } from "lucide-react"
import { Button } from "@/components/ui/button"
import { runUpToHereSet } from "@/components/editor/workflow-editor/run-up-to-here-set"
import { useRunSetCredits } from "@/hooks/use-run-from-here-credits"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { creditUnits } from "@/lib/credit-units"
import { hasCredits } from "@/lib/edition"
import { useT } from "@/lib/i18n"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

/**
 * The "upstream hasn't run" state of a node that reads an upstream result
 * (Speaker View's EDL, Apply EDL's), decided 2026-10-08: it says so and offers
 * "Run up to here · ≈N" — the editor's run-up-to-here action, priced with the
 * run's own estimate over the very set the run executes. Nothing shows once
 * everything upstream has run.
 */
export function RunUpToHereNotice({ nodeId, nodes, edges, showMessage = true }: {
  readonly nodeId: string
  readonly nodes: ReadonlyArray<WorkflowNode>
  readonly edges: ReadonlyArray<WorkflowEdge>
  /** False when the panel already says, in its own words, that upstream has not run. */
  readonly showMessage?: boolean
}) {
  const t = useT()
  const runUpToHere = useWorkflowStore((s) => s.runUpToHere)
  // Copy once per prop identity, never per render: the price hook's prefetch
  // effect and memo key on these arrays, so a fresh copy each render re-fires
  // them every render (an unbounded refetch loop while the price fetch fails).
  const nodesArr = useMemo(() => [...nodes], [nodes])
  const edgesArr = useMemo(() => [...edges], [edges])
  const executable = useMemo(() => runUpToHereSet(nodeId, nodesArr, edgesArr).executable, [nodeId, nodesArr, edgesArr])
  const credits = useRunSetCredits(executable, nodesArr, edgesArr)
  if (executable.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5" data-testid="run-up-to-here-notice">
      {showMessage && <p role="status" className="text-[11px] text-muted-foreground">{t("runUpToHere.upstreamNotRun")}</p>}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-fit"
        disabled={!runUpToHere}
        title={t("runUpToHere.tooltip")}
        onClick={() => runUpToHere?.(nodeId)}
      >
        <Rewind className="h-3.5 w-3.5" />
        {hasCredits() ? t("runUpToHere.button", { credits: creditUnits(credits) }) : t("node.runUpToHere")}
      </Button>
    </div>
  )
}
