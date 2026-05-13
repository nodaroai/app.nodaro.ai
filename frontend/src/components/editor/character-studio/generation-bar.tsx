import { useState } from "react"
import { useModelCredits } from "@/ee/hooks/use-model-credits"

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
}

export function GenerationBar({ presets, models, defaultModel, disabled, disabledHint, customPlaceholder, onGenerate, onGenerateAll, generateAllCount, onModelChange }: GenerationBarProps) {
  const [model, setModel] = useState(defaultModel)
  const [text, setText] = useState("")
  const cost = useModelCredits(model, 0)
  const costLabel = cost > 0 ? ` (${cost} CR)` : ""
  const allCost = cost > 0 && generateAllCount ? cost * generateAllCount : 0

  const setModelAndNotify = (m: string) => {
    setModel(m)
    onModelChange?.(m)
  }

  return (
    <div className="border-t border-[#1e293b] p-2.5 bg-[#090c12] space-y-2">
      <div className="flex gap-1.5 flex-wrap items-center">
        <span className="text-[9px] text-slate-500 pr-1">Quick:</span>
        {presets.map((p) => (
          <button
            key={p}
            disabled={disabled}
            title={disabled ? disabledHint : `${p}${costLabel}`}
            className="text-[10px] bg-[#1e293b] border border-[#334155] rounded px-2 py-0.5 text-slate-300 disabled:opacity-40"
            onClick={() => onGenerate(p, true, model)}
          >{p}{cost > 0 && <span className="text-slate-500 ml-1">· {cost}</span>}</button>
        ))}
        {onGenerateAll && (
          <button
            disabled={disabled}
            title={generateAllCount ? `${generateAllCount} missing × ${cost} CR = ${allCost} CR` : undefined}
            className="text-[10px] bg-[#1e293b] border border-[#334155] rounded px-2 py-0.5 text-slate-400 ml-auto disabled:opacity-40"
            onClick={onGenerateAll}
          >⟳ Generate All{allCost > 0 ? ` (${allCost} CR)` : ""}</button>
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
          disabled={disabled || text.trim().length === 0}
          title={disabled ? disabledHint : `Generate${costLabel}`}
          className="text-[10px] bg-[#3b82f6] text-white font-medium rounded px-4 py-1.5 disabled:opacity-40"
          onClick={() => { onGenerate(text.trim(), false, model); setText("") }}
        >Generate{costLabel}</button>
      </div>
    </div>
  )
}
