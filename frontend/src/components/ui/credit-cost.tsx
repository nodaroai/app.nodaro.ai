import type { ReactNode } from "react"
import { Coins } from "lucide-react"
import { hasCredits } from "@/lib/edition"
import { cn } from "@/lib/utils"

/**
 * The ONE way to render a credit figure read off a server row
 * (estimatedCredits, creditsUsed, baseEstimatedCredits, …).
 *
 * Renders NOTHING on editions without a credit system — community has no
 * credits, so a credit number there is always a lie. Per-site `hasCredits()`
 * guards kept being forgotten (#645: nine sites, two of them in files that
 * already gated OTHER lines); rendering through this component makes a new
 * call site correct by default, and the scan test next to this file fails
 * the build when someone interpolates a credits value into JSX by hand.
 */
export function CreditCost({
  credits,
  suffix = "CR",
  prefix,
  icon,
  className,
}: {
  credits: number | null | undefined
  /** Unit label after the number; "" for a bare number inside a larger phrase. */
  suffix?: string
  /** Text rendered before the figure, INSIDE the gate (e.g. " · "). */
  prefix?: string
  /** Coins glyph: "sm" = h-3 w-3, "md" = h-3.5 w-3.5. Omit for text-only. */
  icon?: "sm" | "md"
  className?: string
}) {
  if (!hasCredits()) return null
  return (
    <span className={cn(icon ? "flex items-center gap-1" : undefined, className)}>
      {prefix}
      {icon && <Coins className={icon === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />}
      {credits ?? 0}{suffix ? ` ${suffix}` : ""}
    </span>
  )
}

/**
 * Escape hatch for credit-bearing layouts too bespoke for the atom above
 * (labelled tooltip rows, multi-figure lines): children render only on
 * editions with a credit system. Keep the figures themselves inside
 * <CreditCost> atoms so the scan test stays clean.
 */
export function CreditGate({ children }: { children: ReactNode }) {
  if (!hasCredits()) return null
  return <>{children}</>
}
