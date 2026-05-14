import { useState } from "react"
import { X } from "lucide-react"
import { AiHelperButton } from "@/components/ui/ai-helper-button"
import { llmSuggestDescription } from "@/lib/api"

export interface AssetGenSubmission {
  readonly userPrompt: string
  readonly description: string
  readonly motionDescription?: string
  readonly realLifeRefs: ReadonlyArray<string>
}

interface AssetGenPanelProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly onGenerate: (submission: AssetGenSubmission) => void
  readonly assetType: "expressions" | "poses" | "angles" | "lighting" | "motions"
  readonly characterId: string
  readonly canonicalDescription?: string
}

export function AssetGenPanel({
  open,
  onClose,
  onGenerate,
  assetType,
  canonicalDescription,
}: AssetGenPanelProps) {
  const [userPrompt, setUserPrompt] = useState("")
  const [description, setDescription] = useState("")
  const [motionDescription, setMotionDescription] = useState("")
  const [refs] = useState<string[]>([])  // refs upload handled inside the AssetGenPanel in a later iteration; for now empty

  if (!open) return null

  const suggest = async () => {
    const { text } = await llmSuggestDescription({
      kind: "asset-description",
      context: { assetType, userPrompt, canonicalDescription },
    })
    return text
  }

  const submit = () => {
    onGenerate({
      userPrompt: userPrompt.trim(),
      description: description.trim(),
      motionDescription: assetType === "motions" ? motionDescription.trim() : undefined,
      realLifeRefs: refs,
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="w-96 bg-[#0d1017] border border-[#1e293b] rounded-lg p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-slate-200">Custom {assetType}</span>
          <button onClick={onClose} aria-label="Close"><X className="w-3.5 h-3.5 text-slate-500" /></button>
        </div>
        <input
          value={userPrompt}
          onChange={(e) => setUserPrompt(e.target.value)}
          placeholder="Custom prompt (e.g. winking with raised eyebrow)"
          className="block w-full text-[11px] bg-[#13161f] border border-[#334155] rounded px-2 py-1.5 text-slate-200"
        />
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-wide text-slate-500">Description</span>
            <AiHelperButton onSuggest={suggest} onReplace={setDescription} title="Suggest description" />
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description of the result (the AI will draft if empty)"
            rows={3}
            maxLength={1000}
            className="block w-full text-[11px] bg-[#13161f] border border-[#334155] rounded px-2 py-1.5 text-slate-200"
          />
        </div>
        {assetType === "motions" && (
          <textarea
            value={motionDescription}
            onChange={(e) => setMotionDescription(e.target.value)}
            placeholder="Motion description (the motion itself)"
            rows={2}
            maxLength={500}
            className="block w-full text-[11px] bg-[#13161f] border border-[#334155] rounded px-2 py-1.5 text-slate-200"
          />
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-[10px] text-slate-400 px-3 py-1.5">Cancel</button>
          <button onClick={submit} className="text-[10px] bg-[#3b82f6] text-white rounded px-3 py-1.5">Generate</button>
        </div>
      </div>
    </div>
  )
}
