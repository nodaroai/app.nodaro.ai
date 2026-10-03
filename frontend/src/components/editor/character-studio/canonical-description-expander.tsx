import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { AiHelperButton } from "@/components/ui/ai-helper-button"
import { llmCaptionPortrait } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import { cn } from "@/lib/utils"

interface CanonicalDescriptionExpanderProps {
  readonly characterId: string
  readonly value: string
  readonly onChange: (next: string) => void
}

export function CanonicalDescriptionExpander({ characterId, value, onChange }: CanonicalDescriptionExpanderProps) {
  const t = useT()
  const isRtl = useAppDir() === "rtl"
  const [open, setOpen] = useState(false)
  const preview = value.length > 0 ? value.slice(0, 80).trim() + (value.length > 80 ? "…" : "") : t("studio.noDescriptionYet")

  const refresh = async () => {
    const { canonicalDescription } = await llmCaptionPortrait(characterId)
    return canonicalDescription
  }

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[10px] text-slate-400 hover:text-slate-200 w-full text-start"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className={cn("w-3 h-3", isRtl && "rotate-180")} />}
        <span className="text-[9px] uppercase tracking-wide text-slate-500">{t("studio.canonicalDescription")}</span>
        {!open && <span className="text-slate-500 text-[10px] truncate flex-1">{preview}</span>}
      </button>
      {open && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-slate-500">{t("studio.usedInEveryAssetGen")}</span>
            <AiHelperButton
              onSuggest={refresh}
              onReplace={onChange}
              title={t("studio.regenerateDescFromPortrait")}
            />
          </div>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={5}
            maxLength={4000}
            className="block w-full text-[11px] bg-[#13161f] border border-[#334155] rounded px-2 py-1.5 text-slate-200"
          />
          <div className="text-end text-[9px] text-slate-500 tabular-nums">{value.length}/4000</div>
        </div>
      )}
    </div>
  )
}
