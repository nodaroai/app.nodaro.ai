/**
 * Panel header: identity, the current settings in a word ("Ask · Smart"), and
 * the panel's own controls — settings, fold to the strip, put away.
 *
 * The settings themselves are out of sight until the settings button opens
 * them under the header (`copilot-settings.tsx`): most turns never touch them,
 * and a rail that opens on a wall of toggles hides the conversation.
 */
import { useState } from "react"
import { ChevronLeft, X } from "lucide-react"
import { COPILOT_KEYS as K } from "@/ee/lib/copilot/strings"
import { useT } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import { cn } from "@/lib/utils"
import { CopilotMemoriesButton } from "./copilot-memories"
import { CopilotSettingsButton, CopilotSettingsControls, type CopilotSettingsPatch } from "./copilot-settings"

interface CopilotHeaderProps {
  onClose: () => void
  onMinimize: () => void
  onChangeSettings: (patch: CopilotSettingsPatch) => void
}

const ICON_BUTTON =
  "w-[26px] h-[26px] rounded-[7px] border border-border text-[var(--copilot-muted)] hover:text-foreground hover:border-[var(--copilot-strong)] flex items-center justify-center transition-colors"

export function CopilotHeader({ onClose, onMinimize, onChangeSettings }: CopilotHeaderProps) {
  const t = useT()
  const isRtl = useAppDir() === "rtl"
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div className="flex-none border-b border-border">
      <div className="px-3.5 py-3 flex items-center gap-2">
        <span className="w-[7px] h-[7px] rounded-[2px] bg-primary" aria-hidden />
        <span className="text-[13.5px] font-semibold text-foreground tracking-[-0.01em]">{t(K.title)}</span>
        <div className="ms-auto flex items-center gap-1.5">
          <CopilotSettingsButton open={settingsOpen} onToggle={() => setSettingsOpen((v) => !v)} className="py-1" />
          <CopilotMemoriesButton />
          <button type="button" onClick={onMinimize} aria-label={t(K.minimize)} title={t(K.minimize)} className={ICON_BUTTON}>
            {/* Points at the rail's own edge, so it flips with the reading direction. */}
            <ChevronLeft className={cn("w-3 h-3", isRtl && "rotate-180")} strokeWidth={2.2} />
          </button>
          <button type="button" onClick={onClose} aria-label={t(K.close)} title={t(K.close)} className={ICON_BUTTON}>
            <X className="w-3 h-3" strokeWidth={2.2} />
          </button>
        </div>
      </div>
      {settingsOpen && (
        <div className="px-3.5 pt-1 pb-3.5 border-t border-border bg-[var(--copilot-card)]/40">
          <CopilotSettingsControls onChange={onChangeSettings} />
        </div>
      )}
    </div>
  )
}
