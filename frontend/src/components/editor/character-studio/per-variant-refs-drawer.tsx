import { useState } from "react"
import { optimizedImageUrl } from "@/lib/image"
import { X, Upload, ChevronRight, ChevronDown } from "lucide-react"
import { toast } from "sonner"
import { uploadImage } from "@/lib/api"

const MAX_PHOTOS_PER_VARIANT = 5

interface PerVariantRefsDrawerProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly title: string
  readonly variants: ReadonlyArray<string>
  readonly refsByVariant: Readonly<Record<string, ReadonlyArray<string>>>
  readonly onChange: (next: Record<string, ReadonlyArray<string>>) => void
}

export function PerVariantRealLifeRefsDrawer({
  open,
  onClose,
  title,
  variants,
  refsByVariant,
  onChange,
}: PerVariantRefsDrawerProps) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)

  if (!open) return null

  const normalize = (k: string) => k.toLowerCase().trim()

  const uploadFor = async (variant: string, file: File) => {
    const key = normalize(variant)
    const current = refsByVariant[key] ?? []
    if (current.length >= MAX_PHOTOS_PER_VARIANT) {
      toast.error(`Max ${MAX_PHOTOS_PER_VARIANT} photos per variant.`)
      return
    }
    setUploading(variant)
    try {
      const { url } = await uploadImage(file)
      onChange({ ...refsByVariant, [key]: [...current, url] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.")
    } finally {
      setUploading(null)
    }
  }

  const removeUrl = (variant: string, url: string) => {
    const key = normalize(variant)
    const current = refsByVariant[key] ?? []
    const next = current.filter((u) => u !== url)
    const copy: Record<string, ReadonlyArray<string>> = { ...refsByVariant }
    if (next.length === 0) delete copy[key]
    else copy[key] = next
    onChange(copy)
  }

  return (
    <div className="absolute inset-y-0 right-0 w-80 bg-[#0d1017] border-l border-[#1e293b] z-40 flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1e293b]">
        <span className="text-[11px] text-slate-200">{title}</span>
        <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-200">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {variants.map((variant) => {
          const key = normalize(variant)
          const urls = refsByVariant[key] ?? []
          const isExpanded = expanded === variant
          return (
            <div key={variant} className="border border-[#1e293b] rounded">
              <button
                type="button"
                onClick={() => setExpanded(isExpanded ? null : variant)}
                className="w-full flex items-center justify-between px-2 py-1.5 text-[11px] text-slate-300 hover:bg-[#13161f]"
              >
                <span className="flex items-center gap-1">
                  {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  {variant}
                </span>
                <span className="text-[10px] text-slate-500 tabular-nums">{urls.length}/{MAX_PHOTOS_PER_VARIANT}</span>
              </button>
              {isExpanded && (
                <div className="p-2 space-y-2">
                  <div className="grid grid-cols-3 gap-1.5">
                    {urls.map((url) => (
                      <div key={url} className="relative group aspect-square">
                        <img src={optimizedImageUrl(url)} alt="" className="w-full h-full object-cover rounded" />
                        <button
                          type="button"
                          onClick={() => removeUrl(variant, url)}
                          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-black/80 text-white opacity-0 group-hover:opacity-100"
                          aria-label="Remove"
                        >
                          <X className="w-2 h-2" />
                        </button>
                      </div>
                    ))}
                    {urls.length < MAX_PHOTOS_PER_VARIANT && (
                      <label className="relative aspect-square border border-dashed border-[#334155] rounded flex items-center justify-center cursor-pointer hover:border-[#3b82f6]/60">
                        <input
                          type="file"
                          accept="image/*"
                          className="absolute inset-0 opacity-0 cursor-pointer"
                          onChange={(e) => {
                            const f = e.target.files?.[0]
                            if (f) uploadFor(variant, f)
                          }}
                        />
                        {uploading === variant ? (
                          <Upload className="w-3 h-3 animate-pulse text-slate-500" />
                        ) : (
                          <span className="text-[14px] text-slate-500">+</span>
                        )}
                      </label>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
