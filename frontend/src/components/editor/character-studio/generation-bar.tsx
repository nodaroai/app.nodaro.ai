import { useState } from "react"
import { Check, Loader2 } from "lucide-react"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { creditUnits, formatCreditUnits } from "@/lib/credit-units"
import { presetState } from "../studio-shell/preset-state"
import { useT } from "@/lib/i18n"

/** Stable empty set so an omitted createdNames/busyNames prop doesn't allocate
 *  a fresh Set on every render (and every preset reads the same reference). */
const EMPTY_SET: ReadonlySet<string> = new Set()

interface GenerationBarProps {
  readonly presets: readonly string[]
  /** model picker options (image providers for expressions/poses, CHARACTER_MOTION_PROVIDERS for motions) */
  readonly models: readonly string[]
  readonly defaultModel: string
  readonly disabled?: boolean
  readonly disabledHint?: string
  readonly customPlaceholder: string
  /** isPreset=true → caller sends assetType:<tab>; isPreset=false → caller sends assetType:"custom" */
  readonly onGenerate: (text: string, isPreset: boolean, model: string) => void
  /** "Generate All" — only passed by Expressions/Poses tabs */
  readonly onGenerateAll?: () => void
  /** Count of presets that "Generate All" will actually fire (presets minus already-generated). */
  readonly generateAllCount?: number
  /** Inform the parent that the model picker changed (so AssetCards can use the same cost basis). */
  readonly onModelChange?: (model: string) => void
  /** Lowercased names already present in the tab's grid — their chip renders as
   *  "created" (a ✓, disabled) so the user can see at a glance what's done. */
  readonly createdNames?: ReadonlySet<string>
  /** Lowercased names with a generation in flight (real OR optimistic) — their
   *  chip renders as "creating" (a spinner, disabled). */
  readonly busyNames?: ReadonlySet<string>
}

export function GenerationBar({ presets, models, defaultModel, disabled, disabledHint, customPlaceholder, onGenerate, onGenerateAll, generateAllCount, onModelChange, createdNames, busyNames }: GenerationBarProps) {
  const t = useT()
  const [model, setModel] = useState(defaultModel)
  const [text, setText] = useState("")
  const cost = useModelCredits(model, 0)
  const allCost = cost > 0 && generateAllCount ? cost * generateAllCount : 0
  // The cost sits inside each key, so every language places its own
  // parentheses ("Generate (10 CR)", Japanese 生成（10 CR）).
  const generateLabel = cost > 0 ? t("studio.generateCost", { cost: formatCreditUnits(cost) }) : t("common.generate")

  const setModelAndNotify = (m: string) => {
    setModel(m)
    onModelChange?.(m)
  }

  return (
    <div className="border-t border-[#1e293b] p-2.5 bg-[#090c12] space-y-2">
      <div className="flex gap-1.5 flex-wrap items-center">
        <span className="text-[9px] text-slate-500 pe-1">{t("studio.quickColon")}</span>
        {presets.map((p) => {
          const st = presetState(p, createdNames ?? EMPTY_SET, busyNames ?? EMPTY_SET)
          const inactive = st !== "idle"
          return (
            <button
              key={p}
              type="button"
              data-state={st}
              disabled={disabled || inactive}
              title={
                disabled
                  ? disabledHint
                  : st === "created"
                    ? t("studio.presetAlreadyGenerated", { name: p })
                    : st === "creating"
                      ? t("studio.presetGenerating", { name: p })
                      : cost > 0
                        ? t("studio.generateNamedCost", { name: p, cost: formatCreditUnits(cost) })
                        : t("studio.generateNamed", { name: p })
              }
              className="text-[10px] bg-[#1e293b] border border-[#334155] rounded px-2 py-0.5 text-slate-300 inline-flex items-center gap-1 transition-transform active:scale-95 disabled:active:scale-100 disabled:opacity-40 data-[state=created]:opacity-70 data-[state=created]:text-emerald-300/80 data-[state=created]:border-emerald-700/40"
              onClick={() => onGenerate(p, true, model)}
            >
              {st === "creating" && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
              {st === "created" && <Check className="w-2.5 h-2.5" />}
              {p}
              {st === "idle" && cost > 0 && <span className="text-slate-500">· {creditUnits(cost)}</span>}
            </button>
          )
        })}
        {onGenerateAll && (
          <button
            type="button"
            disabled={disabled}
            title={generateAllCount ? t("studio.generateAllCostTitle", { n: generateAllCount, each: formatCreditUnits(cost), total: formatCreditUnits(allCost) }) : undefined}
            className="text-[10px] bg-[#1e293b] border border-[#334155] rounded px-2 py-0.5 text-slate-400 ms-auto transition-transform active:scale-95 disabled:active:scale-100 disabled:opacity-40"
            onClick={onGenerateAll}
          >⟳ {allCost > 0 ? t("studio.generateAllCost", { cost: formatCreditUnits(allCost) }) : t("studio.generateAll")}</button>
        )}
      </div>
      <div className="flex gap-2 items-center">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={disabled}
          placeholder={customPlaceholder}
          className="flex-1 text-[11px] bg-[#13161f] border border-[#334155] rounded px-3 py-1.5 text-slate-200 disabled:opacity-40"
        />
        <select value={model} onChange={(e) => setModelAndNotify(e.target.value)} className="text-[10px] bg-[#1e293b] border border-[#334155] rounded px-2 py-1 text-slate-300">
          {models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <button
          type="button"
          disabled={disabled || text.trim().length === 0}
          title={disabled ? disabledHint : generateLabel}
          className="text-[10px] bg-[#3b82f6] text-white font-medium rounded px-4 py-1.5 transition-transform active:scale-95 disabled:active:scale-100 disabled:opacity-40"
          onClick={() => { onGenerate(text.trim(), false, model); setText("") }}
        >{generateLabel}</button>
      </div>
    </div>
  )
}
