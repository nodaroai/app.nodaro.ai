/**
 * A Video Remake run's recorded faults as chips, in the order given (the
 * server sends them worst first): the kind, with an override's intent code
 * beside it, coloured by severity — blocked red, recovered amber, warning
 * grey — and the severity spelled out, so it is never colour alone. A chip's
 * title holds when it was recorded and its whole detail.
 *
 * Shared by Admin → Remake faults and the admin job page's Cast Swap steps.
 * English-only, like every admin surface.
 */
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { CastSwapFault, CastSwapFaultSeverity } from "@/lib/api"

export const SEVERITY_LABELS: Readonly<Record<CastSwapFaultSeverity, string>> = {
  blocked: "Blocked",
  recovered: "Recovered",
  warning: "Warning",
}

const SEVERITY_CLASSES: Readonly<Record<CastSwapFaultSeverity, string>> = {
  blocked: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
  recovered: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-400",
  warning: "border-border bg-muted/40 text-muted-foreground",
}

/** The chip's text: the kind, and an intent override's code (`detail.code`) when it names one. */
export function faultLabel(fault: CastSwapFault): string {
  const code = fault.detail?.code
  return fault.kind === "intent_override" && typeof code === "string" && code.trim() !== "" ? `${fault.kind}: ${code}` : fault.kind
}

function faultTitle(fault: CastSwapFault): string {
  const lines = [`${SEVERITY_LABELS[fault.severity]}: ${fault.kind}`]
  if (fault.at) lines.push(`At ${fault.at}`)
  if (fault.detail && Object.keys(fault.detail).length > 0) lines.push(JSON.stringify(fault.detail))
  return lines.join("\n")
}

export function RemakeFaultChips({ faults, className }: { faults: readonly CastSwapFault[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-1", className)} aria-label="Faults">
      {faults.map((f, i) => (
        <li key={`${f.kind}-${f.at ?? ""}-${i}`} data-fault-kind={f.kind} data-fault-severity={f.severity}>
          <Badge variant="outline" className={cn("gap-1 font-normal", SEVERITY_CLASSES[f.severity])} title={faultTitle(f)}>
            <span className="font-medium">{SEVERITY_LABELS[f.severity]}</span>
            <span className="font-mono text-[11px]">{faultLabel(f)}</span>
          </Badge>
        </li>
      ))}
    </ul>
  )
}
