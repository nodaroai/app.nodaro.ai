import { useState } from "react"
import { toast } from "sonner"
import { LOCATION_REFERENCE_PHOTO_KINDS } from "@nodaro/shared"
import type { LocationReferencePhoto, LocationReferencePhotoKind } from "@/types/nodes"

/**
 * Reference Photos grid — mood-board style. PR-1 ships add-by-URL only; PR-2
 * adds upload + reordering. Backend enforces a 20-photo cap in the route
 * Zod, mirrored here in JS for instant UX feedback (dedup-by-URL also).
 *
 * The set of `kind` values is the single source of truth in
 * `@nodaro/shared/entity-prompts::LOCATION_REFERENCE_PHOTO_KINDS`.
 */
const KINDS: ReadonlyArray<LocationReferencePhotoKind> = LOCATION_REFERENCE_PHOTO_KINDS

const MAX_PHOTOS = 20

interface ReferencePhotosSectionProps {
  readonly photos: ReadonlyArray<LocationReferencePhoto>
  readonly onChange: (photos: LocationReferencePhoto[]) => void
}

export function ReferencePhotosSection({ photos, onChange }: ReferencePhotosSectionProps) {
  const [pendingUrl, setPendingUrl] = useState("")
  const [pendingKind, setPendingKind] = useState<LocationReferencePhotoKind>("moodBoard")

  function add() {
    const trimmed = pendingUrl.trim()
    if (!trimmed) return
    if (photos.some((p) => p.url === trimmed)) {
      toast.info("Photo already added")
      return
    }
    if (photos.length >= MAX_PHOTOS) {
      toast.error(`Max ${MAX_PHOTOS} reference photos`)
      return
    }
    onChange([...photos, { kind: pendingKind, url: trimmed }])
    setPendingUrl("")
  }

  function remove(idx: number) {
    onChange(photos.filter((_, i) => i !== idx))
  }

  return (
    <div data-testid="reference-photos-section">
      <h3 className="text-[12px] font-medium text-slate-300 mb-2">
        Reference photos <span className="text-slate-500">({photos.length}/{MAX_PHOTOS})</span>
      </h3>
      {photos.length > 0 && (
        <div className="grid grid-cols-4 gap-2 mb-2">
          {photos.map((p, i) => (
            <div key={p.url + i} className="relative group">
              <img
                src={p.url}
                alt={p.kind}
                loading="lazy"
                className="w-full aspect-square object-cover rounded border border-[#1e293b]"
              />
              <span className="absolute top-1 left-1 bg-black/70 text-[9px] text-white px-1 rounded">
                {p.kind}
              </span>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`Remove ${p.kind}`}
                className="absolute top-1 right-1 bg-black/70 hover:bg-red-500 text-white text-[10px] w-5 h-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2 items-center">
        <select
          value={pendingKind}
          onChange={(e) => setPendingKind(e.target.value as LocationReferencePhotoKind)}
          aria-label="Reference kind"
          className="text-[11px] bg-[#1a1d27] border border-[#1e293b] rounded px-2 py-1.5 text-slate-300"
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
        <input
          type="url"
          value={pendingUrl}
          onChange={(e) => setPendingUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add() } }}
          placeholder="https://…"
          aria-label="Reference photo URL"
          className="flex-1 text-[11px] bg-[#1a1d27] border border-[#1e293b] rounded px-2 py-1.5 text-slate-300 placeholder:text-slate-600"
        />
        <button
          type="button"
          onClick={add}
          disabled={!pendingUrl.trim() || photos.length >= MAX_PHOTOS}
          className="text-[11px] px-3 py-1.5 rounded bg-[#22d3ee] hover:bg-[#22d3ee]/90 disabled:opacity-40 disabled:cursor-not-allowed text-slate-900 font-medium"
        >
          Add
        </button>
      </div>
    </div>
  )
}
