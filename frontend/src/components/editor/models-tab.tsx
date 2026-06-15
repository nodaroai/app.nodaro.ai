import { useEffect, useMemo, useState } from "react"
import { buildModelTree, type ModelTreeVariant } from "@nodaro/shared"
import { Folder, ChevronRight, ArrowLeft, Image as ImageIcon, Film, Music } from "lucide-react"
import { NODE_DEF_MAP } from "@/types/nodes"
import { cn } from "@/lib/utils"

export interface ModelSelection {
  nodeType: string
  field?: "provider" | "model"
  value?: string
  label: string
}

/** Map a model-tree variant to the node-creation selection (provider/model preset). */
export const variantToSelection = (v: ModelTreeVariant): ModelSelection => ({
  nodeType: v.nodeType,
  field: v.field,
  value: v.value,
  label: v.label,
})

const kindIcon = (k: string) =>
  k === "video" ? <Film className="h-[19px] w-[19px]" /> : k === "audio" ? <Music className="h-[19px] w-[19px]" /> : <ImageIcon className="h-[19px] w-[19px]" />
const kindColor = (k: string) => (k === "video" ? "text-[#818CF8]" : k === "audio" ? "text-[#34D399]" : "text-[#ff0073]")
const rowCn = (active: boolean) =>
  cn("w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors", active ? "bg-[#F1F5F9] dark:bg-[#2D2D2D]" : "hover:bg-[#F8FAFC] dark:hover:bg-[#252525]")

// Pure series → variants browser. Model SEARCH lives in the add-node popup now
// (it unifies model hits with node hits per tab); this component only renders the
// no-query browse view and is unmounted while a search is active.
export function ModelsTab({ onSelectModel }: { onSelectModel: (s: ModelSelection) => void }) {
  const tree = useMemo(() => buildModelTree(), [])
  const [openSeries, setOpenSeries] = useState<string | null>(null)
  const [highlighted, setHighlighted] = useState(0)

  const line = openSeries ? tree.find((l) => l.series === openSeries) ?? null : null
  const mode: "variants" | "lines" = openSeries ? "variants" : "lines"
  const variants = mode === "variants" ? line?.models ?? [] : []
  const count = mode === "lines" ? tree.length : variants.length

  useEffect(() => setHighlighted(0), [mode, openSeries])

  const pick = (v: ModelTreeVariant) => onSelectModel(variantToSelection(v))

  // Own the keyboard while the Models tab is mounted. Capture phase + stopPropagation
  // so the popup's node-list Arrow/Enter handler does not also fire. Escape is left
  // to the popup (closes it). ArrowLeft backs out of a drilled line.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault(); e.stopPropagation(); setHighlighted((i) => (count ? Math.min(i + 1, count - 1) : 0))
      } else if (e.key === "ArrowUp") {
        e.preventDefault(); e.stopPropagation(); setHighlighted((i) => Math.max(i - 1, 0))
      } else if (e.key === "Enter") {
        e.preventDefault(); e.stopPropagation()
        if (mode === "lines") { const l = tree[highlighted]; if (l) setOpenSeries(l.series) }
        else { const v = variants[highlighted]; if (v) pick(v) }
      } else if (e.key === "ArrowLeft" && openSeries) {
        e.preventDefault(); e.stopPropagation(); setOpenSeries(null)
      }
    }
    document.addEventListener("keydown", onKey, true)
    return () => document.removeEventListener("keydown", onKey, true)
  }, [mode, count, highlighted, openSeries, tree, variants])

  if (mode !== "lines") {
    return (
      <div>
        {mode === "variants" && line && (
          <div className="flex items-center gap-2.5 px-3.5 py-2 border-b border-[#E2E8F0] dark:border-[#2D2D2D]">
            <button type="button" onClick={() => setOpenSeries(null)} className="flex items-center gap-1.5 text-[13px] font-semibold text-[#ff0073]">
              <ArrowLeft className="h-4 w-4" /> Models
            </button>
            <span className="text-[13px] font-bold text-[#1E293B] dark:text-white">{line.series}</span>
            <span className="ml-auto text-[11px] text-[#94A3B8]">{line.family} · {line.kind}</span>
          </div>
        )}
        <div className="py-1">
          {variants.length === 0
            ? <div className="px-4 py-8 text-center text-base text-[#94A3B8]">No models found</div>
            : variants.map((m, i) => <VariantRow key={m.id} v={m} active={i === highlighted} onHover={() => setHighlighted(i)} onPick={pick} />)}
        </div>
      </div>
    )
  }

  return (
    <div className="py-1">
      {tree.map((l, i) => (
        <button key={l.series} type="button" onClick={() => setOpenSeries(l.series)} onMouseEnter={() => setHighlighted(i)} className={rowCn(i === highlighted)}>
          <span className="text-[#94A3B8]"><Folder className="h-[19px] w-[19px]" /></span>
          <div className="flex-1 min-w-0">
            <div className="text-base font-medium text-[#1E293B] dark:text-white truncate">{l.series}</div>
            <div className="text-sm text-[#94A3B8]">{l.family} · {l.models.length} models</div>
          </div>
          <span className={cn("flex", kindColor(l.kind))}>{kindIcon(l.kind)}</span>
          <ChevronRight className="h-4 w-4 text-[#94A3B8]" />
        </button>
      ))}
    </div>
  )
}

/** One model variant row. Exported so the popup's unified search renders model
 *  hits identically to the browse view (no drift between the two surfaces). */
export function VariantRow({ v, active, onHover, onPick }: { v: ModelTreeVariant; active?: boolean; onHover?: () => void; onPick: (v: ModelTreeVariant) => void }) {
  return (
    <button type="button" onClick={() => onPick(v)} onMouseEnter={onHover} data-active={active ? "true" : undefined} className={rowCn(!!active)}>
      <span className={cn("flex", kindColor(v.kind))}>{kindIcon(v.kind)}</span>
      <div className="flex-1 min-w-0">
        <div className="text-base font-medium text-[#1E293B] dark:text-white truncate">{v.label}</div>
        <div className="text-sm text-[#94A3B8]">creates {NODE_DEF_MAP.get(v.nodeType)?.label ?? v.nodeType}</div>
      </div>
    </button>
  )
}
