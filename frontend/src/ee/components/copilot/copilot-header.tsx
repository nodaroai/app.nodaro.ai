/**
 * Panel header: identity, the Ask/Auto lever, and the auto-run ceiling.
 *
 * Ask/Auto is a segmented track rather than a switch because the two states are
 * named behaviours, not on/off. The ceiling stays visible in Ask (dimmed) so it
 * is discoverable before the user needs it, and the hint on the right says in
 * words what the current mode will do — the whole point of the control.
 */
import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { COPILOT_STRINGS as S } from "@/ee/lib/copilot/strings"
import { useCopilotStore } from "@/ee/lib/copilot/turn-store"
import type { CopilotRunMode } from "@/ee/lib/copilot/types"

interface CopilotHeaderProps {
  onClose: () => void
  onChangeSettings: (patch: {
    runMode?: CopilotRunMode
    autoRunLimitCredits?: number
    allowPublishing?: boolean
  }) => void
}

export function CopilotHeader({ onClose, onChangeSettings }: CopilotHeaderProps) {
  const runMode = useCopilotStore((s) => s.runMode)
  const allowPublishing = useCopilotStore((s) => s.allowPublishing)
  const autoRunLimit = useCopilotStore((s) => s.autoRunLimit)
  const [draftLimit, setDraftLimit] = useState(String(autoRunLimit))

  useEffect(() => {
    setDraftLimit(String(autoRunLimit))
  }, [autoRunLimit])

  const commitLimit = () => {
    const parsed = Number.parseInt(draftLimit, 10)
    if (!Number.isFinite(parsed) || parsed < 0) {
      setDraftLimit(String(autoRunLimit))
      return
    }
    const clamped = Math.min(parsed, 100_000)
    setDraftLimit(String(clamped))
    if (clamped !== autoRunLimit) onChangeSettings({ autoRunLimitCredits: clamped })
  }

  return (
    <div className="flex-none px-3.5 py-3 border-b border-border flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <span className="w-[7px] h-[7px] rounded-[2px] bg-primary" aria-hidden />
        <span className="text-[13.5px] font-semibold text-foreground tracking-[-0.01em]">{S.title}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={S.close}
          className="ml-auto w-[26px] h-[26px] rounded-[7px] border border-border text-[var(--copilot-muted)] hover:text-foreground flex items-center justify-center transition-colors"
        >
          <X className="w-3 h-3" strokeWidth={2.2} />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <div role="radiogroup" aria-label="Run mode" className="flex p-0.5 bg-[var(--copilot-card)] border border-border rounded-lg">
          {(["ask", "auto"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={runMode === mode}
              onClick={() => runMode !== mode && onChangeSettings({ runMode: mode })}
              className={`px-3 py-[5px] rounded-md text-xs font-medium transition-colors ${
                runMode === mode
                  ? "bg-[var(--copilot-surface)] text-foreground"
                  : "text-[var(--copilot-muted)] hover:text-foreground"
              }`}
            >
              {mode === "ask" ? S.modeAsk : S.modeAuto}
            </button>
          ))}
        </div>

        <div
          className={`flex items-center gap-1.5 px-2.5 py-[5px] bg-[var(--copilot-card)] border border-border rounded-lg whitespace-nowrap transition-opacity ${
            runMode === "auto" ? "opacity-100" : "opacity-45"
          }`}
        >
          <span className="text-[11.5px] text-[var(--copilot-dim)]">{S.ceilingPrefix}</span>
          <input
            aria-label={S.ceilingLabel}
            inputMode="numeric"
            value={draftLimit}
            onChange={(e) => setDraftLimit(e.target.value.replace(/[^\d]/g, ""))}
            onBlur={commitLimit}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur()
            }}
            size={Math.max(2, draftLimit.length)}
            className="bg-transparent border-none outline-none text-xs font-semibold text-foreground tabular-nums w-[4ch] text-center focus:ring-0"
          />
          <span className="text-[11.5px] text-[var(--copilot-dim)]">{S.ceilingSuffix}</span>
        </div>

        <span className="ml-auto text-[11px] text-[var(--copilot-dim)] whitespace-nowrap">
          {runMode === "auto" ? S.modeHintAuto : S.modeHintAsk}
        </span>
      </div>

      {/* A checkbox and not a segmented track: unlike Ask/Auto these are not two
          named behaviours, they are a permission the user grants. Off is the
          absence of it, and it should look like one. */}
      <label className="flex items-start gap-2 cursor-pointer group">
        <input
          type="checkbox"
          checked={allowPublishing}
          onChange={(e) => onChangeSettings({ allowPublishing: e.target.checked })}
          className="mt-[2px] w-3.5 h-3.5 flex-none rounded-[4px] accent-[var(--copilot-mention)] cursor-pointer"
        />
        <span className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[11.5px] text-foreground leading-tight">{S.allowPublishing}</span>
          <span className="text-[10.5px] text-[var(--copilot-dim)] leading-tight">
            {allowPublishing ? S.allowPublishingOn : S.allowPublishingOff}
          </span>
        </span>
      </label>
    </div>
  )
}
