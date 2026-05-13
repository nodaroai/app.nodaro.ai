import { useState } from "react"

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
}

export function GenerationBar({ presets, models, defaultModel, disabled, disabledHint, customPlaceholder, onGenerate, onGenerateAll }: GenerationBarProps) {
  const [model, setModel] = useState(defaultModel)
  const [text, setText] = useState("")

  return (
    <div className="border-t border-[#1e293b] p-2.5 bg-[#090c12] space-y-2">
      <div className="flex gap-1.5 flex-wrap items-center">
        <span className="text-[9px] text-slate-500 pr-1">Quick:</span>
        {presets.map((p) => (
          <button
            key={p}
            disabled={disabled}
            title={disabled ? disabledHint : undefined}
            className="text-[10px] bg-[#1e293b] border border-[#334155] rounded px-2 py-0.5 text-slate-300 disabled:opacity-40"
            onClick={() => onGenerate(p, true, model)}
          >{p}</button>
        ))}
        {onGenerateAll && (
          <button disabled={disabled} className="text-[10px] bg-[#1e293b] border border-[#334155] rounded px-2 py-0.5 text-slate-400 ml-auto disabled:opacity-40" onClick={onGenerateAll}>⟳ Generate All</button>
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
        <select value={model} onChange={(e) => setModel(e.target.value)} className="text-[10px] bg-[#1e293b] border border-[#334155] rounded px-2 py-1 text-slate-300">
          {models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <button
          disabled={disabled || text.trim().length === 0}
          title={disabled ? disabledHint : undefined}
          className="text-[10px] bg-[#3b82f6] text-white font-medium rounded px-4 py-1.5 disabled:opacity-40"
          onClick={() => { onGenerate(text.trim(), false, model); setText("") }}
        >Generate</button>
      </div>
    </div>
  )
}
