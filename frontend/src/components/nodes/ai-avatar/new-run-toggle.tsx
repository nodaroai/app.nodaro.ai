"use client"

// "New run" — the strip button of the AI Avatar node once a video exists.
// One click hides the results and brings the setup card back (start fresh:
// pick another look, change the voice or the text); a second click restores
// the results exactly as they were. Nothing runs either way — the run is the
// strip's Run (a new version lands on top of the earlier ones). It lives in
// the bottom strip with Run, where every action on the node lives; rendered
// by the node through NodeQuickStrip's `children` slot.

import { useT } from "@/lib/i18n"
import { RotateCw } from "lucide-react"
import { cn } from "@/lib/utils"

interface AiAvatarNewRunToggleProps {
  /** True while the setup card is shown over the (hidden) results. */
  readonly active: boolean
  readonly onToggle: () => void
  readonly disabled?: boolean
}

export function AiAvatarNewRunToggle({ active, onToggle, disabled = false }: AiAvatarNewRunToggleProps) {
  const t = useT()
  return (
    <button
      type="button"
      data-testid="ai-avatar-new-run"
      aria-label={t("node.newRun")}
      aria-pressed={active}
      title={
        active
          ? "Back to the results — nothing runs"
          : "Hide the results and start fresh — pick another look, change the voice or the text, then Run for a new version. Click again to bring the results back."
      }
      disabled={disabled}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      className={cn(
        "nodrag h-6 px-1.5 inline-flex items-center gap-1 rounded-md text-[10px] whitespace-nowrap transition-colors [&_svg]:size-3",
        active
          ? "text-[#ff0073] bg-[#ff0073]/10 hover:bg-[#ff0073]/15 [&_svg]:opacity-100"
          : "text-neutral-900/85 hover:bg-black/10 dark:text-white/85 dark:hover:bg-white/10 [&_svg]:opacity-70",
        disabled && "opacity-40 cursor-not-allowed",
      )}
    >
      <RotateCw aria-hidden />
      <span>{t("node.newRun")}</span>
    </button>
  )
}
