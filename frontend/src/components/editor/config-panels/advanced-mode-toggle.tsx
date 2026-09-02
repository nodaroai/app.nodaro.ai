import { useT } from "@/lib/i18n"
import { useEffect } from "react"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { supportsAdvancedMode, LLM_FEATURE_DEFAULTS, llmRouteDefaults } from "@nodaro/shared"
import type { LlmFeature } from "@nodaro/shared"

/** Mirrors `LLM_ADVANCED_SHAPE.maxTokens` in the backend. A number input's
 *  `min`/`max` are advisory — typing 999999 commits it — and the route then
 *  rejects the whole run with a validation error naming a field the user can
 *  see is "in range". Clamping on blur keeps the stored value acceptable. */
const MAX_TOKENS_MIN = 1
const MAX_TOKENS_MAX = 32768

interface AdvancedModeToggleProps {
  feature: LlmFeature
  /** The node's current llmModel (undefined = the feature default). */
  modelId?: string
  value?: boolean
  onChange: (patch: { advancedMode?: boolean; temperature?: number; maxTokens?: number }) => void
  /** Current sampling values, rendered only while advanced is on. */
  temperature?: number
  maxTokens?: number
}

/**
 * Advanced mode opt-in for an LLM node.
 *
 * Shown DISABLED (rather than hidden) when the selected model can't support
 * it: a control that silently vanishes reads as a bug, whereas a greyed one
 * with a reason tells the user exactly what to change. Matches the house
 * pattern for this — `Switch` plus a muted hint line, not a tooltip.
 *
 * Turning it on both pins the request to the vendor's own API and bills one
 * credit tier up, so the copy says so rather than making the price jump look
 * like a glitch.
 */
export function AdvancedModeToggle({
  feature,
  modelId,
  value,
  onChange,
  temperature,
  maxTokens,
}: AdvancedModeToggleProps) {
  const t = useT()
  // Seeded from the SAME table the routes read, so the sliders open on the
  // value that actually runs. These used to be props no panel passed, so every
  // node displayed 0.7/2048 while its route used e.g. 0.3/3072 — and one
  // arrow-key press committed the wrong number.
  const { temperature: defaultTemperature, maxTokens: defaultMaxTokens, structuredOutput } =
    llmRouteDefaults(feature)
  const effectiveModel = modelId || LLM_FEATURE_DEFAULTS[feature]
  const supported = supportsAdvancedMode(effectiveModel)
  const on = value === true

  // Switching to a model that can't run advanced must clear the flag, not
  // leave it set-but-unreachable — the route would 400 on the next run and the
  // user would have no visible cause.
  useEffect(() => {
    if (on && !supported) onChange({ advancedMode: undefined })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveModel])

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label htmlFor={`advanced-${feature}`} className="text-xs font-medium text-muted-foreground">
          {t("cfgshared.advancedMode")}
        </Label>
        <Switch
          id={`advanced-${feature}`}
          checked={on && supported}
          disabled={!supported}
          // `undefined` rather than `false` when off, so a node that never
          // touched this stays byte-identical to a pre-feature workflow.
          onCheckedChange={(v) => onChange({ advancedMode: v ? true : undefined })}
        />
      </div>

      {!supported ? (
        <p className="text-[11px] text-muted-foreground">{t("cfgshared.advancedUnavailable")}</p>
      ) : !on ? (
        <p className="text-[11px] text-muted-foreground">
          {t("cfgshared.advancedModeHint")}
        </p>
      ) : (
        <div className="space-y-2 pt-1">
          <div>
            <Label className="text-xs text-muted-foreground">
              {t("audiocfg.temperature")}: {(temperature ?? defaultTemperature ?? 0.7).toFixed(1)}
            </Label>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={temperature ?? defaultTemperature ?? 0.7}
              onChange={(e) => onChange({ temperature: parseFloat(e.target.value) })}
              className="w-full mt-1 accent-[#ff0073]"
            />
            {structuredOutput && (
              <p className="text-[11px] text-muted-foreground mt-1">
                {t("cfgshared.structuredOutputTempWarn")}
              </p>
            )}
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{t("cfgshared.maxTokens")}</Label>
            <Input
              type="number"
              min={MAX_TOKENS_MIN}
              max={MAX_TOKENS_MAX}
              step={256}
              value={maxTokens ?? defaultMaxTokens ?? 2048}
              onChange={(e) =>
                onChange({ maxTokens: parseInt(e.target.value, 10) || defaultMaxTokens || 2048 })
              }
              // Clamp on blur, not on change — clamping mid-typing rewrites the
              // field under the cursor ("3" becomes "256" before "3000" exists).
              onBlur={(e) => {
                const n = parseInt(e.target.value, 10)
                const clamped = Number.isFinite(n)
                  ? Math.min(MAX_TOKENS_MAX, Math.max(MAX_TOKENS_MIN, n))
                  : (defaultMaxTokens ?? 2048)
                if (clamped !== maxTokens) onChange({ maxTokens: clamped })
              }}
              className="mt-1 bg-[#F8FAFC] dark:bg-[#121212] border-gray-200 dark:border-[#2D2D2D]"
            />
          </div>
        </div>
      )}
    </div>
  )
}
