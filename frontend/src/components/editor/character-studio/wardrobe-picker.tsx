import { useCallback } from "react"
import {
  WARDROBE_DIMENSION_ORDER, WARDROBE_CATEGORY_LABELS, WARDROBE_FIELD_BY_DIMENSION,
  getWardrobeEntriesByDimension, pickIds, togglePick, type WardrobeValue, type WardrobeDimension,
} from "@nodaro/shared"

const MULTI: ReadonlySet<WardrobeDimension> = new Set(["headwear", "accessories"])

export function WardrobePicker({ value, onChange }: { value: WardrobeValue; onChange: (v: WardrobeValue) => void }) {
  const toggle = useCallback((dim: WardrobeDimension, id: string) => {
    const field = WARDROBE_FIELD_BY_DIMENSION[dim]
    if (MULTI.has(dim)) {
      // Unlimited multi-pick — Infinity cap so togglePick appends instead of
      // FIFO-replacing (matches the prior uncapped add/remove behavior).
      onChange({ ...value, [field]: togglePick(pickIds(value[field]), id, Infinity) })
    } else {
      const cur = value[field] as string | undefined
      onChange({ ...value, [field]: cur === id ? undefined : id })
    }
  }, [value, onChange])

  const isSel = (dim: WardrobeDimension, id: string) => {
    const v = value[WARDROBE_FIELD_BY_DIMENSION[dim]]
    return Array.isArray(v) ? pickIds(v).includes(id) : v === id
  }

  return (
    <div className="space-y-3">
      {WARDROBE_DIMENSION_ORDER.map((dim) => (
        <div key={dim}>
          <div className="text-[10px] text-slate-400 mb-1">{WARDROBE_CATEGORY_LABELS[dim]}{MULTI.has(dim) ? " (multi)" : ""}</div>
          <div className="flex flex-wrap gap-1.5">
            {getWardrobeEntriesByDimension(dim).map((e) => (
              <button
                key={e.id}
                onClick={() => toggle(dim, e.id)}
                className={`text-[11px] px-2 py-1 rounded border ${isSel(dim, e.id) ? "border-[#3b82f6] bg-[#1a2744] text-[#3b82f6]" : "border-[#334155] text-slate-300 hover:text-slate-100"}`}
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
