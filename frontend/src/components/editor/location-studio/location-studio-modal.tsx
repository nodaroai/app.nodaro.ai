import { useEffect, useState } from "react"
import { useLocationStudio } from "./use-location-studio"
import { AppearanceTab } from "./appearance-tab"

/**
 * Location Studio — fullscreen modal shell.
 *
 * Mirrors the character-studio shape: header with title + Style Lock toggle
 * + Save + Close, a 140px left sidebar (only Appearance for PR-1), and a
 * scrollable main area. PR-2 lands Variants / Atmosphere / Reference tabs;
 * the sidebar shows a "More tabs in PR-2" placeholder until then.
 *
 * Dirty-state guard: Escape and Close both prompt via window.confirm when
 * isDirty. AlertDialog-based UX is a Phase 2 polish item.
 *
 * Cold-load: when the workflow store hasn't finished hydrating the node
 * (stagedData is null), renders a "Loading location…" placeholder instead
 * of crashing on missing data.
 */
interface LocationStudioModalProps {
  readonly nodeId: string
  readonly onClose: () => void
}

export function LocationStudioModal({ nodeId, onClose }: LocationStudioModalProps) {
  const studio = useLocationStudio(nodeId)
  const [activeTab] = useState<"appearance">("appearance")

  // Escape closes the modal — with a dirty-check prompt so unsaved edits
  // aren't silently discarded. In-flight saves block close entirely (the
  // user can't escape an inflight network call).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return
      if (studio.isSaving || studio.isApprovingMainImage) return
      if (studio.isDirty) {
        if (window.confirm("Discard unsaved changes?")) onClose()
      } else {
        onClose()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [studio.isDirty, studio.isSaving, studio.isApprovingMainImage, onClose])

  if (!studio.stagedData) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Location Studio"
        className="fixed inset-0 z-[1000] bg-[#0d1017] flex items-center justify-center"
      >
        <div className="text-sm text-slate-400">Loading location…</div>
      </div>
    )
  }

  const data = studio.stagedData
  const closeBlocked = studio.isSaving || studio.isApprovingMainImage

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="location-studio-title"
      className="fixed inset-0 z-[1000] bg-[#0d1017] flex flex-col"
    >
      {/* header */}
      <div className="flex items-center justify-between px-4.5 py-2.5 border-b border-[#1e293b] bg-[#090c12] shrink-0">
        <div className="flex items-center gap-3">
          {data.sourceImageUrl ? (
            <img
              src={data.sourceImageUrl}
              className="w-8 h-8 rounded object-cover border border-[#22d3ee44]"
              alt=""
            />
          ) : (
            <div className="w-8 h-8 rounded bg-[#1a1d27] border border-[#22d3ee44]" />
          )}
          <div>
            <h1 id="location-studio-title" className="text-[13px] font-semibold text-slate-200">
              {data.locationName || "Unnamed location"}
            </h1>
            <div className="text-[10px] text-slate-500">
              {data.category} · {data.style}
              {data.styleLock && <span className="text-[#22d3ee]"> · Style locked</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={data.styleLock}
              onChange={(e) => studio.patch({ styleLock: e.target.checked })}
              disabled={closeBlocked}
              className="accent-[#22d3ee]"
            />
            Style Lock
          </label>
          <button
            type="button"
            onClick={() => {
              void studio.saveStaged().catch(() => {
                /* errors already toasted in the hook */
              })
            }}
            disabled={!studio.isDirty || closeBlocked}
            className="text-[11px] px-3 py-1.5 rounded bg-[#ff0073] hover:bg-[#ff0073]/90 disabled:opacity-40 disabled:cursor-not-allowed text-white"
          >
            {studio.isSaving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (closeBlocked) return
              if (studio.isDirty && !window.confirm("Discard unsaved changes?")) return
              onClose()
            }}
            disabled={closeBlocked}
            className="text-[10px] bg-[#1e293b] rounded px-3 py-1.5 text-slate-400 disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Close"
          >
            ✕ Close
          </button>
        </div>
      </div>

      {/* body */}
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-[140px] bg-[#090c12] border-r border-[#1e293b] flex flex-col py-3 shrink-0">
          <div className="px-3.5 pb-1.5 pt-1 text-[9px] uppercase tracking-widest text-slate-700 font-semibold">
            Identity
          </div>
          <button
            type="button"
            className={
              activeTab === "appearance"
                ? "px-3.5 py-1.5 text-[11px] flex items-center gap-1.5 text-[#22d3ee] bg-[#0e2730] border-r-2 border-[#22d3ee]"
                : "px-3.5 py-1.5 text-[11px] flex items-center gap-1.5 text-slate-500 hover:text-slate-300"
            }
          >
            <span className="w-4 text-center">🏞</span>
            Appearance
          </button>
          <div className="px-3.5 pt-4 text-[9px] uppercase tracking-widest text-slate-700 italic">
            More tabs in PR-2
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto p-4">
          {activeTab === "appearance" && <AppearanceTab studio={studio} />}
        </main>
      </div>
    </div>
  )
}

export default LocationStudioModal
