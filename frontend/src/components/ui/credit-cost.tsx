import type { ReactNode } from "react"
import { Coins } from "lucide-react"
import { hasCredits } from "@/lib/edition"
import { cn } from "@/lib/utils"
import { creditUnits, creditUnitLabel, serverUnitLabel } from "@/lib/credit-units"
import { useT } from "@/lib/i18n"

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
 *
 * Display unit (Phase B): a raw Nodaro-credit figure is converted here, once,
 * and labeled with the deployment's unit — so a new call site is also correct
 * in the customer's unit by default. A figure the billing seam ALREADY
 * converted (cost-summary, billing account) passes its own `unit` and is
 * rendered verbatim: figure and label from the same layer, never a second
 * conversion.
 *
 * Per minute (decided 2026-10-07): a listing whose price follows the length of
 * the recording it is given passes `perMinute`, and renders as
 * "82 CR + 14/min" — the fixed figure, then the per-minute one, each
 * converted the same way. Absent or 0, the output is exactly as before.
 *
 * Per item (decided 2026-10-07): a listing with a List its user fills passes
 * `perItem`, rendered after it as "+ 30/item" — credits per item beyond the
 * creator's saved count.
 */
export function CreditCost({
  credits,
  unit,
  suffix,
  prefix,
  icon,
  className,
  perMinute,
  perItem,
}: {
  credits: number | null | undefined
  /**
   * The unit a SERVER-converted figure arrived with (cost-summary `unit`,
   * account `unit`). When set, `credits` is rendered as-is under that unit.
   * Omit for a raw Nodaro-credit figure, which is converted.
   */
  unit?: string
  /** Unit label after the number; "" for a bare number inside a larger phrase.
   *  Defaults to the deployment's display label ("CR" unconfigured). */
  suffix?: string
  /** Text rendered before the figure, INSIDE the gate (e.g. " · "). */
  prefix?: string
  /** Coins glyph: "sm" = h-3 w-3, "md" = h-3.5 w-3.5. Omit for text-only. */
  icon?: "sm" | "md"
  className?: string
  /** A listing's credits per minute of the recording it is given (raw Nodaro
   *  credits, like `credits`); rendered after the figure when above 0. */
  perMinute?: number | null
  /** A listing's credits per item beyond the saved count of a List its user
   *  fills (raw Nodaro credits); rendered last when above 0. */
  perItem?: number | null
}) {
  const t = useT()
  if (!hasCredits()) return null
  const figure = unit === undefined ? creditUnits(credits) : (credits ?? 0)
  const label = suffix ?? (unit === undefined ? creditUnitLabel() : serverUnitLabel(unit))
  const perMinuteFigure = perMinute && perMinute > 0 ? (unit === undefined ? creditUnits(perMinute) : perMinute) : 0
  const perItemFigure = perItem && perItem > 0 ? (unit === undefined ? creditUnits(perItem) : perItem) : 0
  const shortUnit = unit === undefined ? creditUnitLabel(t("credits.unitShort")) : serverUnitLabel(unit, t("credits.unitShort"))
  const titleParts = [
    perMinuteFigure ? t("credits.perMinuteTitle", { fixed: figure, n: perMinuteFigure, u: shortUnit }) : "",
    perItemFigure ? t("credits.perItemTitle", { n: perItemFigure, u: shortUnit }) : "",
  ].filter(Boolean)
  const title = titleParts.length > 0 ? titleParts.join(" · ") : undefined
  return (
    <span className={cn(icon ? "flex items-center gap-1" : undefined, className)} title={title}>
      {prefix}
      {icon && <Coins className={icon === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />}
      {figure}{label ? ` ${label}` : ""}
      {perMinuteFigure ? ` ${t("credits.plusPerMinute", { n: perMinuteFigure })}` : ""}
      {perItemFigure ? ` ${t("credits.plusPerItem", { n: perItemFigure })}` : ""}
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
