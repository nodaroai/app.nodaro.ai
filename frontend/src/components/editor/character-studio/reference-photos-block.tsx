import { useState } from "react"
import { optimizedImageUrl } from "@/lib/image"
import { X, Upload } from "lucide-react"
import { toast } from "sonner"
import type { ReferencePhoto, ReferencePhotoKind } from "@/lib/reference-photo-routing"
import { uploadImage } from "@/lib/api"

/**
 * Reference Photos block — 7 named slots for raw reference photos that get
 * routed into different character-studio generations (portrait, expressions,
 * poses, motions, angles, lighting) per the `routePhotosForAsset` heuristic
 * in `@/lib/reference-photo-routing`.
 *
 * Six of the slots (front, three-quarter L/R, side L/R, full body) hold ONE
 * photo each — uploading replaces. The "other" slot is a catch-all that
 * accumulates multiple photos; clicking it always adds another (no replace).
 *
 * Upload: each slot has an invisible `<input type="file">` overlay so the
 * whole 64×64 tile acts as a click target. We don't add native drag-drop
 * here — the file picker keeps the implementation small and the input
 * element already accepts dropped files on most browsers.
 */

const SLOTS: ReadonlyArray<ReferencePhotoKind> = [
  "frontFace",
  "threeQuarterLeft",
  "sideLeft",
  "sideRight",
  "threeQuarterRight",
  "frontBody",
  "other",
]

const SLOT_LABELS: Record<ReferencePhotoKind, string> = {
  frontFace: "Face",
  threeQuarterLeft: "3/4 L",
  sideLeft: "Profile L",
  sideRight: "Profile R",
  threeQuarterRight: "3/4 R",
  frontBody: "Body",
  other: "+",
}

interface ReferencePhotosBlockProps {
  readonly photos: ReadonlyArray<ReferencePhoto>
  readonly onChange: (next: ReadonlyArray<ReferencePhoto>) => void
}

export function ReferencePhotosBlock({ photos, onChange }: ReferencePhotosBlockProps) {
  const [uploadingSlot, setUploadingSlot] = useState<ReferencePhotoKind | null>(null)

  // First photo per kind goes on its named slot; everything routed to "other"
  // is bundled into the multi-photo slot.
  const byKind = new Map<ReferencePhotoKind, ReferencePhoto>()
  const otherPhotos: ReferencePhoto[] = []
  for (const p of photos) {
    if (p.kind === "other") otherPhotos.push(p)
    else if (!byKind.has(p.kind)) byKind.set(p.kind, p)
  }

  const uploadToSlot = async (slot: ReferencePhotoKind, file: File) => {
    setUploadingSlot(slot)
    try {
      const { url } = await uploadImage(file)
      // For "other": always append (multi-photo bucket).
      // For named slots: replace any existing photo on that slot.
      const filtered = slot === "other" ? photos : photos.filter((p) => p.kind !== slot)
      onChange([...filtered, { url, kind: slot }])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.")
    } finally {
      setUploadingSlot(null)
    }
  }

  const removePhoto = (target: ReferencePhoto) => {
    onChange(photos.filter((p) => !(p.url === target.url && p.kind === target.kind)))
  }

  return (
    <div className="space-y-2">
      <div className="text-[9px] uppercase tracking-wide text-slate-500">Reference Photos</div>
      <div className="flex flex-wrap gap-1.5">
        {SLOTS.map((slot) => (
          <Slot
            key={slot}
            slot={slot}
            label={SLOT_LABELS[slot]}
            photo={byKind.get(slot)}
            otherCount={slot === "other" ? otherPhotos.length : 0}
            uploading={uploadingSlot === slot}
            onUpload={(file) => uploadToSlot(slot, file)}
            onRemove={(p) => removePhoto(p)}
          />
        ))}
      </div>
      <div className="text-[9px] text-slate-500">
        Click a slot to upload. Changing photos triggers re-generation prompts on next asset gen.
      </div>
    </div>
  )
}

function Slot({
  slot,
  label,
  photo,
  otherCount,
  uploading,
  onUpload,
  onRemove,
}: {
  slot: ReferencePhotoKind
  label: string
  photo?: ReferencePhoto
  otherCount: number
  uploading: boolean
  onUpload: (file: File) => void
  onRemove: (p: ReferencePhoto) => void
}) {
  return (
    <div className="relative group">
      {/* Invisible file input overlays the whole tile so the entire 64×64 area
          is a click target. Sits beneath the X button (z-10 < z-20) so the
          remove button still wins clicks on a filled slot. */}
      <input
        type="file"
        accept="image/*"
        className="absolute inset-0 opacity-0 cursor-pointer z-10"
        aria-label={`Upload ${slot}`}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onUpload(f)
          // Reset value so picking the same file again refires `change`.
          e.target.value = ""
        }}
      />
      <button
        type="button"
        aria-label={`${slot} slot`}
        className="w-16 h-16 rounded-md border border-dashed border-[#334155] bg-[#13161f] flex items-center justify-center text-[10px] text-slate-500 overflow-hidden hover:border-[#3b82f6]/60"
      >
        {photo ? (
          <img src={optimizedImageUrl(photo.url)} alt={slot} className="w-full h-full object-cover" />
        ) : uploading ? (
          <Upload className="w-3 h-3 animate-pulse" />
        ) : (
          <span>
            {label}
            {otherCount > 0 ? ` +${otherCount}` : ""}
          </span>
        )}
      </button>
      {photo && (
        <button
          type="button"
          aria-label={`Remove ${slot}`}
          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-black/80 text-white text-[9px] flex items-center justify-center opacity-0 group-hover:opacity-100 z-20"
          onClick={() => onRemove(photo)}
        >
          <X className="w-2 h-2" />
        </button>
      )}
    </div>
  )
}
