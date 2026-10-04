/**
 * The Copilot's settings, kept out of sight: a small button that names the
 * current choice ("Ask · Smart") opens them — a popover in the middle of the
 * canvas, a section under the rail's header.
 *
 * Ask/Auto is a segmented track rather than a switch because the two states are
 * named behaviours, not on/off. The ceiling stays visible in Ask (dimmed) so it
 * is discoverable before the user needs it, and the hint says in words what the
 * current mode will do — the whole point of the control.
 */
import { useEffect, useState } from "react"
import { SlidersHorizontal } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { useCopilotUiStore } from "@/hooks/use-copilot-ui-store"
import { useT, type MessageKey } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { COPILOT_KEYS as K } from "@/ee/lib/copilot/strings"
import { useCopilotStore } from "@/ee/lib/copilot/turn-store"
import { useCopilotSettings } from "@/ee/hooks/copilot/use-copilot-thread"
import type { CopilotModelTier, CopilotRunMode } from "@/ee/lib/copilot/types"

export interface CopilotSettingsPatch {
  runMode?: CopilotRunMode
  autoRunLimitCredits?: number
  allowPublishing?: boolean
  modelTier?: CopilotModelTier
}

/** The ladder's three rungs — names for people, hints for honesty. Keys, resolved at render. */
const TIER_UI: ReadonlyArray<{ tier: CopilotModelTier; labelKey: MessageKey; hintKey: MessageKey }> = [
  { tier: "economy", labelKey: K.tierEconomy, hintKey: K.tierHintEconomy },
  { tier: "standard", labelKey: K.tierStandard, hintKey: K.tierHintStandard },
  { tier: "premium", labelKey: K.tierPremium, hintKey: K.tierHintPremium },
]

/**
 * Applies a settings change: locally first, so the control responds with no
 * thread and with no network, then on the thread when there is one.
 */
export function useCopilotSettingsChange(): (patch: CopilotSettingsPatch) => void {
  const threadId = useCopilotStore((s) => s.threadId)
  const settings = useCopilotSettings(threadId)
  return (patch) => {
    const current = useCopilotStore.getState()
    current.setRunSettings(
      patch.runMode ?? current.runMode,
      patch.autoRunLimitCredits ?? current.autoRunLimit,
      patch.allowPublishing ?? current.allowPublishing,
      patch.modelTier ?? current.modelTier,
    )
    if (threadId) settings.mutate(patch)
  }
}

/** "Ask · Smart": the current choice, as the settings button names it. */
export function CopilotSettingsSummary({ className }: { readonly className?: string }) {
  const t = useT()
  const runMode = useCopilotStore((s) => s.runMode)
  const modelTier = useCopilotStore((s) => s.modelTier)
  const tier = TIER_UI.find((row) => row.tier === modelTier)
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap", className)}>
      <span>{t(runMode === "auto" ? K.modeAuto : K.modeAsk)}</span>
      <span aria-hidden>·</span>
      <span>{tier ? t(tier.labelKey) : null}</span>
    </span>
  )
}

/** The rail's surface ramp, or the canvas's when the button floats in the middle of it. */
const SETTINGS_BUTTON_LOOK = {
  panel: {
    open: "border-primary/60 text-foreground bg-[var(--copilot-surface)]",
    closed: "border-border text-[var(--copilot-muted)] bg-[var(--copilot-card)] hover:text-foreground hover:border-[var(--copilot-strong)]",
  },
  canvas: {
    open: "border-primary/60 text-[var(--pill-fg)] bg-[var(--node-card)]",
    closed: "border-border text-[var(--pill-fg-muted)] bg-[var(--node-card)] hover:text-[var(--pill-fg)] hover:border-[var(--pill-fg-muted)]/40",
  },
} as const

/** The small button that opens the settings: an icon and the current choice. */
export function CopilotSettingsButton({
  open,
  onToggle,
  surface = "panel",
  className,
}: {
  readonly open: boolean
  readonly onToggle: () => void
  readonly surface?: keyof typeof SETTINGS_BUTTON_LOOK
  readonly className?: string
}) {
  const t = useT()
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={t(K.settingsButton)}
      title={t(K.settingsButton)}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-colors",
        open ? SETTINGS_BUTTON_LOOK[surface].open : SETTINGS_BUTTON_LOOK[surface].closed,
        className,
      )}
    >
      <SlidersHorizontal className="w-3.5 h-3.5" strokeWidth={2} />
      <CopilotSettingsSummary />
    </button>
  )
}

/**
 * Every setting: Ask/Auto with the auto-run ceiling, the model, permission to
 * publish, and whether the Copilot returns to the middle of an empty canvas.
 */
export function CopilotSettingsControls({ onChange }: { readonly onChange: (patch: CopilotSettingsPatch) => void }) {
  const t = useT()
  const runMode = useCopilotStore((s) => s.runMode)
  const allowPublishing = useCopilotStore((s) => s.allowPublishing)
  const modelTier = useCopilotStore((s) => s.modelTier)
  const autoRunLimit = useCopilotStore((s) => s.autoRunLimit)
  const returnToCenter = useCopilotUiStore((s) => s.returnToCenterWhenEmpty)
  const setReturnToCenter = useCopilotUiStore((s) => s.setReturnToCenterWhenEmpty)
  const activeTier = TIER_UI.find((row) => row.tier === modelTier)
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
    if (clamped !== autoRunLimit) onChange({ autoRunLimitCredits: clamped })
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <div role="radiogroup" aria-label={t(K.runModeLabel)} className="flex p-0.5 bg-[var(--copilot-card)] border border-border rounded-lg">
          {(["ask", "auto"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={runMode === mode}
              onClick={() => runMode !== mode && onChange({ runMode: mode })}
              className={`px-3 py-[5px] rounded-md text-xs font-medium transition-colors ${
                runMode === mode
                  ? "bg-[var(--copilot-surface)] text-foreground"
                  : "text-[var(--copilot-muted)] hover:text-foreground"
              }`}
            >
              {t(mode === "ask" ? K.modeAsk : K.modeAuto)}
            </button>
          ))}
        </div>

        <div
          className={`flex items-center gap-1.5 px-2.5 py-[5px] bg-[var(--copilot-card)] border border-border rounded-lg whitespace-nowrap transition-opacity ${
            runMode === "auto" ? "opacity-100" : "opacity-45"
          }`}
        >
          <span className="text-[11.5px] text-[var(--copilot-dim)]">{t(K.ceilingPrefix)}</span>
          <input
            aria-label={t(K.ceilingLabel)}
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
          <span className="text-[11.5px] text-[var(--copilot-dim)]">{t(K.ceilingSuffix)}</span>
        </div>

        <span className="ms-auto text-[11px] text-[var(--copilot-dim)] whitespace-nowrap">
          {t(runMode === "auto" ? K.modeHintAuto : K.modeHintAsk)}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[11px] text-[var(--copilot-dim)]">{t(K.tierLabel)}</span>
        <div role="radiogroup" aria-label={t(K.tierLabel)} className="flex p-0.5 bg-[var(--copilot-card)] border border-border rounded-lg">
          {TIER_UI.map(({ tier, labelKey, hintKey }) => (
            <button
              key={tier}
              type="button"
              role="radio"
              aria-checked={modelTier === tier}
              title={t(hintKey)}
              onClick={() => modelTier !== tier && onChange({ modelTier: tier })}
              className={`px-2.5 py-[4px] rounded-md text-[11.5px] font-medium transition-colors ${
                modelTier === tier
                  ? "bg-[var(--copilot-surface)] text-foreground"
                  : "text-[var(--copilot-muted)] hover:text-foreground"
              }`}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
        <span className="ms-auto text-[10.5px] text-[var(--copilot-dim)] whitespace-nowrap truncate max-w-[45%]">
          {activeTier ? t(activeTier.hintKey) : null}
        </span>
      </div>

      {/* Switches, matching the on/off toggles across the editor (Voice, Fast
          Mode): unlike Ask/Auto these are not two named behaviours, they are
          single permissions the user grants. The text is beside the control,
          not wrapped in a label — the Switch carries its own accessible name. */}
      <SettingSwitch
        label={t(K.allowPublishing)}
        hint={t(allowPublishing ? K.allowPublishingOn : K.allowPublishingOff)}
        checked={allowPublishing}
        onChange={(v) => onChange({ allowPublishing: v })}
      />
      <SettingSwitch
        label={t(K.returnToCenter)}
        hint={t(K.returnToCenterHint)}
        checked={returnToCenter}
        onChange={setReturnToCenter}
      />
    </div>
  )
}

function SettingSwitch({
  label,
  hint,
  checked,
  onChange,
}: {
  readonly label: string
  readonly hint: string
  readonly checked: boolean
  readonly onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        <span className="text-[11.5px] text-foreground leading-tight">{label}</span>
        <span className="text-[10.5px] text-[var(--copilot-dim)] leading-tight">{hint}</span>
      </div>
      <Switch checked={checked} onCheckedChange={(v: boolean) => onChange(v)} aria-label={label} className="flex-none" />
    </div>
  )
}
