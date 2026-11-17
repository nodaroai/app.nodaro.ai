/**
 * While the agents work: how fast the show runs (1× or 2×), skipping straight
 * to the end (the work still happens, only the show is skipped), and Stop.
 */
import { FastForward, Square } from "lucide-react"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { Speed } from "./use-edit-session"

export function RunControls({ speed, onSpeed, onSkip, onStop }: { readonly speed: Speed; readonly onSpeed: (s: Speed) => void; readonly onSkip: () => void; readonly onStop: () => void }) {
  const t = useT()
  return (
    <div className="flex items-center gap-2 border-t border-[#2D2D2D] px-4 py-3">
      <button type="button" onClick={onStop} className="flex items-center gap-1.5 rounded-md border border-white/15 px-3 py-1.5 text-xs hover:bg-white/10">
        <Square className="h-3 w-3" aria-hidden />
        {t("freecutAi.stop")}
      </button>
      <div role="radiogroup" aria-label={t("freecutAi.speed")} className="ms-auto flex overflow-hidden rounded-md border border-white/15">
        {([1, 2] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={speed === s}
            onClick={() => onSpeed(s)}
            className={cn("px-2 py-1 text-[11px]", speed === s ? "bg-white/15 text-white" : "text-white/70 hover:bg-white/10")}
          >
            {t("freecutAi.speedTimes", { n: s })}
          </button>
        ))}
      </div>
      <button type="button" onClick={onSkip} className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-white/75 hover:bg-white/10">
        <FastForward className="h-3 w-3" aria-hidden />
        {t("freecutAi.skipToEnd")}
      </button>
    </div>
  )
}
