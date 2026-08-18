/**
 * Tiny "Trained" badge for character UI surfaces (mention autocomplete,
 * gallery tiles, etc.). Display-only — no click behavior.
 *
 * Two sizes: `"xs"` (default, for autocomplete rows) and `"sm"` (for cards).
 */
interface TrainedPillProps {
  readonly size?: "xs" | "sm"
  readonly className?: string
}

export function TrainedPill({ size = "xs", className }: TrainedPillProps) {
  const sizeClass =
    size === "xs"
      ? "px-1 py-0 text-[9px]"
      : "px-1.5 py-0.5 text-[10px]"
  return (
    <span
      className={
        `inline-flex items-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 font-medium ${sizeClass} ${className ?? ""}`.trim()
      }
      title="This character has a trained high-fidelity model. Generations will use the trained model instead of reference image injection."
    >
      Trained
    </span>
  )
}
