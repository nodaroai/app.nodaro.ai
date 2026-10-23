import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"

/**
 * The gradient credit badge from the handoff: the figure over a tracked
 * "CREDITS" caption on a pink→purple square. Two sizes — 96 px in the popup,
 * 44 px in the banner.
 */
export function WelcomeCreditBadge({ credits, size }: { readonly credits: string; readonly size: "lg" | "sm" }) {
  const t = useT()
  const lg = size === "lg"
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex shrink-0 flex-col items-center justify-center text-white",
        "bg-[linear-gradient(135deg,var(--welcome-accent),var(--welcome-purple))]",
        lg ? "h-24 w-24 rounded-[26px] shadow-[0_14px_40px_rgba(255,42,127,0.35)]" : "h-11 w-11 rounded-xl",
      )}
    >
      <span className={cn("font-extrabold leading-none tabular-nums", lg ? "text-[22px]" : "text-[13px]")}>{credits}</span>
      <span className={cn("font-bold uppercase tracking-[0.18em]", lg ? "mt-1.5 text-[11px]" : "mt-0.5 text-[11px]")}>
        {t("welcome.badge")}
      </span>
    </div>
  )
}
