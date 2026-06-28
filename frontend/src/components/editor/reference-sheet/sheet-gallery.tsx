import { useMemo, useState } from "react"
import { toast } from "sonner"
import { Copy } from "lucide-react"
import { PRESET_LABELS, type ReferenceSheet, type SheetPresetId } from "@nodaro/shared"
import { MultiImageLightbox } from "@/components/ui/multi-image-lightbox"

interface SheetGalleryProps {
  readonly result: { url: string; label: string } | null
  readonly sheets: readonly ReferenceSheet[]
  readonly onSetThumbnail: (url: string, label: string) => void
  readonly accent: string
}

/** Label a sheet by its preset, falling back to `type · skin` (legacy/non-preset). */
export function sheetLabel(sheet: Pick<ReferenceSheet, "type" | "skin" | "flavour">): string {
  const pid = sheet.flavour?.presetId as SheetPresetId | undefined
  if (pid && PRESET_LABELS[pid]) return PRESET_LABELS[pid]
  return `${sheet.type}${sheet.skin ? ` · ${sheet.skin}` : ""}`
}

async function copyUrl(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url)
    toast.success("URL copied")
  } catch {
    toast.error("Couldn't copy URL")
  }
}

/**
 * Shared result-preview + existing-sheets grid for the Sheet tab. Clicking the
 * result or any tile opens a fullscreen lightbox spanning `[result, ...sheets]`
 * with ←/→, a Copy-URL action, and motion sheets rendered as video. Used by
 * both the character preset panel and the classic (object/location) panel.
 */
export function SheetGallery({ result, sheets, onSetThumbnail, accent }: SheetGalleryProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  const items = useMemo(() => {
    const list: { url: string; alt?: string; kind?: "image" | "video" }[] = []
    if (result) list.push({ url: result.url, alt: result.label, kind: "image" })
    for (const s of sheets) {
      list.push({ url: s.url, alt: sheetLabel(s), kind: s.flavour?.outputFormat === "motion" ? "video" : "image" })
    }
    return list
  }, [result, sheets])

  const btn = "text-[11px] px-3 py-1 rounded bg-[#1a1d27] hover:bg-[#1e293b] border border-[#1e293b] text-slate-300"

  return (
    <>
      {result && (
        <div className="space-y-2 pt-1">
          <div className="text-[9px] uppercase tracking-widest text-slate-600">Result</div>
          <button
            type="button"
            onClick={() => setLightboxIndex(0)}
            className="relative block border border-[#1e293b] rounded overflow-hidden bg-[#0e1117] max-w-full cursor-zoom-in"
            aria-label="Open full screen"
          >
            <img src={result.url} alt="Generated reference sheet" className="max-w-full max-h-[420px] object-contain" />
          </button>
          <div className="flex items-center gap-3">
            <a href={result.url} download target="_blank" rel="noreferrer" className={btn}>Download</a>
            <button type="button" onClick={() => void copyUrl(result.url)} className={btn}>Copy URL</button>
            <button type="button" onClick={() => onSetThumbnail(result.url, result.label)} className={btn}>Set as thumbnail</button>
          </div>
        </div>
      )}

      <div className="space-y-2 pt-2 border-t border-[#1e293b]">
        <div className="text-[9px] uppercase tracking-widest text-slate-600">
          Existing sheets {sheets.length > 0 && `(${sheets.length})`}
        </div>
        {sheets.length === 0 ? (
          <div className="text-[11px] text-slate-500 py-4 border border-dashed border-[#1e293b] rounded text-center">
            No reference sheets yet — pick a preset above and generate one.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {sheets.map((sheet, idx) => {
              const label = sheetLabel(sheet)
              const lbIdx = result ? idx + 1 : idx
              return (
                <div key={`${sheet.url}-${idx}`} className="relative group border border-[#1e293b] rounded overflow-hidden bg-[#0e1117]">
                  <button
                    type="button"
                    onClick={() => setLightboxIndex(lbIdx)}
                    className="block w-full cursor-zoom-in"
                    aria-label="Open full screen"
                  >
                    <img src={sheet.url} alt={label} loading="lazy" className="w-full h-full object-cover aspect-video" />
                  </button>
                  <div className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[10px] px-1.5 py-0.5 pointer-events-none">{label}</div>
                  <div className="absolute inset-x-0 top-0 flex justify-end gap-1 p-1 opacity-0 group-hover:opacity-100">
                    <a href={sheet.url} download target="_blank" rel="noreferrer" className="px-1.5 py-0.5 text-[10px] rounded bg-black/60 text-white hover:bg-black/80" title="Download">↓</a>
                    <button type="button" onClick={() => void copyUrl(sheet.url)} className="px-1.5 py-0.5 text-[10px] rounded bg-black/60 text-white hover:bg-black/80" title="Copy URL">⧉</button>
                    <button type="button" onClick={() => onSetThumbnail(sheet.url, label)} className="px-1.5 py-0.5 text-[10px] rounded bg-black/60 text-white hover:bg-black/80">Set thumb</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <MultiImageLightbox
        items={items}
        startIndex={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
        actions={(item) => (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void copyUrl(item.url) }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/20 hover:bg-white/40 text-white text-xs"
            style={{ outlineColor: accent }}
          >
            <Copy className="w-4 h-4" /> Copy URL
          </button>
        )}
      />
    </>
  )
}
