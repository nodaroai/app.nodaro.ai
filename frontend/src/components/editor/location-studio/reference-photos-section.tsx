import { useState } from "react"
import { toast } from "sonner"
import {
  LOCATION_REFERENCE_PHOTO_KINDS,
  LOCATION_REFERENCE_PHOTO_KIND_LABELS,
} from "@nodaro/shared"
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
  /**
   * Phase 2 #7 — ISO timestamp when the user previously consented. `undefined`
   * = no consent on file, the section shows the consent checkbox above Add
   * and disables Add until ticked. When non-`undefined`, the section hides
   * the checkbox and lets the user add freely. The callback fires with the
   * fresh timestamp on the first add after consent is ticked.
   */
  readonly piiConsentAt?: string
  readonly onConsent?: (timestamp: string) => void
}

export function ReferencePhotosSection({ photos, onChange, piiConsentAt, onConsent }: ReferencePhotosSectionProps) {
  const [pendingUrl, setPendingUrl] = useState("")
  const [pendingKind, setPendingKind] = useState<LocationReferencePhotoKind>("moodBoard")
  // PII consent (Phase 2 #7). The checkbox shows only when the location has
  // never received consent (piiConsentAt is undefined). Once the user ticks
  // it AND adds the first photo, the parent persists piiConsentAt = now()
  // and the checkbox disappears for good.
  const [consentChecked, setConsentChecked] = useState(false)
  const showConsentGate = !piiConsentAt
  // Phase 2 #11 — Search/filter. Reference photos have no `name` field, so we
  // match against the kind enum value (e.g. "wide"), the human label from
  // `LOCATION_REFERENCE_PHOTO_KIND_LABELS` (e.g. "wide-angle reference"), and
  // the trailing filename in the URL. Show input only when the grid is large
  // enough to need it.
  const [searchQuery, setSearchQuery] = useState("")
  const q = searchQuery.trim().toLowerCase()
  const showSearch = photos.length > 10
  const visiblePhotos = q
    ? photos.filter((p) => {
        const filename = p.url.split("/").pop()?.toLowerCase() ?? ""
        const label = LOCATION_REFERENCE_PHOTO_KIND_LABELS[p.kind]?.toLowerCase() ?? ""
        return (
          p.kind.toLowerCase().includes(q) ||
          label.includes(q) ||
          filename.includes(q)
        )
      })
    : photos
  const zeroResults = q.length > 0 && visiblePhotos.length === 0

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
    // PII consent gate (Phase 2 #7). If the location has never received
    // consent, require the checkbox to be ticked AND fire onConsent with
    // a fresh timestamp so the parent can persist it. After this Add, the
    // gate is gone for this location.
    if (showConsentGate) {
      if (!consentChecked) {
        toast.error("Please confirm you have rights and consent")
        return
      }
      onConsent?.(new Date().toISOString())
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
      {showSearch && (
        <div className="flex items-center gap-2 mb-2">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search reference photos…"
            aria-label="Search reference photos"
            className="flex-1 px-3 py-1.5 text-[11px] bg-[#1a1d27] border border-[#1e293b] rounded text-slate-200 placeholder:text-slate-600"
          />
          {q && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="text-[11px] text-slate-400 hover:text-slate-200"
            >
              Clear
            </button>
          )}
        </div>
      )}
      {visiblePhotos.length > 0 && (
        <div className="grid grid-cols-4 gap-2 mb-2">
          {visiblePhotos.map((p) => {
            // Original index needed for remove() to slice the correct entry
            // from the full `photos` array — filtering changes positions.
            const originalIdx = photos.indexOf(p)
            return (
              <div key={p.url + originalIdx} className="relative group">
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
                  onClick={() => remove(originalIdx)}
                  aria-label={`Remove ${p.kind}`}
                  className="absolute top-1 right-1 bg-black/70 hover:bg-red-500 text-white text-[10px] w-5 h-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      )}
      {zeroResults && (
        <div className="text-center text-[11px] text-slate-500 py-6 border border-dashed border-[#1e293b] rounded mb-2">
          No matches for &quot;{searchQuery.trim()}&quot;.{" "}
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="text-pink-400 hover:underline"
          >
            Clear
          </button>
        </div>
      )}
      {showConsentGate && (
        <label className="flex items-start gap-2 mb-2 text-[10px] text-slate-400 leading-snug cursor-pointer select-none">
          <input
            type="checkbox"
            checked={consentChecked}
            onChange={(e) => setConsentChecked(e.target.checked)}
            aria-label="Confirm rights and consent for reference photos"
            className="mt-[2px] accent-[#22d3ee] cursor-pointer"
          />
          <span>
            I confirm I have the rights to upload these photos and that any people
            depicted have consented to their use as AI generation references.
          </span>
        </label>
      )}
      {!showConsentGate && piiConsentAt && (
        <p className="text-[9px] text-slate-500 mb-2">
          Consent recorded {new Date(piiConsentAt).toLocaleDateString()}
        </p>
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
          disabled={!pendingUrl.trim() || photos.length >= MAX_PHOTOS || (showConsentGate && !consentChecked)}
          className="text-[11px] px-3 py-1.5 rounded bg-[#22d3ee] hover:bg-[#22d3ee]/90 disabled:opacity-40 disabled:cursor-not-allowed text-slate-900 font-medium"
        >
          Add
        </button>
      </div>
    </div>
  )
}
