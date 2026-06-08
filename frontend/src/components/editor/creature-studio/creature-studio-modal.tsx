import { useEffect, useState } from "react"
import { useCreatureStudio } from "./use-creature-studio"
import { AppearanceTab } from "./appearance-tab"
import { AnglesTab } from "./angles-tab"
import { PosesTab } from "./poses-tab"
import { VariationsTab } from "./variations-tab"
import { MotionTab } from "./motion-tab"

/**
 * Creature Studio — fullscreen modal shell.
 *
 * Mirrors the object-studio precedent (object-studio-modal.tsx) with object →
 * creature substitution + the creature deltas:
 *  - 5 tabs (Appearance / Angles / Poses / Variations / Motion). The object's
 *    "Materials" tab becomes "Poses" (a living creature has poses, not
 *    material finishes).
 *  - The 6th object tab — "Sheet" (reference-sheet) — is DEFERRED this phase
 *    and DROPPED entirely. No ReferenceSheetTab, no SHEET_TAB_ADAPTERS, no
 *    modal-level jobs hook for the sheet's Stage-A panel.
 *  - Community publishing ("Share to community" / PublishDialog) is NOT wired
 *    for creatures (publish-dialog only supports character/location/object),
 *    so that header affordance is omitted.
 *  - Accent is purple (#A78BFA), matching the creature node + MiniMap color,
 *    vs object's cyan (#22d3ee).
 *  - Sidebar sections: Identity / Composition / Variants / Motion (same 4 as
 *    object).
 *
 * Dirty-state guard: Escape and Close both prompt via window.confirm when
 * isDirty. In-flight saves block close entirely (the user can't escape an
 * inflight network call).
 *
 * Cold-load: when the workflow store hasn't finished hydrating the node
 * (stagedData is null), renders a "Loading creature…" placeholder instead
 * of crashing on missing data.
 */

type TabId =
  | "appearance"
  | "angles"
  | "poses"
  | "variations"
  | "motion"

interface TabButtonProps {
  readonly id: TabId
  readonly icon: string
  readonly label: string
  readonly count: number
  readonly active: boolean
  readonly onClick: () => void
}

/**
 * Sidebar tab button. Shows icon + label + parenthetical count when count > 0.
 * Active state mirrors the object precedent with the creature accent: purple
 * text, dark purple-tinted background, and a 2px right-border accent.
 */
function TabButton({ icon, label, count, active, onClick }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "px-3.5 py-1.5 text-[11px] flex items-center gap-1.5 text-[#A78BFA] bg-[#221a33] border-r-2 border-[#A78BFA]"
          : "px-3.5 py-1.5 text-[11px] flex items-center gap-1.5 text-slate-500 hover:text-slate-300"
      }
    >
      <span className="w-4 text-center">{icon}</span>
      {label}
      {count > 0 && <span className="text-slate-500">({count})</span>}
    </button>
  )
}

interface CreatureStudioModalProps {
  readonly nodeId: string
  readonly onClose: () => void
}

export function CreatureStudioModal({ nodeId, onClose }: CreatureStudioModalProps) {
  const studio = useCreatureStudio(nodeId)
  const [activeTab, setActiveTab] = useState<TabId>("appearance")

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
        aria-label="Creature Studio"
        className="fixed inset-0 z-[1000] bg-[#0d1017] flex items-center justify-center"
      >
        <div className="text-sm text-slate-400">Loading creature…</div>
      </div>
    )
  }

  const data = studio.stagedData
  const closeBlocked = studio.isSaving || studio.isApprovingMainImage

  const counts = {
    angles: data.angles?.length ?? 0,
    poses: data.poses?.length ?? 0,
    variations: data.variations?.length ?? 0,
    motion: data.motionClips?.length ?? 0,
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="creature-studio-title"
      className="fixed inset-0 z-[1000] bg-[#0d1017] flex flex-col"
    >
      {/* header */}
      <div className="flex items-center justify-between px-4.5 py-2.5 border-b border-[#1e293b] bg-[#090c12] shrink-0">
        <div className="flex items-center gap-3">
          {data.sourceImageUrl ? (
            <img
              src={data.sourceImageUrl}
              className="w-8 h-8 rounded object-cover border border-[#A78BFA44]"
              alt=""
            />
          ) : (
            <div className="w-8 h-8 rounded bg-[#1a1d27] border border-[#A78BFA44]" />
          )}
          <div>
            <h1 id="creature-studio-title" className="text-[13px] font-semibold text-slate-200">
              {data.creatureName || "Unnamed creature"}
            </h1>
            <div className="text-[10px] text-slate-500">
              {data.species || data.category} · {data.style}
              {data.styleLock && <span className="text-[#A78BFA]"> · Style locked</span>}
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
              className="accent-[#A78BFA]"
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
          <TabButton
            id="appearance"
            icon="🐾"
            label="Appearance"
            count={0}
            active={activeTab === "appearance"}
            onClick={() => setActiveTab("appearance")}
          />

          <div className="px-3.5 pb-1.5 pt-4 text-[9px] uppercase tracking-widest text-slate-700 font-semibold">
            Composition
          </div>
          <TabButton
            id="angles"
            icon="📐"
            label="Angles"
            count={counts.angles}
            active={activeTab === "angles"}
            onClick={() => setActiveTab("angles")}
          />
          <TabButton
            id="poses"
            icon="🧍"
            label="Poses"
            count={counts.poses}
            active={activeTab === "poses"}
            onClick={() => setActiveTab("poses")}
          />

          <div className="px-3.5 pb-1.5 pt-4 text-[9px] uppercase tracking-widest text-slate-700 font-semibold">
            Variants
          </div>
          <TabButton
            id="variations"
            icon="✨"
            label="Variations"
            count={counts.variations}
            active={activeTab === "variations"}
            onClick={() => setActiveTab("variations")}
          />

          <div className="px-3.5 pb-1.5 pt-4 text-[9px] uppercase tracking-widest text-slate-700 font-semibold">
            Motion
          </div>
          <TabButton
            id="motion"
            icon="🎬"
            label="Motion"
            count={counts.motion}
            active={activeTab === "motion"}
            onClick={() => setActiveTab("motion")}
          />
        </aside>

        <main className="flex-1 overflow-y-auto p-4">
          {activeTab === "appearance" && <AppearanceTab studio={studio} />}
          {activeTab === "angles" && <AnglesTab studio={studio} />}
          {activeTab === "poses" && <PosesTab studio={studio} />}
          {activeTab === "variations" && <VariationsTab studio={studio} />}
          {activeTab === "motion" && <MotionTab studio={studio} />}
        </main>
      </div>
    </div>
  )
}

export default CreatureStudioModal
